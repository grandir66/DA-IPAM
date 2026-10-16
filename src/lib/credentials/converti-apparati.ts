/**
 * Tappa 2e credenziali (T19): le credenziali degli apparati nell'archivio.
 *
 * Prima della 2e un apparato aveva, oltre ai binding d'archivio, due posti per
 * le credenziali che la pagina non mostra come voci:
 * - i binding inline: utente e segreto scritti dentro il binding, senza voce;
 * - le colonne di `network_devices`: `credential_id`, `snmp_credential_id`,
 *   `username` + `encrypted_password`, `community_string`, `api_token`. Per 6
 *   apparati in H1 e 1 in A sono l'unico accesso, e la 2g smetterà di
 *   leggerle.
 * Qui, in una transazione, con un SAVEPOINT per apparato:
 * - ogni binding inline diventa una voce `«<nome> · <protocollo>»` (tipo dal
 *   protocollo, utente cifrato, segreto cifrato copiato com'è) e il binding la
 *   punta, con stato, data, ordine, porta e `auto_detected` di prima;
 * - ogni colonna senza un binding equivalente diventa un binding non provato in
 *   coda al suo protocollo (voce nuova per utente/password, community e token).
 *   SNMP mai su `device.port` (F3); una voce che non vale per il protocollo
 *   principale va sul protocollo del suo tipo, ed è elencata (F2);
 * - le colonne dell'apparato si svuotano, così il motore non ripiega su una
 *   colonna invisibile e una voce non resta «in uso» per lei (D8);
 * - controllo: per il login e per SNMP (e per ogni protocollo toccato) la
 *   scelta dell'acquisizione si calcola prima, con le fonti di prima della
 *   2g, e dopo, col motore della 2g (solo l'archivio), senza registrare
 *   ripieghi: porta e segreto (confrontati in memoria, mai stampati) devono
 *   restare uguali. Altrimenti, o con una forma che la conversione non
 *   tratta, l'apparato torna com'era (ROLLBACK al suo SAVEPOINT) e va in
 *   `lasciati` col motivo: il segno dirà `parziale:`.
 *
 * Dalla 2g (T26) il motore non legge più binding inline e colonne: la scelta
 * di prima la ricostruisce questo modulo, che gli passa quelle fonti con
 * `fontiVecchie` (`opzioniDiPrima`), nell'ordine e con le regole del codice
 * di prima. Serve ancora: un bundle di prima della 2e, o un'appliance che
 * riceve `main` da prima della 2e, arriva qui coi dati vecchi. Senza, ogni
 * apparato con le sole colonne risulterebbe «prima: nessuna» e finirebbe fra
 * i lasciati, cioè senza accesso. Un lasciato (sull'hub due, accettati da
 * Riccardo il 16/10: binding fallito verso la voce della colonna) ha, col
 * motore della 2g, la scelta «nessuna» finché una prova non riesce.
 * Alla fine: nessun binding inline fuori dai lasciati, e `foreign_key_check`
 * dei binding non peggiore di prima, altrimenti ROLLBACK di tutto.
 *
 * Col segno `done:` o `parziale:` non si richiama: un binding che l'utente
 * toglie non deve tornare da una colonna riscritta dal codice di prima.
 *
 * Modulo con l'handle: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import type { NetworkDevice } from "@/types";
import { creaCredenzialeDb } from "./archivio";
import { DEFAULT_PORTS, type CredProtocol } from "./porte";
import {
  credenzialeSnmpApparatoDb,
  FONTI_ACQUISIZIONE,
  scegliSegretoApparatoDb,
  sceltaLoginApparatoDb,
  voceSnmpV3Db,
  type CandidatoVecchio,
  type FontiVecchie,
  type LetturaCandidato,
  type OpzioniMotore,
  type ResolvedCredentialSource,
} from "./resolve";
import { leggiSegretoDb, leggiSegretoInline, type Segreto, type UsoSegreto } from "./segreti";
import { etichettaTipo, normalizzaTipo, portaVoceValePer, TIPI_D_ACCESSO, tipiPerProtocollo, type TipoCredenziale } from "./tipi";

export type ColonnaApparato = "credential_id" | "snmp_credential_id" | "username" | "encrypted_password" | "community_string" | "api_token";

/** Le colonne delle credenziali di `network_devices`, nell'ordine in cui si elencano. */
export const COLONNE_APPARATO: readonly ColonnaApparato[] = [
  "credential_id",
  "snmp_credential_id",
  "username",
  "encrypted_password",
  "community_string",
  "api_token",
];

export interface EsitoApparati {
  /**
   * Binding nati dalle colonne. `colonna` dice da quale (o quali, con «+»);
   * `fuoriProtocollo`: la voce non vale per il protocollo principale e il
   * binding è sul protocollo del suo tipo (F2).
   */
  bindingDaColonne: Array<{ device_id: number; protocollo: CredProtocol; credential_id: number; porta: number; colonna: string; fuoriProtocollo: boolean }>;
  vociNuove: Array<{ id: number; nome: string; tipo: TipoCredenziale; device_id: number; da: "inline" | "colonne" }>;
  colonneSvuotate: Array<{ device_id: number; colonne: string[] }>;
  /** Binding inline rimasti fuori dagli apparati lasciati: 0, altrimenti la conversione si annulla. */
  inlineRimasti: number;
  lasciati: Array<{ device_id: number; motivo: string }>;
}

