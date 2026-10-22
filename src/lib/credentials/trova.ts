/**
 * Prova e ricerca della credenziale che funziona su un host (tappe 3-5, T3, 21/10).
 *
 * Due pezzi:
 * - `provaCredenzialeSuHost`: la prova vera di UNA credenziale su UN host, tolta dalla rotta
 *   `POST /api/credentials/[id]/test` perché la usi anche la ricerca. Non scrive nulla: chi chiama
 *   registra l'esito con `registraProva`.
 * - `trovaCredenziale`: prova in sequenza i candidati di un host fermandosi alla prima riuscita.
 *
 * Decisioni di Riccardo (21/10): su Windows/AD al più `TETTO_WINDOWS` tentativi veri per host (un
 * account bloccato è un danno al cliente); una credenziale già fallita su quell'host è «esclusa» e
 * si dice, senza riprovarla; la «Prova» a mano (rotta test) la rimette in gioco con un successo.
 *
 * Incidente (21/10): la rotta test non registrava i fallimenti, quindi nulla poteva risultare
 * «esclusa». Ora ogni prova vera, riuscita o no, passa da `registraProva`.
 *
 * Il DB si riceve come handle; la scrittura dell'esito passa da `db-tenant` (contesto tenant attivo).
 */
import type Database from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";
import { portaCredenziale, type CredProtocol } from "./porte";
import { provaCredenzialeSnmpDb } from "./prova-snmp";
import { tipiPerProtocollo } from "./tipi";
import { accessoSshDb } from "./segreti";
import { shouldAttemptCredential } from "@/lib/scanner/credential-anti-lockout";
import { recordCredentialFailure, recordCredentialSuccess } from "@/lib/db-tenant";
import type { ProtocolloApparato } from "@/lib/devices/proposta-apparato";
import { classifyWinrmError } from "@/lib/devices/winrm-errors";

export const TETTO_WINDOWS = 3;
const TEST_TIMEOUT_MS = 25000;

export type EsitoTentativo = "riuscita" | "rifiutata" | "esclusa" | "fermata";

export interface Tentativo {
  credentialId: number;
  nome: string;
  esito: EsitoTentativo;
  motivo: string | null;
  /** ISO UTC. */
  quando: string;
}

export interface EsitoRicerca {
  hostId: number;
  trovata: { credentialId: number; nome: string } | null;
  tentativi: Tentativo[];
}

export interface Candidato {
  credentialId: number;
  nome: string;
  esclusa: { dal: string; errore: string } | null;
}

/** Protocollo di apparato → protocollo delle credenziali (`host_credentials.protocol_type`). */
export function protocolloCredenziale(p: ProtocolloApparato): CredProtocol {
  return p === "snmp_v2" || p === "snmp_v3" ? "snmp" : p;
}

// ---------------------------------------------------------------- prova vera

export interface EsitoProvaSuHost {
  ok: boolean;
  errore?: string;
  /** Protocollo e porta realmente provati; null se non si è arrivati a tentare. */
  protocollo: CredProtocol | null;
  porta: number | null;
  /** true solo se c'è stato un tentativo vero verso l'host (non un segreto mancante o un tipo non provabile). */
  registra: boolean;
  /**
   * true se l'host non ha risposto (timeout, connessione rifiutata, nessuna strada): non è un rifiuto della
   * credenziale. Chi chiama non registra il fallimento e non esclude nulla.
   */
  trasporto: boolean;
  /** Corpo JSON della rotta test (stessa forma di prima). */
  risposta: Record<string, unknown>;
}

function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const scadenza = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`Timeout: nessuna risposta entro ${ms / 1000} secondi`)), ms);
  });
  return Promise.race([p, scadenza]).finally(() => clearTimeout(t));
}

function nonProvata(errore: string): EsitoProvaSuHost {
  return { ok: false, errore, protocollo: null, porta: null, registra: false, trasporto: false, risposta: { success: false, error: errore } };
}

// closed_by_remote (22/10): il dispositivo chiude prima di presentarsi, la credenziale non è nemmeno stata provata.
const SSH_TRASPORTO = new Set(["connect_refused", "connect_timeout", "closed_by_remote", "unreachable"]);
const WINRM_TRASPORTO = new Set(["TCP_CLOSED", "TCP_TIMEOUT", "BRIDGE_TIMEOUT"]);

/**
 * L'errore dice che l'host non ha risposto, non che la credenziale è sbagliata? Un errore di trasporto non è
 * una risposta (regola 5): né rifiutata né esclusa. SNMP: il timeout NON conta, perché una community sbagliata
 * non riceve risposta e si manifesta proprio come un timeout; contano solo le strade che mancano.
 */
