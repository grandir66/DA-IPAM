/**
 * Credenziali delle patch (WinRM) e del terminale (SSH) per un host del tenant.
 *
 * Dalla tappa 2 credenziali (T9, 16/10) le sceglie il motore unico
 * (`scegliSegretoHostDb`), sulle stesse fonti di prima: le righe
 * `host_credentials` dell'host (validate, poi non validate, per sort_order e
 * id) e, solo per WinRM, l'account WinRM della prima integrazione AD attiva
 * (D4, porta 5985). Niente catena di rete e niente binding dell'apparato
 * collegato: le patch non li hanno mai letti, e aggiungerli cambierebbe la
 * credenziale di patch degli host Windows con un binding WinRM. Cambia quello
 * che il motore aggiunge a tutte le scelte: una riga in fermo (`backoff_until`
 * futuro) si salta, una voce di tipo sbagliato per il protocollo si salta, una
 * voce che non si legge passa alla successiva, e la scelta dice la sua fonte
 * (`ad_fallback` per l'account dell'AD).
 *
 * `hostConCredenzialeWinrmDb` dà la stessa regola in una query sola, per le
 * pagine patch che mostrano «WinRM disponibile» su un elenco di host.
 *
 * SSH a chiave (T14, D6 = (a)): l'installazione via SSH passa dal ponte
 * paramiko e il terminale web non usa la chiave. Se il motore sceglie una voce
 * a chiave, `caricaSshPerHost` lo dice col percorso («Credenziale a chiave non
 * supportata dal terminale SSH…»), senza ripiegare su un'altra voce.
 *
 * Anti-pattern evitati:
 *  - NIENTE `decrypt()` raw: i segreti li legge `segreti.ts` con `safeDecrypt`.
 *  - NIENTE log della password, e nessuna password nei messaggi d'errore.
 */

import type { Database } from "better-sqlite3";
import { getAdRealm } from "@/lib/db";
import {
  scegliSegretoHostDb,
  type OpzioniMotore,
  type ResolvedCredentialSource,
  type SceltaSegreto,
} from "@/lib/credentials/resolve";
import { DEFAULT_PORTS } from "@/lib/credentials/porte";
import { tipiPerProtocollo } from "@/lib/credentials/tipi";
import { chiaveNonSupportata, nomeVoceDb } from "@/lib/credentials/segreti";
import { vaultOpenBaoAcceso } from "@/lib/vault/stato";
import type { WinrmCredentialsResolved } from "./types";

/** Le fonti delle patch e del terminale: righe host, poi l'account WinRM dell'AD. */
export const FONTI_PATCH: readonly ResolvedCredentialSource[] = Object.freeze([
  "host_validated",
  "host_unvalidated",
  "ad_fallback",
] as const);

type HostPatch = { ip: string | null; network_id: number };

function leggiHost(db: Database, hostId: number): HostPatch | undefined {
  return db.prepare(`SELECT ip, network_id FROM hosts WHERE id = ?`).get(hostId) as HostPatch | undefined;
}