/** Formato di `encrypt()`: iv:tag:testo, in esadecimale. */
const FORMATO_CIFRATO = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;

const NOME_PROTOCOLLO: Record<CredProtocol, string> = {
  ssh: "SSH",
  snmp: "SNMP",
  winrm: "WinRM",
  api: "API",
  redfish: "Redfish",
  onvif: "ONVIF",
};

const NOME_FONTE: Partial<Record<ResolvedCredentialSource, string>> = {
  device_binding: "binding d'archivio",
  snmp_ripiego: "«public»",
};

/** Un apparato che si lascia com'era: la sua transazione si annulla (SAVEPOINT) e il motivo va in `lasciati`. */
class Lasciato extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
  }
}

/** Fine della prova a vuoto: annulla tutto, l'esito resta. */
class FineAVuoto extends Error {}

type Riga = Record<string, unknown>;

interface Apparato {
  id: number;
  name: string;
  protocol: string | null;
  port: number | null;
  credential_id: number | null;
  snmp_credential_id: number | null;
  username: string | null;
  encrypted_password: string | null;
  community_string: string | null;
  api_token: string | null;
  riga: Riga;
}

interface RigaBinding {
  id: number;
  credential_id: number | null;
  protocol_type: string;
  port: number;
  inline_username: string | null;
  inline_encrypted_password: string | null;
}

interface Voce {
  id: number;
  credential_type: string;
  port: number | null;
}

/** Una voce da creare: le colonne cifrate, il tipo e (per il token) il metodo. */
interface VoceDaCreare {
  tipo: TipoCredenziale;
  auth_method: string | null;
  encrypted_username: string | null;
  encrypted_password: string;
  port: number | null;
}

interface BindingDaColonna {
  protocollo: CredProtocol;
  porta: number;
  /** Voce esistente (colonna con un id), oppure una voce da creare. */
  credential_id: number | null;
  voce: VoceDaCreare | null;
  colonna: string;
  fuoriProtocollo: boolean;
}

function testo(r: Riga, k: string): string | null {
  return typeof r[k] === "string" ? (r[k] as string) : null;
}

function numero(r: Riga, k: string): number | null {
  return typeof r[k] === "number" ? (r[k] as number) : null;
}

function haTesto(v: string | null): v is string {
  return v != null && v.trim() !== "";
}

function apparatoDa(r: Riga): Apparato {
  const id = numero(r, "id") ?? 0;
  return {
    id,
    name: testo(r, "name") ?? `#${id}`,
    protocol: testo(r, "protocol"),
    port: numero(r, "port"),
    credential_id: numero(r, "credential_id"),
    snmp_credential_id: numero(r, "snmp_credential_id"),
    username: testo(r, "username"),
    encrypted_password: testo(r, "encrypted_password"),
    community_string: testo(r, "community_string"),
    api_token: testo(r, "api_token"),
    riga: r,
  };
}

/** Protocollo principale dell'apparato nel vocabolario delle credenziali (come il motore). */
function protocolloPrincipale(p: string | null): CredProtocol | null {
  if (p === "ssh" || p === "winrm" || p === "api") return p;
  if (p === "snmp_v2" || p === "snmp_v3") return "snmp";
  return null;
}

/** Protocollo delle colonne di login (getDeviceCredentials, come il motore). */
function protocolloLogin(p: string | null): CredProtocol {
  return p === "winrm" ? "winrm" : p === "api" ? "api" : "ssh";
}

function protocolloBinding(p: string): CredProtocol {
  if (p === "ssh" || p === "snmp" || p === "winrm" || p === "api" || p === "redfish" || p === "onvif") return p;
  throw new Error(`protocollo di binding sconosciuto: «${p}»`);
}

/** Tipo d'archivio della voce che nasce da un binding o da colonne di quel protocollo. */
function tipoPerProtocollo(p: CredProtocol): TipoCredenziale {
  if (p === "snmp") return "snmp";
  if (p === "winrm") return "windows";
  if (p === "ssh") return "ssh";
  return "api";
}

/** Protocollo su cui una voce lavora da sé (F2: una `windows` va su WinRM). */
function protocolloDelTipo(t: TipoCredenziale): CredProtocol | null {
  if (t === "ssh") return "ssh";
  if (t === "windows") return "winrm";
  if (t === "api") return "api";
  if (t === "snmp" || t === "snmp_v3") return "snmp";
  return null;
}

function usoPer(p: CredProtocol): UsoSegreto {
  return p === "ssh" || p === "winrm" || p === "snmp" ? p : "api";
}

/** Il segreto cifrato com'è; uno in chiaro si cifra. */
function cifrato(v: string): string {
  return FORMATO_CIFRATO.test(v) ? v : encrypt(v);
}