export function eErroreDiTrasporto(protocollo: CredProtocol, errore: string, kind?: string | null): boolean {
  const testo = errore || "";
  if (/EHOSTUNREACH|ENETUNREACH|no route to host|host is unreachable/i.test(testo)) return true;
  if (protocollo === "snmp") return false;
  if (/^Timeout: nessuna risposta/i.test(testo) || /ECONNREFUSED|ETIMEDOUT/i.test(testo)) return true;
  if (protocollo === "ssh") return kind != null && SSH_TRASPORTO.has(kind);
  if (protocollo === "winrm") return WINRM_TRASPORTO.has(classifyWinrmError(testo).code);
  return false;
}

/** Esito di fallimento con la marca del trasporto; il messaggio della rotta lo dice. */
function fallita(protocollo: CredProtocol, porta: number | null, errore: string, risposta: Record<string, unknown>, kind?: string | null): EsitoProvaSuHost {
  const trasporto = eErroreDiTrasporto(protocollo, errore, kind);
  return {
    ok: false,
    errore,
    protocollo,
    porta,
    registra: true,
    trasporto,
    risposta: trasporto ? { ...risposta, error: `Host non raggiungibile: ${errore}`, trasporto: true } : risposta,
  };
}

/** Prova UNA credenziale su UN host (indirizzo). Mai scrive: l'esito lo registra chi chiama. */
export async function provaCredenzialeSuHost(
  dbh: Database.Database,
  credentialId: number,
  host: string,
  portaChiesta?: number | null,
): Promise<EsitoProvaSuHost> {
  const cred = dbh
    .prepare(`SELECT id, name, credential_type, port, encrypted_username, encrypted_password FROM credentials WHERE id = ?`)
    .get(credentialId) as
    | { id: number; name: string; credential_type: string; port: number | null; encrypted_username: string | null; encrypted_password: string | null }
    | undefined;
  if (!cred) return nonProvata("Credenziale non trovata");
  const type = String(cred.credential_type || "").toLowerCase();
  const porta = (p: CredProtocol) => (typeof portaChiesta === "number" ? portaChiesta : portaCredenziale({ port: cred.port ?? null }, p));

  if (tipiPerProtocollo("snmp").includes(type)) {
    try {
      const esito = await conTimeout(
        provaCredenzialeSnmpDb(dbh, credentialId, host, typeof portaChiesta === "number" ? portaChiesta : null),
        TEST_TIMEOUT_MS,
      );
      if (!esito.success) {
        return fallita("snmp", porta("snmp"), esito.error, { success: false, error: esito.error });
      }
      return {
        ok: true,
        protocollo: "snmp",
        porta: esito.port,
        registra: true,
        trasporto: false,
        risposta: { success: true, message: esito.message, ...(esito.snmp_version ? { snmp_version: esito.snmp_version } : {}) },
      };
    } catch (e) {
      const errore = e instanceof Error ? e.message : "Connessione SNMP fallita";
      return fallita("snmp", porta("snmp"), errore, { success: false, error: errore });
    }
  }

  if (tipiPerProtocollo("ssh").includes(type)) {
    // Password o chiave privata (segreti.ts): il rifiuto dice cosa manca o cosa non si decifra, mai il segreto.
    const accesso = accessoSshDb(dbh, credentialId);
    if (!accesso.ok) return nonProvata(accesso.motivo);
    const { sshTryConnect, segretoSsh } = await import("@/lib/devices/ssh-transport");
    const port = porta("ssh");
    try {
      const result = await conTimeout(
        sshTryConnect({ host, port, username: accesso.accesso.username, ...segretoSsh(accesso.accesso), timeout: 15000, credentialName: cred.name }),
        TEST_TIMEOUT_MS,
      );
      if (result.ok) {
        return { ok: true, protocollo: "ssh", porta: port, registra: true, trasporto: false, risposta: { success: true, message: "Connessione SSH riuscita" } };
      }
      const err = result.error;
      return fallita(
        "ssh",
        port,
        err.message,
        { success: false, error: err.message, hint: err.hint, kind: err.kind, methodsOffered: err.methodsOffered, methodsTried: err.methodsTried },
        err.kind,
      );
    } catch (e) {
      const errore = e instanceof Error ? e.message : "Connessione SSH fallita";
      return fallita("ssh", port, errore, { success: false, error: errore });
    }
  }

  if (type === "windows") {
    const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
    const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
    if (username === null || password === null) return nonProvata("Credenziale corrotta: rigenerare la password");
    if (!username || !password) return nonProvata("Username e password richiesti");
    const port = porta("winrm");
    try {
      const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
      const ad = dbh.prepare(`SELECT domain FROM ad_integrations WHERE enabled = 1 ORDER BY id LIMIT 1`).get() as { domain: string } | undefined;
      await conTimeout(runWinrmCommand(host, port, username, password, "echo test", false, ad?.domain || ""), TEST_TIMEOUT_MS);
      return { ok: true, protocollo: "winrm", porta: port, registra: true, trasporto: false, risposta: { success: true, message: "Connessione WinRM riuscita" } };
    } catch (e) {
      const errore = e instanceof Error ? e.message : "Connessione WinRM fallita.";
      return fallita("winrm", port, errore, { success: false, error: errore });
    }
  }

  if (type === "api") return nonProvata("Il test per credenziali API va effettuato dal dispositivo (es. Proxmox, Omada).");
  return nonProvata(`Tipo credenziale "${cred.credential_type}" non supportato per il test`);
}