function sceltaPatch(
  db: Database,
  hostId: number,
  protocol: "winrm" | "ssh",
  opts: Pick<OpzioniMotore, "registra">
): SceltaSegreto {
  const h = leggiHost(db, hostId);
  if (!h) return { ok: false, motivo: `L'host #${hostId} non esiste` };
  const s = scegliSegretoHostDb(db, { hostId, ip: h.ip ?? undefined, networkId: h.network_id }, protocol, {
    fonti: FONTI_PATCH,
    conAdFallback: protocol === "winrm",
    registra: opts.registra,
  });
  // Per l'SSH passa anche la chiave: chi la riceve (caricaSshPerHost) dice se il suo percorso la usa.
  if (s.ok && s.segreto.forma !== "utente" && !(protocol === "ssh" && s.segreto.forma === "chiave_ssh")) {
    return { ok: false, motivo: `La credenziale scelta per l'host ${h.ip ?? `#${hostId}`} non ha utente e password` };
  }
  return s;
}

/**
 * La scelta WinRM delle patch per un host, col candidato e la sua fonte. La
 * usano `loadWinrmCredentialsForHost` e la fotografia (con `registra: false`).
 */
export function sceltaWinrmPatchDb(db: Database, hostId: number, opts: Pick<OpzioniMotore, "registra"> = {}): SceltaSegreto {
  return sceltaPatch(db, hostId, "winrm", opts);
}

/** Come `sceltaWinrmPatchDb`, per l'SSH del terminale e dell'installazione su Linux/macOS. */
export function sceltaSshPatchDb(db: Database, hostId: number, opts: Pick<OpzioniMotore, "registra"> = {}): SceltaSegreto {
  return sceltaPatch(db, hostId, "ssh", opts);
}

function utenteDi(s: SceltaSegreto): { username: string; password: string; port: number } | null {
  if (!s.ok || s.segreto.forma !== "utente") return null;
  return { username: s.segreto.username, password: s.segreto.password, port: s.candidato.port };
}

/**
 * La credenziale WinRM da usare per `hostId`, già decifrata (vedi testa del
 * file). `null` se l'host non esiste o non ha IP, o se nessuna fonte dà una
 * credenziale utilizzabile: il motivo va nel journal, senza segreti.
 */
export function loadWinrmCredentialsForHost(
  db: Database,
  hostId: number
): WinrmCredentialsResolved | null {
  const h = leggiHost(db, hostId);
  if (!h) return null;
  if (!h.ip) {
    console.error(`[patch/credentials] Host ${hostId} senza IP, impossibile WinRM`);
    return null;
  }
  const s = sceltaWinrmPatchDb(db, hostId);
  const c = utenteDi(s);
  if (!c) {
    console.warn(`[patch/credentials] Nessuna credenziale WinRM per l'host ${hostId}: ${s.ok ? "forma non valida" : s.motivo}`);
    return null;
  }

  // Realm AD viene dalla config hub (non tenant). Può essere null in ambienti
  // senza dominio: in quel caso runWinrmCommand userà NTLM/Basic.
  let realm: string | null = null;
  try {
    const adInfo = getAdRealm();
    realm = adInfo?.realm ?? null;
  } catch (err) {
    console.warn(
      "[patch/credentials] getAdRealm() ha lanciato, proseguo senza realm:",
      (err as Error).message
    );
    realm = null;
  }

  return { host: h.ip, port: c.port, username: c.username, password: c.password, realm };
}

export interface SshCredentialsResolved {
  host: string;
  port: number;
  username: string;
  password: string;
}

export type EsitoSshHost = { ok: true; creds: SshCredentialsResolved } | { ok: false; motivo: string };

/**
 * La credenziale SSH da usare per `hostId`, già decifrata (push install su
 * Linux/macOS, terminale SSH): righe host `ssh` (voci `ssh` o `linux`), senza
 * ripiego AD. Al posto di `loadSshCredentialsForHost`, che dava `null` senza
 * dire perché: il rifiuto dice se l'host non ha IP, se nessuna riga dà una
 * credenziale, o se la voce scelta è a chiave e `percorso` non la usa (D6;
 * `percorso` comincia con la preposizione: «dal terminale SSH»).
 */
export function caricaSshPerHost(db: Database, hostId: number, percorso: string): EsitoSshHost {
  const h = leggiHost(db, hostId);
  if (!h) return { ok: false, motivo: `L'host #${hostId} non esiste` };
  if (!h.ip) return { ok: false, motivo: `L'host #${hostId} non ha un indirizzo IP` };
  const s = sceltaSshPatchDb(db, hostId);
  if (!s.ok) return s;
  if (s.segreto.forma === "chiave_ssh") return { ok: false, motivo: chiaveNonSupportata(percorso, nomeVoceDb(db, s.candidato.credential_id)) };
  const c = utenteDi(s);
  if (!c) return { ok: false, motivo: `La credenziale scelta per l'host ${h.ip} non ha utente e password` };
  return { ok: true, creds: { host: h.ip, port: c.port || DEFAULT_PORTS.ssh, username: c.username, password: c.password } };
}

/**
 * Gli host con una credenziale WinRM per le patch, con la regola di
 * `loadWinrmCredentialsForHost` in una query sola (le pagine patch la chiamano
 * una volta per elenco, non riga per riga: regola 6, niente N+1):
 * - una riga WinRM dell'host fuori fermo, su una voce del tipo giusto
 *   (`tipiPerProtocollo("winrm")`) con utente e password;
 * - oppure l'account WinRM della prima integrazione AD attiva (per id), se è
 *   del tipo giusto con utente e password e l'host non ha una riga in fermo su
 *   quella voce alla 5985.
 * Solo host con un IP. Che il segreto si decifri lo scopre il loader, non la
 * query.
 */
export function hostConCredenzialeWinrmDb(db: Database): Set<number> {
  const tipi = tipiPerProtocollo("winrm");
  const inTipi = tipi.map(() => "?").join(",");
  const adesso = new Date().toISOString();
  // da-vault: con OpenBao acceso una voce con il riferimento ha le colonne vuote e i segreti in OpenBao; "ha utente e
  // password" lo dice il riferimento (che la voce si legga davvero lo scopre il loader, come per le colonne). Spento
  // (o schema senza la colonna) la regola è quella di prima (le parentesi in più non cambiano il risultato).
  const conRiferimento =
    vaultOpenBaoAcceso() && (db.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).some((c) => c.name === "credential_ref");
  const voceBuona = (a: string): string =>
    `${a}.credential_type IN (${inTipi}) AND (` +
    `(COALESCE(${a}.encrypted_username, '') != '' AND COALESCE(${a}.encrypted_password, '') != '')` +
    (conRiferimento ? ` OR trim(COALESCE(${a}.credential_ref, '')) != ''` : "") +
    ")";
  const righe = db
    .prepare(
      `WITH ad AS (
         SELECT c.id AS cid
           FROM ad_integrations ai
           JOIN credentials c ON c.id = ai.winrm_credential_id
          WHERE ai.id = (SELECT a2.id FROM ad_integrations a2
                          WHERE a2.enabled = 1 AND a2.winrm_credential_id IS NOT NULL
                          ORDER BY a2.id ASC LIMIT 1)
            AND ${voceBuona("c")}
       )
       SELECT h.id FROM hosts h
        WHERE COALESCE(h.ip, '') != ''
          AND (
            EXISTS (SELECT 1 FROM host_credentials hc
                      JOIN credentials c ON c.id = hc.credential_id
                     WHERE hc.host_id = h.id AND hc.protocol_type = 'winrm'
                       AND (hc.backoff_until IS NULL OR hc.backoff_until <= ?)
                       AND ${voceBuona("c")})
            OR EXISTS (SELECT 1 FROM ad
                        WHERE NOT EXISTS (SELECT 1 FROM host_credentials hc
                                           WHERE hc.host_id = h.id AND hc.protocol_type = 'winrm'
                                             AND hc.credential_id = ad.cid AND hc.port = ?
                                             AND hc.backoff_until > ?))
          )`
    )
    .all(...tipi, adesso, ...tipi, DEFAULT_PORTS.winrm, adesso) as Array<{ id: number }>;
  return new Set(righe.map((r) => r.id));
}