/** JSON con le chiavi in ordine: due segreti uguali danno lo stesso testo. Resta in memoria. */
function canonico(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x
  );
}

// ── Il controllo: la scelta prima e dopo ──────────────────────────────────

interface Scelta {
  /** Porta e segreto: solo in memoria, per il confronto. */
  chiave: string;
  /** Fonte, voce e porta: va nel motivo, mai il segreto. */
  testo: string;
}

const NESSUNA: Scelta = { chiave: "nessuna", testo: "nessuna" };

function descriviScelta(fonte: ResolvedCredentialSource, etichetta: string | undefined, credentialId: number | null, porta: number): string {
  return `${etichetta ?? NOME_FONTE[fonte] ?? fonte}${credentialId != null ? ` #${credentialId}` : ""} porta ${porta}`;
}

// ── Le fonti di prima della 2g ─────────────────────────────────────────────

/** Le colonne con una voce, nell'ordine del codice di prima: per SNMP, con un apparato SNMP, prima `credential_id`. */
function colonneVoce(app: Apparato, protocollo: CredProtocol): number[] {
  if (protocollo !== "snmp") return app.credential_id != null ? [app.credential_id] : [];
  const ids = protocolloPrincipale(app.protocol) === "snmp" ? [app.credential_id, app.snmp_credential_id] : [app.snmp_credential_id, app.credential_id];
  return ids.filter((id): id is number => id != null);
}

/**
 * Il segreto delle colonne dell'apparato, come lo leggeva il motore di prima:
 * la community scritta in chiaro prima della cifratura vale com'è; una
 * cifrata che non si decifra è un rifiuto, non una community.
 */
function leggiColonneInline(app: Apparato, protocollo: CredProtocol): LetturaCandidato {
  const chi = `L'apparato «${app.name}»`;
  if (protocollo === "snmp") {
    const grezzo = app.community_string ?? "";
    const chiaro = safeDecrypt(grezzo);
    if (chiaro != null) {
      return chiaro.trim() ? { ok: true, segreto: { forma: "community", community: chiaro } } : { ok: false, motivo: `${chi} ha la community vuota` };
    }
    if (FORMATO_CIFRATO.test(grezzo)) {
      return { ok: false, motivo: `${chi}: la community non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrata?)` };
    }
    return { ok: true, segreto: { forma: "community", community: grezzo } };
  }
  const password = safeDecrypt(app.encrypted_password ?? "");
  if (!password) return { ok: false, motivo: `${chi}: la password nelle colonne non si decifra` };
  return { ok: true, segreto: { forma: "utente", username: app.username ?? "", password } };
}

function daEsito(e: ReturnType<typeof leggiSegretoDb>): LetturaCandidato {
  return e.ok ? { ok: true, segreto: e.segreto, formatoVecchio: e.formatoVecchio === true } : { ok: false, motivo: e.motivo };
}

/**
 * Le fonti che il motore leggeva prima della 2g dopo i binding d'archivio,
 * nello stesso ordine: binding inline non falliti, colonne con una voce (col
 * filtro di tipo), colonne col segreto (utente e password per il protocollo
 * di login, community per SNMP). L'apparato è la riga letta prima di
 * scrivere.
 */
function fontiVecchieDi(db: Database.Database, app: Apparato): FontiVecchie {
  const inline = db
    .prepare(
      `SELECT id, protocol_type, port, test_status, inline_username, inline_encrypted_password
       FROM device_credential_bindings
       WHERE device_id = ? AND credential_id IS NULL AND test_status != 'failed'
       ORDER BY sort_order ASC, id ASC`
    )
    .all(app.id) as Array<{ id: number; protocol_type: string; port: number; test_status: string; inline_username: string | null; inline_encrypted_password: string | null }>;
  const tipoDi = db.prepare("SELECT credential_type, port FROM credentials WHERE id = ?");
  return {
    conV3: colonneVoce(app, "snmp").some((id) => voceSnmpV3Db(db, id)),
    candidati: (protocollo: CredProtocol): CandidatoVecchio[] => {
      const out: CandidatoVecchio[] = [];
      for (const b of inline) {
        if (b.protocol_type !== protocollo) continue;
        out.push({
          etichetta: "binding inline",
          credential_id: null,
          binding_id: b.id,
          tipo: null,
          porta: b.port,
          validated: b.test_status === "success",
          leggi: () => {
            const e = leggiSegretoInline(b);
            return e.ok ? { ok: true, segreto: e.segreto } : { ok: false, motivo: e.motivo };
          },
        });
      }
      const tipi = tipiPerProtocollo(protocollo);
      const apparatoV3 = protocollo === "snmp" && app.protocol === "snmp_v3";
      for (const id of colonneVoce(app, protocollo)) {
        const v = tipoDi.get(id) as { credential_type: string; port: number | null } | undefined;
        if (!v || !tipi.includes(v.credential_type)) continue;
        out.push({
          etichetta: "colonna con la voce",
          credential_id: id,
          binding_id: null,
          tipo: v.credential_type,
          porta: portaVoceValePer(v.credential_type, protocollo) && v.port != null ? v.port : DEFAULT_PORTS[protocollo],
          validated: false,
          leggi: () => daEsito(leggiSegretoDb(db, id, usoPer(protocollo), { apparatoV3 })),
        });
      }
      const colonneInline =
        protocollo === "snmp"
          ? haTesto(app.community_string)
          : protocollo === protocolloLogin(app.protocol) && haTesto(app.username) && haTesto(app.encrypted_password);
      if (colonneInline) {
        out.push({
          etichetta: "colonne col segreto",
          credential_id: null,
          binding_id: null,
          tipo: null,
          porta: DEFAULT_PORTS[protocollo],
          validated: false,
          leggi: () => leggiColonneInline(app, protocollo),
        });
      }
      return out;
    },
  };
}