/**
 * Registra l'esito di una prova vera sull'host: successo azzera fallimenti e riabilita una esclusa,
 * fallimento la esclude (e fa partire il backoff). Va chiamata solo se `EsitoProvaSuHost.registra`.
 */
export function registraProva(
  hostId: number,
  credentialId: number,
  protocollo: CredProtocol,
  porta: number,
  esito: { ok: boolean; errore?: string },
): void {
  if (esito.ok) recordCredentialSuccess(hostId, credentialId, protocollo, porta);
  else recordCredentialFailure(hostId, credentialId, protocollo, porta, esito.errore || "Autenticazione non riuscita");
}

// ---------------------------------------------------------------- candidati

/**
 * Candidati in ordine: validate sull'host, poi lista della rete, poi il resto dell'archivio dei tipi
 * giusti. Senza doppioni. Le escluse restano nell'elenco, con la data e l'errore dell'ultimo fallimento.
 */
export function candidatiPerHost(
  dbh: Database.Database,
  hostId: number,
  protocollo: ProtocolloApparato,
  porta: number,
): Candidato[] {
  const proto = protocolloCredenziale(protocollo);
  const tipi = tipiPerProtocollo(protocollo);
  if (tipi.length === 0) return [];
  const segnaposto = tipi.map(() => "?").join(", ");

  const validate = dbh
    .prepare(
      `SELECT hc.credential_id AS id FROM host_credentials hc JOIN credentials c ON c.id = hc.credential_id
       WHERE hc.host_id = ? AND hc.protocol_type = ? AND hc.validated = 1 AND c.credential_type IN (${segnaposto})
       ORDER BY hc.sort_order, hc.id`,
    )
    .all(hostId, proto, ...tipi) as Array<{ id: number }>;

  const dellaRete = dbh
    .prepare(
      `SELECT nc.credential_id AS id FROM network_credentials nc
       JOIN hosts h ON h.network_id = nc.network_id JOIN credentials c ON c.id = nc.credential_id
       WHERE h.id = ? AND c.credential_type IN (${segnaposto}) ORDER BY nc.sort_order, nc.id`,
    )
    .all(hostId, ...tipi) as Array<{ id: number }>;

  const resto = dbh
    .prepare(`SELECT id FROM credentials WHERE credential_type IN (${segnaposto}) ORDER BY id`)
    .all(...tipi) as Array<{ id: number }>;

  const ordine: number[] = [];
  for (const r of [...validate, ...dellaRete, ...resto]) if (!ordine.includes(r.id)) ordine.push(r.id);
  if (ordine.length === 0) return [];

  const nomi = new Map(
    (dbh.prepare(`SELECT id, name FROM credentials WHERE id IN (${ordine.map(() => "?").join(", ")})`).all(...ordine) as Array<{ id: number; name: string }>).map(
      (r) => [r.id, r.name],
    ),
  );
  const fallite = new Map(
    (
      dbh
        .prepare(
          `SELECT credential_id AS id, last_attempt_at, last_error FROM host_credentials
           WHERE host_id = ? AND protocol_type = ? AND port = ? AND validated = 0 AND last_error IS NOT NULL`,
        )
        .all(hostId, proto, porta) as Array<{ id: number; last_attempt_at: string | null; last_error: string }>
    ).map((r) => [r.id, r]),
  );

  return ordine.map((id) => {
    const f = fallite.get(id);
    return {
      credentialId: id,
      nome: nomi.get(id) ?? `#${id}`,
      esclusa: f ? { dal: f.last_attempt_at ?? "", errore: f.last_error } : null,
    };
  });
}

// ---------------------------------------------------------------- ricerca

/** `nonProvata`: non si è arrivati a tentare l'host (segreto mancante, tipo non provabile): niente traccia, niente tetto. */
export type EsitoProva = { ok: boolean; errore?: string; nonProvata?: boolean; trasporto?: boolean };

export interface OpzioniRicerca {
  /**
   * Credenziali già rifiutate 3 volte in questo giro su altri host (lo conta chi lancia il giro): qui
   * si fermano senza prova, per non far bloccare un account di dominio con password scaduta.
   */
  escludi?: number[];
}

export async function trovaCredenziale(
  dbh: Database.Database,
  hostId: number,
  protocollo: ProtocolloApparato,
  porta: number,
  prova: (credentialId: number) => Promise<EsitoProva>,
  opzioni: OpzioniRicerca = {},
): Promise<EsitoRicerca> {
  const daEscludere = new Set(opzioni.escludi ?? []);
  const proto = protocolloCredenziale(protocollo);
  const candidati = candidatiPerHost(dbh, hostId, protocollo, porta);
  const conTetto = proto === "winrm";
  const tipi = new Map(
    (dbh.prepare(`SELECT id, credential_type FROM credentials`).all() as Array<{ id: number; credential_type: string }>).map((r) => [r.id, r.credential_type.toLowerCase()]),
  );
  const backoff = new Map(
    (
      dbh
        .prepare(`SELECT credential_id AS id, backoff_until FROM host_credentials WHERE host_id = ? AND protocol_type = ? AND port = ?`)
        .all(hostId, proto, porta) as Array<{ id: number; backoff_until: string | null }>
    ).map((r) => [r.id, r.backoff_until]),
  );

  const tentativi: Tentativo[] = [];
  let trovata: EsitoRicerca["trovata"] = null;
  let veri = 0;
  const ora = () => new Date().toISOString();

  for (const c of candidati) {
    if (trovata) break;
    if (c.esclusa) {
      const data = c.esclusa.dal ? ` il ${c.esclusa.dal.slice(0, 10)}` : "";
      tentativi.push({
        credentialId: c.credentialId,
        nome: c.nome,
        esito: "esclusa",
        motivo: `Già fallita su questo apparato${data}: ${c.esclusa.errore}. Si rimette in gioco con «Prova».`,
        quando: c.esclusa.dal || ora(),
      });
      continue;
    }
    if (daEscludere.has(c.credentialId)) {
      tentativi.push({
        credentialId: c.credentialId,
        nome: c.nome,
        esito: "fermata",
        motivo: `Account già rifiutato ${TETTO_WINDOWS} volte in questo giro: non si riprova su altri host per non bloccarlo.`,
        quando: ora(),
      });
      continue;
    }
    if (conTetto && veri >= TETTO_WINDOWS) {
      tentativi.push({
        credentialId: c.credentialId,
        nome: c.nome,
        esito: "fermata",
        motivo: `Tetto di ${TETTO_WINDOWS} tentativi su Windows raggiunto: non si prova altro per non bloccare l'account.`,
        quando: ora(),
      });
      continue;
    }
    const decisione = shouldAttemptCredential({
      credType: tipi.get(c.credentialId) ?? "",
      // la ricerca WinRM l'ha chiesta chi la lancia: l'apparato è dichiarato Windows
      hasWindowsIndicator: proto === "winrm",
      backoffUntil: backoff.get(c.credentialId) ?? null,
      consecutiveFailures: 0,
      isMultihomedSecondary: false,
      nowIso: ora(),
    });
    if (!decisione.attempt) {
      tentativi.push({ credentialId: c.credentialId, nome: c.nome, esito: "fermata", motivo: decisione.reason ?? "Non provata", quando: ora() });
      continue;
    }

    let esito: EsitoProva;
    try {
      esito = await prova(c.credentialId);
    } catch (e) {
      esito = { ok: false, errore: e instanceof Error ? e.message : "Errore nella prova" };
    }
    if (esito.nonProvata && !esito.ok) {
      tentativi.push({ credentialId: c.credentialId, nome: c.nome, esito: "fermata", motivo: esito.errore || "Non provabile", quando: ora() });
      continue;
    }
    if (esito.trasporto && !esito.ok) {
      // L'host non risponde: nessuna traccia sulla credenziale, e inutile provare le altre.
      tentativi.push({
        credentialId: c.credentialId,
        nome: c.nome,
        esito: "fermata",
        motivo: `Host non raggiungibile: ${esito.errore || "nessuna risposta"}. La ricerca su questo host si ferma.`,
        quando: ora(),
      });
      break;
    }
    veri++;
    registraProva(hostId, c.credentialId, proto, porta, esito);
    if (esito.ok) {
      trovata = { credentialId: c.credentialId, nome: c.nome };
      tentativi.push({ credentialId: c.credentialId, nome: c.nome, esito: "riuscita", motivo: null, quando: ora() });
    } else {
      tentativi.push({ credentialId: c.credentialId, nome: c.nome, esito: "rifiutata", motivo: esito.errore || "Autenticazione non riuscita", quando: ora() });
    }
  }
  return { hostId, trovata, tentativi };
}