/** Le opzioni del motore che ricostruiscono la scelta del codice di prima della 2g per un apparato. */
function opzioniDiPrimaPer(db: Database.Database, app: Apparato): Pick<OpzioniMotore, "fonti" | "fontiVecchie"> {
  return { fonti: [...FONTI_ACQUISIZIONE, "fonte_vecchia"], fontiVecchie: fontiVecchieDi(db, app) };
}

/**
 * La stessa cosa per un apparato salvato, letto dal DB: per le prove e per
 * chi deve confrontare la scelta di prima con quella della 2g. Apparato che
 * non c'è → le fonti dell'acquisizione, senza fonti vecchie.
 */
export function opzioniDiPrima(db: Database.Database, deviceId: number): Pick<OpzioniMotore, "fonti" | "fontiVecchie"> {
  const r = db.prepare("SELECT * FROM network_devices WHERE id = ?").get(deviceId) as Riga | undefined;
  return r ? opzioniDiPrimaPer(db, apparatoDa(r)) : { fonti: FONTI_ACQUISIZIONE };
}

/**
 * La scelta dell'acquisizione per un protocollo: il login con le regole di
 * getDeviceCredentials, SNMP con quelle di credenzialeSnmpApparato, gli altri
 * col motore per apparato. Sempre senza registrare. `prima`: con le fonti di
 * prima della 2g (`opzioniDiPrimaPer`); altrimenti il motore della 2g.
 */
function scelta(db: Database.Database, app: Apparato, protocollo: CredProtocol, prima: boolean): Scelta {
  const dev = app.riga as unknown as NetworkDevice;
  const fonti = prima ? opzioniDiPrimaPer(db, app) : { fonti: FONTI_ACQUISIZIONE };
  if (protocollo === "snmp") {
    const c = credenzialeSnmpApparatoDb(db, dev, { registra: false, ...fonti });
    return c.ok ? { chiave: canonico({ porta: c.port, cred: c.cred }), testo: descriviScelta(c.fonte, c.etichetta, c.credential_id, c.port) } : NESSUNA;
  }
  const s =
    protocollo === protocolloLogin(app.protocol)
      ? sceltaLoginApparatoDb(db, dev, { registra: false, ...fonti })
      : scegliSegretoApparatoDb(db, app.id, protocollo, { registra: false, ...fonti });
  if (!s.ok) return NESSUNA;
  const segreto: Segreto = s.segreto;
  return {
    chiave: canonico({ porta: s.candidato.port, segreto }),
    testo: descriviScelta(s.candidato.source, s.candidato.etichetta, s.candidato.credential_id, s.candidato.port),
  };
}

// ── Un apparato ────────────────────────────────────────────────────────────

interface Contesto {
  /** Nomi già nell'archivio (e quelli nati negli apparati convertiti prima). */
  nomi: Set<string>;
  leggiBinding: Database.Statement;
  leggiVoce: Database.Statement;
  maxOrdine: Database.Statement;
  puntaVoce: Database.Statement;
  nuovoBinding: Database.Statement;
  colonne: readonly ColonnaApparato[];
}

/**
 * Converte un apparato dentro il suo SAVEPOINT. Una forma che non tratta, o
 * una scelta che cambierebbe, lancia `Lasciato`: chi chiama annulla.
 */
function convertiApparato(db: Database.Database, app: Apparato, c: Contesto, nomiNuovi: Set<string>, out: EsitoApparati): void {
  const principale = protocolloPrincipale(app.protocol);
  const login = protocolloLogin(app.protocol);
  const binding = c.leggiBinding.all(app.id) as RigaBinding[];
  const bindingDi = (p: CredProtocol) => binding.filter((b) => b.protocol_type === p);
  const svuota = new Set<ColonnaApparato>();
  const nuovi: BindingDaColonna[] = [];

  // ── Il piano, senza scrivere ──

  // Binding inline: completi o lasciati.
  const inline = binding.filter((b) => b.credential_id == null);
  for (const b of inline) {
    const p = protocolloBinding(b.protocol_type);
    if (!haTesto(b.inline_encrypted_password)) {
      throw new Lasciato(`binding inline #${b.id} (${NOME_PROTOCOLLO[p]}) senza ${p === "snmp" ? "community" : "password"}`);
    }
    if (p !== "snmp" && !haTesto(b.inline_username)) throw new Lasciato(`binding inline #${b.id} (${NOME_PROTOCOLLO[p]}) senza utente`);
  }

  // Il segreto di un binding (d'archivio o inline) per un protocollo: per gli equivalenti, in memoria.
  const segretoDi = (b: RigaBinding, p: CredProtocol): Segreto | null => {
    const e = b.credential_id != null ? leggiSegretoDb(db, b.credential_id, usoPer(p)) : leggiSegretoInline(b);
    return e.ok ? e.segreto : null;
  };
  const voce = (id: number, colonna: ColonnaApparato): Voce => {
    const v = c.leggiVoce.get(id) as Voce | undefined;
    if (!v) throw new Lasciato(`${colonna} punta alla voce #${id}, che non esiste`);
    return v;
  };

  // Colonne con una voce SNMP, nell'ordine del motore: con protocollo SNMP prima credential_id.
  const ordineSnmp: Array<"credential_id" | "snmp_credential_id"> =
    principale === "snmp" ? ["credential_id", "snmp_credential_id"] : ["snmp_credential_id", "credential_id"];
  const snmpDaColonna = new Map<number, BindingDaColonna | null>();
  for (const col of ordineSnmp) {
    const id = app[col];
    if (id == null) continue;
    const v = voce(id, col);
    const tipo = normalizzaTipo(v.credential_type);
    if (tipo !== "snmp" && tipo !== "snmp_v3") {
      if (col === "snmp_credential_id") {
        throw new Lasciato(`snmp_credential_id punta alla voce #${id}, di tipo ${etichettaTipo(v.credential_type) || "sconosciuto"}: non vale per SNMP`);
      }
      continue;
    }
    svuota.add(col);
    if (snmpDaColonna.has(id)) {
      const gia = snmpDaColonna.get(id);
      if (gia) gia.colonna += `+${col}`;
      continue;
    }
    if (bindingDi("snmp").some((b) => b.credential_id === id)) {
      snmpDaColonna.set(id, null);
      continue;
    }
    const n: BindingDaColonna = {
      protocollo: "snmp",
      porta: portaVoceValePer(v.credential_type, "snmp") && v.port != null ? v.port : DEFAULT_PORTS.snmp,
      credential_id: id,
      voce: null,
      colonna: col,
      fuoriProtocollo: col === "credential_id" && principale !== "snmp",
    };
    snmpDaColonna.set(id, n);
    nuovi.push(n);
  }

  // credential_id con una voce non SNMP: protocollo principale se vale, altrimenti quello del suo tipo (F2).
  if (app.credential_id != null && !svuota.has("credential_id")) {
    const id = app.credential_id;
    const v = voce(id, "credential_id");
    const tipo = normalizzaTipo(v.credential_type);
    if (!tipo || !TIPI_D_ACCESSO.includes(tipo)) {
      throw new Lasciato(
        `credential_id punta alla voce #${id}, di tipo ${etichettaTipo(v.credential_type) || "sconosciuto"}: non vale per nessun protocollo dell'apparato`
      );
    }
    const vale = principale != null && principale !== "snmp" && tipiPerProtocollo(principale).includes(v.credential_type);
    const p = vale ? principale : protocolloDelTipo(tipo);
    if (!p) throw new Lasciato(`credential_id punta alla voce #${id}: nessun protocollo per il tipo ${etichettaTipo(v.credential_type)}`);
    svuota.add("credential_id");
    if (!bindingDi(p).some((b) => b.credential_id === id)) {
      const propria = portaVoceValePer(v.credential_type, p) && v.port != null ? v.port : DEFAULT_PORTS[p];
      nuovi.push({
        protocollo: p,
        porta: (p === principale ? app.port : null) ?? propria,
        credential_id: id,
        voce: null,
        colonna: "credential_id",
        fuoriProtocollo: !vale,
      });
    }
  }

  // Utente e password: sul protocollo di login, con un equivalente se uguali decifrati.
  const conUtente = haTesto(app.username);
  const conPassword = haTesto(app.encrypted_password);
  if (conUtente !== conPassword) {
    throw new Lasciato(conUtente ? "utente senza password nelle colonne" : "password senza utente nelle colonne");
  }
  if (conUtente && conPassword) {
    const utente = app.username as string;
    const password = safeDecrypt(app.encrypted_password as string);
    if (password == null) throw new Lasciato("la password nelle colonne non si decifra");
    const uguale = bindingDi(login).some((b) => {
      const s = segretoDi(b, login);
      return s?.forma === "utente" && s.username === utente && s.password === password;
    });
    if (!uguale) {
      nuovi.push({
        protocollo: login,
        porta: (login === principale ? app.port : null) ?? DEFAULT_PORTS[login],
        credential_id: null,
        voce: {
          tipo: tipoPerProtocollo(login),
          auth_method: null,
          encrypted_username: encrypt(utente),
          encrypted_password: app.encrypted_password as string,
          port: null,
        },
        colonna: "username+encrypted_password",
        fuoriProtocollo: false,
      });
    }
  }
  if (app.username != null) svuota.add("username");
  if (app.encrypted_password != null) svuota.add("encrypted_password");

  // Community: diventa una voce solo se l'apparato non ha nessuna fonte SNMP (un binding, o una colonna con una voce SNMP).
  if (haTesto(app.community_string)) {
    const grezza = app.community_string;
    const chiara = safeDecrypt(grezza);
    if (chiara == null && FORMATO_CIFRATO.test(grezza)) throw new Lasciato("la community nelle colonne non si decifra");
    const fonteSnmp = bindingDi("snmp").length > 0 || snmpDaColonna.size > 0;
    if (!fonteSnmp && (chiara ?? grezza).trim() !== "") {
      nuovi.push({
        protocollo: "snmp",
        porta: DEFAULT_PORTS.snmp,
        credential_id: null,
        voce: { tipo: "snmp", auth_method: null, encrypted_username: null, encrypted_password: cifrato(grezza), port: null },
        colonna: "community_string",
        fuoriProtocollo: false,
      });
    }
  }
  if (app.community_string != null) svuota.add("community_string");

  // Token API: voce `api` a token. Oggi lo legge solo Omada, e solo se si decifra.
  if (haTesto(app.api_token)) {
    const token = safeDecrypt(app.api_token);
    if (token == null) throw new Lasciato("il token API nelle colonne non si decifra");
    const uguale = bindingDi("api").some((b) => {
      const s = segretoDi(b, "api");
      return s?.forma === "token" && s.token === token;
    });
    if (!uguale && token.trim() !== "") {
      nuovi.push({
        protocollo: "api",
        porta: (principale === "api" ? app.port : null) ?? DEFAULT_PORTS.api,
        credential_id: null,
        voce: { tipo: "api", auth_method: "token", encrypted_username: null, encrypted_password: app.api_token, port: null },
        colonna: "api_token",
        fuoriProtocollo: false,
      });
    }
  }
  if (app.api_token != null) svuota.add("api_token");

  // ── La scelta prima ──
  const protocolli = new Set<CredProtocol>([login, "snmp"]);
  for (const b of inline) protocolli.add(protocolloBinding(b.protocol_type));
  for (const n of nuovi) protocolli.add(n.protocollo);
  const prima = new Map<CredProtocol, Scelta>();
  for (const p of protocolli) prima.set(p, scelta(db, app, p, true));

  // ── Le scritture ──
  const nomeVoce = (p: CredProtocol): string => {
    const base = `${app.name} · ${NOME_PROTOCOLLO[p]}`;
    const preso = (n: string) => c.nomi.has(n) || nomiNuovi.has(n);
    let nome = base;
    if (preso(nome)) nome = `${base} (apparato #${app.id})`;
    for (let i = 2; preso(nome); i++) nome = `${base} (apparato #${app.id}, ${i})`;
    nomiNuovi.add(nome);
    return nome;
  };
  const crea = (p: CredProtocol, v: VoceDaCreare, da: "inline" | "colonne"): number => {
    const nome = nomeVoce(p);
    const r = creaCredenzialeDb(db, {
      name: nome,
      credential_type: v.tipo,
      auth_method: v.auth_method,
      encrypted_username: v.encrypted_username,
      encrypted_password: v.encrypted_password,
      port: v.port,
    });
    out.vociNuove.push({ id: r.id, nome, tipo: v.tipo, device_id: app.id, da });
    return r.id;
  };

  // Un inline SNMP porta solo la community: un `inline_username` rimasto non
  // si copia. In una voce `snmp` senza livello, utente più segreto è il
  // formato v3 «vecchio», e su un apparato snmp_v3 cambierebbe la scelta.
  for (const b of inline) {
    const p = protocolloBinding(b.protocol_type);
    const id = crea(
      p,
      {
        tipo: tipoPerProtocollo(p),
        auth_method: null,
        encrypted_username: p === "snmp" ? null : encrypt(b.inline_username as string),
        encrypted_password: cifrato(b.inline_encrypted_password as string),
        port: b.port === DEFAULT_PORTS[p] ? null : b.port,
      },
      "inline"
    );
    c.puntaVoce.run(id, b.id);
  }

  const ordine = new Map<CredProtocol, number>();
  for (const n of nuovi) {
    const credentialId = n.voce ? crea(n.protocollo, n.voce, "colonne") : (n.credential_id as number);
    const prossimo = ordine.get(n.protocollo) ?? (c.maxOrdine.get(app.id, n.protocollo) as { m: number }).m + 1;
    ordine.set(n.protocollo, prossimo + 1);
    c.nuovoBinding.run(app.id, credentialId, n.protocollo, n.porta, prossimo);
    out.bindingDaColonne.push({
      device_id: app.id,
      protocollo: n.protocollo,
      credential_id: credentialId,
      porta: n.porta,
      colonna: n.colonna,
      fuoriProtocollo: n.fuoriProtocollo,
    });
  }

  const daSvuotare = c.colonne.filter((col) => svuota.has(col));
  if (daSvuotare.length > 0) {
    db.prepare(`UPDATE network_devices SET ${daSvuotare.map((col) => `${col} = NULL`).join(", ")} WHERE id = ?`).run(app.id);
    out.colonneSvuotate.push({ device_id: app.id, colonne: daSvuotare });
  }

  // ── La scelta dopo, col motore della 2g (solo l'archivio) ──
  for (const p of protocolli) {
    const a = prima.get(p) as Scelta;
    const d = scelta(db, app, p, false);
    if (a.chiave !== d.chiave) {
      const nota = a.testo === d.testo ? " (segreto diverso)" : "";
      throw new Lasciato(`la scelta ${NOME_PROTOCOLLO[p]} cambierebbe: prima ${a.testo}, dopo ${d.testo}${nota}`);
    }
  }
}

// ── La conversione ─────────────────────────────────────────────────────────

function colonneDi(db: Database.Database, tabella: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).map((r) => r.name));
}

function violazioniBinding(db: Database.Database): number {
  return (db.pragma("foreign_key_check(device_credential_bindings)") as unknown[]).length;
}

/**
 * Con una ENCRYPTION_KEY assente o sbagliata ogni segreto «non si decifra»: gli
 * apparati finirebbero tutti in `lasciati` e il segno `parziale:` chiuderebbe
 * la conversione per sempre. Si ferma prima (errore:, si riprova).
 */
function controllaChiave(db: Database.Database, apparati: Apparato[]): void {
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    throw new Error("ENCRYPTION_KEY assente: le credenziali degli apparati non si convertono senza la chiave (si riprova alla prossima apertura)");
  }
  const cifrati: string[] = [];
  for (const a of apparati) {
    for (const v of [a.encrypted_password, a.community_string, a.api_token]) if (v && FORMATO_CIFRATO.test(v)) cifrati.push(v);
  }
  const inline = db
    .prepare("SELECT inline_encrypted_password AS v FROM device_credential_bindings WHERE credential_id IS NULL AND inline_encrypted_password IS NOT NULL")
    .all() as Array<{ v: string }>;
  for (const r of inline) if (FORMATO_CIFRATO.test(r.v)) cifrati.push(r.v);
  if (cifrati.length === 0) return;
  const voci = db.prepare("SELECT encrypted_password AS v FROM credentials WHERE encrypted_password IS NOT NULL LIMIT 50").all() as Array<{ v: string }>;
  const tutti = [...cifrati, ...voci.map((r) => r.v).filter((v) => FORMATO_CIFRATO.test(v))];
  if (!tutti.some((v) => safeDecrypt(v) !== null)) {
    throw new Error(
      `la ENCRYPTION_KEY non decifra nessuno dei ${tutti.length} segreti di apparati e voci (chiave sbagliata o ambiente non caricato): niente convertito, si riprova alla prossima apertura`
    );
  }
}

function converti(db: Database.Database, esito: EsitoApparati): void {
  const presenti = colonneDi(db, "network_devices");
  const colonne = COLONNE_APPARATO.filter((c) => presenti.has(c));
  const piene = colonne.map((c) => `${c} IS NOT NULL`).join(" OR ") || "0";
  const apparati = (
    db
      .prepare(
        `SELECT * FROM network_devices
         WHERE ${piene} OR id IN (SELECT device_id FROM device_credential_bindings WHERE credential_id IS NULL)
         ORDER BY id`
      )
      .all() as Riga[]
  ).map(apparatoDa);

  // Binding inline di apparati che non ci sono più (chiavi esterne spente): si lasciano.
  const orfani = db
    .prepare(
      `SELECT DISTINCT device_id FROM device_credential_bindings
       WHERE credential_id IS NULL AND device_id NOT IN (SELECT id FROM network_devices)
       ORDER BY device_id`
    )
    .all() as Array<{ device_id: number }>;
  for (const o of orfani) esito.lasciati.push({ device_id: o.device_id, motivo: "binding inline di un apparato che non esiste" });
  if (apparati.length === 0) return;

  controllaChiave(db, apparati);
  const fkPrima = violazioniBinding(db);
  const c: Contesto = {
    nomi: new Set((db.prepare("SELECT name FROM credentials").all() as Array<{ name: string }>).map((r) => r.name)),
    leggiBinding: db.prepare(
      `SELECT id, credential_id, protocol_type, port, inline_username, inline_encrypted_password
       FROM device_credential_bindings WHERE device_id = ? ORDER BY sort_order ASC, id ASC`
    ),
    leggiVoce: db.prepare("SELECT id, credential_type, port FROM credentials WHERE id = ?"),
    maxOrdine: db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM device_credential_bindings WHERE device_id = ? AND protocol_type = ?"),
    puntaVoce: db.prepare("UPDATE device_credential_bindings SET credential_id = ?, inline_username = NULL, inline_encrypted_password = NULL WHERE id = ?"),
    nuovoBinding: db.prepare(
      `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status, auto_detected)
       VALUES (?, ?, ?, ?, ?, 'untested', 0)`
    ),
    colonne,
  };

  for (const app of apparati) {
    const suo: EsitoApparati = { bindingDaColonne: [], vociNuove: [], colonneSvuotate: [], inlineRimasti: 0, lasciati: [] };
    const nomiNuovi = new Set<string>();
    try {
      // Una transazione annidata è un SAVEPOINT: se lancia, si annulla solo questo apparato.
      db.transaction(() => convertiApparato(db, app, c, nomiNuovi, suo))();
    } catch (e) {
      if (e instanceof Lasciato) {
        esito.lasciati.push({ device_id: app.id, motivo: e.motivo });
        continue;
      }
      throw e;
    }
    for (const n of nomiNuovi) c.nomi.add(n);
    esito.bindingDaColonne.push(...suo.bindingDaColonne);
    esito.vociNuove.push(...suo.vociNuove);
    esito.colonneSvuotate.push(...suo.colonneSvuotate);
  }

  const lasciati = new Set(esito.lasciati.map((l) => l.device_id));
  const rimasti = (db.prepare("SELECT device_id FROM device_credential_bindings WHERE credential_id IS NULL").all() as Array<{ device_id: number }>).filter(
    (r) => !lasciati.has(r.device_id)
  );
  esito.inlineRimasti = rimasti.length;
  if (rimasti.length > 0) {
    throw new Error(`${rimasti.length} binding inline rimasti fuori dagli apparati lasciati (apparati ${[...new Set(rimasti.map((r) => `#${r.device_id}`))].join(", ")})`);
  }
  const fkDopo = violazioniBinding(db);
  if (fkDopo > fkPrima) throw new Error(`violazioni delle chiavi esterne dei binding: ${fkPrima} → ${fkDopo}`);
}

/**
 * Converte binding inline e colonne degli apparati (vedi testa del file). Con
 * `aVuoto` fa tutto, controlli compresi, e poi annulla: l'esito è quello che
 * succederebbe. Lancia (e annulla tutto) su un guasto vero: chiave assente o
 * sbagliata, inline rimasti, chiavi esterne peggiorate, errori del DB.
 */
export function convertiCredenzialiApparati(db: Database.Database, opzioni: { aVuoto: boolean }): EsitoApparati {
  const esito: EsitoApparati = { bindingDaColonne: [], vociNuove: [], colonneSvuotate: [], inlineRimasti: 0, lasciati: [] };
  try {
    db.transaction(() => {
      converti(db, esito);
      if (opzioni.aVuoto) throw new FineAVuoto();
    })();
  } catch (e) {
    if (!(e instanceof FineAVuoto)) throw e;
  }
  return esito;
}

/** Valore del segno `credenziali_t2_apparati`: `parziale:` se un apparato è stato lasciato. */
export function segnoApparati(e: EsitoApparati, quando: Date = new Date()): string {
  const stato = e.lasciati.length > 0 ? "parziale" : "done";
  const conteggi = [
    `binding_colonne=${e.bindingDaColonne.length}`,
    `voci_nuove=${e.vociNuove.length}`,
    `da_inline=${e.vociNuove.filter((v) => v.da === "inline").length}`,
    `fuori_protocollo=${e.bindingDaColonne.filter((b) => b.fuoriProtocollo).length}`,
    `apparati_svuotati=${e.colonneSvuotate.length}`,
    `inline_rimasti=${e.inlineRimasti}`,
    `lasciati=${e.lasciati.length}`,
  ].join(",");
  return `${stato}:${quando.toISOString()}:${conteggi}`;
}

/** Una riga per il journal e per la risposta dell'import: per id, senza nomi né segreti. */
export function descriviApparati(e: EsitoApparati): string {
  // Elementi separati da «; »: colonne e motivi contengono già delle virgole.
  const elenco = (xs: string[]) => (xs.length > 0 ? ` [${xs.join("; ")}]` : "");
  const binding = e.bindingDaColonne.map(
    (b) => `apparato #${b.device_id} ${b.protocollo}/${b.porta} → #${b.credential_id} (${b.colonna}${b.fuoriProtocollo ? ", fuori protocollo" : ""})`
  );
  const voci = e.vociNuove.map((v) => `#${v.id} (apparato #${v.device_id}, ${v.da})`);
  const svuotate = e.colonneSvuotate.map((s) => `apparato #${s.device_id}: ${s.colonne.join(", ")}`);
  const lasciati = e.lasciati.map((l) => `apparato #${l.device_id}: ${l.motivo}`);
  return (
    `${e.bindingDaColonne.length} binding dalle colonne${elenco(binding)}, ${e.vociNuove.length} voci nuove${elenco(voci)}, ` +
    `colonne svuotate su ${e.colonneSvuotate.length} apparati${elenco(svuotate)}, inline rimasti ${e.inlineRimasti}, ` +
    `lasciati ${e.lasciati.length}${elenco(lasciati)}`
  );
}
