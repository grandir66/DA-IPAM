/**
 * Tappa 2f credenziali (T22): le credenziali di controller e AD nell'archivio.
 *
 * Prima della 2f un controller (`network_controllers`) teneva i segreti nella
 * sua riga (`username` in chiaro, `password_enc`, `api_key_enc`) e un'AD
 * (`ad_integrations`) l'account LDAP (`encrypted_username`,
 * `encrypted_password`): la pagina Credenziali non li vedeva e la 2g smetterà
 * di leggerli. Qui, in una transazione, ogni riga con `credential_id` NULL e un
 * segreto riceve una voce d'archivio e la punta:
 * - console UniFi OS (`udm`): con la chiave API → voce `unifi`/`chiave`
 *   (`encrypted_password` = `api_key_enc`); senza chiave, con utente locale e
 *   password (ADR 0019) → `unifi`/`utente`. Come il client di oggi
 *   (`validateUnifiOs` in `unifi-api.ts`): la chiave, se c'è, vince;
 * - self-hosted → `unifi`/`utente` (`encrypted_username` = utente cifrato,
 *   `encrypted_password` = `password_enc`); la chiave API non la legge
 *   nessuno, come oggi;
 * - AD → voce `ad`, utente e password cifrati copiati byte per byte;
 * - un valore in chiaro si cifra;
 * - nomi «UniFi · <nome>» e «AD · <nome>», con « (controller #id)» o
 *   « (AD #id)» se il nome c'è già.
 * Le colonne vecchie restano piene fino alla 2g: servono a tornare al codice
 * di prima. `winrm_credential_id` dell'AD non si tocca: in A la voce WinRM fa
 * da ripiego per le patch di 161 host, e resta quella.
 *
 * Controllo: per ogni riga si decifra in memoria il segreto delle colonne e
 * quello della voce appena scritta (`leggiSegretoDb`), e devono essere
 * uguali; altrimenti ROLLBACK di tutto. Fuori si dice solo «uguale» o
 * «diverso», mai il segreto.
 *
 * Forme non riconosciute: si lasciano come sono, in `lasciati` col motivo, e
 * il segno dice `parziale:`. Sono un segreto che non si decifra, un utente
 * senza password e simili, e Omada. Omada non si legge ancora e non ha un
 * formato dei segreti (client id e secret in quali colonne?): la regola del
 * piano «col metodo dai campi presenti» sarebbe un'ipotesi, e una voce
 * sbagliata durerebbe oltre la 2g. Con una ENCRYPTION_KEY assente o sbagliata
 * ogni segreto «non si decifrerebbe» e tutto finirebbe fra i lasciati, con un
 * `parziale:` che chiude la conversione per sempre: ci si ferma prima con un
 * errore (segno `errore:`, si riprova).
 *
 * Col segno `done:` o `parziale:` non si richiama (lo decide chi chiama):
 * con le colonne ancora piene, rigirarla ricreerebbe voci doppie, o
 * ricollegherebbe a una voce un controller spostato senza che nessuno l'abbia
 * scelta.
 *
 * Modulo con l'handle: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { creaCredenzialeDb } from "./archivio";
import { leggiSegretoDb, type Segreto, type UsoSegreto } from "./segreti";
import type { TipoCredenziale } from "./tipi";

export type TabellaIntegrazione = "network_controllers" | "ad_integrations";
export type MetodoController = "chiave" | "utente" | "client";

export interface EsitoIntegrazioni {
  controller: Array<{ id: number; voce: number; metodo: MetodoController }>;
  ad: Array<{ id: number; voce: number }>;
  lasciati: Array<{ tabella: TabellaIntegrazione; id: number; motivo: string }>;
}

/** Il confronto decifrato di una riga che punta una voce: per la prova a vuoto. */
export interface ConfrontoRiga {
  tabella: TabellaIntegrazione;
  id: number;
  voce: number;
  /** «colonne vuote»: la riga non ha più i segreti vecchi, non c'è niente da confrontare. */
  esito: "uguale" | "diverso" | "colonne vuote";
}

/** Formato di `encrypt()`: iv:tag:testo, in esadecimale. */
const FORMATO_CIFRATO = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;

/** Fine della prova a vuoto: annulla tutto, l'esito resta. */
class FineAVuoto extends Error {}

interface RigaController {
  id: number;
  name: string;
  kind: string;
  username: string | null;
  password_enc: string | null;
  api_key_enc: string | null;
}

interface RigaAd {
  id: number;
  name: string;
  encrypted_username: string | null;
  encrypted_password: string | null;
}

/** Quello che si scrive per una riga, e il segreto che la voce deve ridare. */
interface Piano {
  tabella: TabellaIntegrazione;
  id: number;
  nomeBase: string;
  suffisso: string;
  tipo: TipoCredenziale;
  metodo: MetodoController | null;
  uso: UsoSegreto;
  auth_method: string | null;
  encrypted_username: string | null;
  encrypted_password: string;
  /** Solo in memoria: mai stampato. */
  atteso: Segreto;
}

/** null: la riga non ha segreti, non c'è niente da portare. */
type Analisi = { piano: Piano } | { lasciato: string } | null;

type Chiaro = { ok: true; valore: string } | { ok: false };

/** Il valore come lo legge il codice di oggi: cifrato → decifrato; in chiaro → com'è; vuoto → "". */
function chiaro(v: string | null): Chiaro {
  if (v == null || v === "") return { ok: true, valore: "" };
  if (!FORMATO_CIFRATO.test(v)) return { ok: true, valore: v };
  const c = safeDecrypt(v);
  return c == null ? { ok: false } : { ok: true, valore: c };
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

function analizzaController(r: RigaController): Analisi {
  const chiave = r.api_key_enc ?? "";
  const password = r.password_enc ?? "";
  if (chiave === "" && password === "") return null;
  const utente = r.username ?? "";
  const base = { tabella: "network_controllers" as const, id: r.id, nomeBase: `UniFi · ${r.name}`, suffisso: ` (controller #${r.id})`, tipo: "unifi" as const, uso: "controller_unifi" as const };

  const conUtente = (): Analisi => {
    const p = chiaro(password);
    if (!p.ok) return { lasciato: "la password non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrata?)" };
    if (utente.trim() === "" || p.valore.trim() === "") return null;
    return {
      piano: {
        ...base,
        metodo: "utente",
        auth_method: "utente",
        encrypted_username: encrypt(utente),
        encrypted_password: cifrato(password),
        atteso: { forma: "utente", username: utente, password: p.valore },
      },
    };
  };

  if (r.kind === "udm") {
    const k = chiaro(chiave);
    if (!k.ok) return { lasciato: "la chiave API non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrata?)" };
    if (k.valore.trim() !== "") {
      return {
        piano: {
          ...base,
          metodo: "chiave",
          auth_method: "chiave",
          encrypted_username: null,
          encrypted_password: cifrato(chiave),
          atteso: { forma: "chiave_api", chiave: k.valore },
        },
      };
    }
    return conUtente() ?? { lasciato: "console UniFi OS senza chiave API e senza utente locale e password completi" };
  }
  if (r.kind === "self_hosted") {
    return conUtente() ?? { lasciato: "controller self-hosted senza utente e password completi (la chiave API non vale per questo tipo)" };
  }
  if (r.kind === "omada") {
    return { lasciato: "controller Omada: non si legge ancora e i suoi segreti non hanno un formato definito, quindi non si indovina il metodo" };
  }
  return { lasciato: `tipo di controller sconosciuto («${r.kind}»)` };
}

function analizzaAd(r: RigaAd): Analisi {
  const u0 = r.encrypted_username ?? "";
  const p0 = r.encrypted_password ?? "";
  if (u0 === "" && p0 === "") return null;
  const u = chiaro(u0);
  if (!u.ok) return { lasciato: "l'utente dell'account LDAP non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrato?)" };
  const p = chiaro(p0);
  if (!p.ok) return { lasciato: "la password dell'account LDAP non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrata?)" };
  if (u.valore.trim() === "" || p.valore.trim() === "") return { lasciato: "account LDAP senza utente o senza password" };
  return {
    piano: {
      tabella: "ad_integrations",
      id: r.id,
      nomeBase: `AD · ${r.name}`,
      suffisso: ` (AD #${r.id})`,
      tipo: "ad",
      metodo: null,
      uso: "ldap",
      auth_method: null,
      encrypted_username: cifrato(u0),
      encrypted_password: cifrato(p0),
      atteso: { forma: "utente", username: u.valore, password: p.valore },
    },
  };
}

function haColonna(db: Database.Database, tabella: string, colonna: string): boolean {
  return (db.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).some((c) => c.name === colonna);
}

const SEL_CONTROLLER = "SELECT id, name, kind, username, password_enc, api_key_enc FROM network_controllers";
const SEL_AD = "SELECT id, name, encrypted_username, encrypted_password FROM ad_integrations";

/** Le righe da convertire: `credential_id` NULL e almeno un segreto. Senza la colonna non si parte. */
function righeDaConvertire(db: Database.Database): { controller: RigaController[]; ad: RigaAd[] } {
  for (const t of ["network_controllers", "ad_integrations"]) {
    if (!haColonna(db, t, "credential_id")) {
      throw new Error(`${t}.credential_id non c'è (la colonna della 2f non è stata aggiunta): niente convertito, si riprova alla prossima apertura`);
    }
  }
  return {
    controller: db
      .prepare(`${SEL_CONTROLLER} WHERE credential_id IS NULL AND (COALESCE(password_enc, '') <> '' OR COALESCE(api_key_enc, '') <> '') ORDER BY id`)
      .all() as RigaController[],
    ad: db
      .prepare(`${SEL_AD} WHERE credential_id IS NULL AND (COALESCE(encrypted_username, '') <> '' OR COALESCE(encrypted_password, '') <> '') ORDER BY id`)
      .all() as RigaAd[],
  };
}

/**
 * Con una ENCRYPTION_KEY assente o sbagliata le righe finirebbero tutte fra i
 * lasciati e il segno `parziale:` chiuderebbe la conversione per sempre. Ci si
 * ferma prima (errore:, si riprova).
 */
function controllaChiave(db: Database.Database, righe: { controller: RigaController[]; ad: RigaAd[] }): void {
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    throw new Error("ENCRYPTION_KEY assente: le credenziali di controller e AD non si convertono senza la chiave (si riprova alla prossima apertura)");
  }
  const cifrati: string[] = [];
  for (const r of righe.controller) for (const v of [r.password_enc, r.api_key_enc]) if (v && FORMATO_CIFRATO.test(v)) cifrati.push(v);
  for (const r of righe.ad) for (const v of [r.encrypted_username, r.encrypted_password]) if (v && FORMATO_CIFRATO.test(v)) cifrati.push(v);
  if (cifrati.length === 0) return;
  const voci = db.prepare("SELECT encrypted_password AS v FROM credentials WHERE encrypted_password IS NOT NULL LIMIT 50").all() as Array<{ v: string }>;
  const tutti = [...cifrati, ...voci.map((r) => r.v).filter((v) => FORMATO_CIFRATO.test(v))];
  if (!tutti.some((v) => safeDecrypt(v) !== null)) {
    throw new Error(
      `la ENCRYPTION_KEY non decifra nessuno dei ${tutti.length} segreti di controller, AD e voci (chiave sbagliata o ambiente non caricato): niente convertito, si riprova alla prossima apertura`
    );
  }
}

function violazioni(db: Database.Database): number {
  return (db.pragma("foreign_key_check(network_controllers)") as unknown[]).length + (db.pragma("foreign_key_check(ad_integrations)") as unknown[]).length;
}

function etichetta(t: TabellaIntegrazione): string {
  return t === "network_controllers" ? "controller" : "AD";
}

/** Il segreto della voce, decifrato, è quello atteso dalle colonne? Solo in memoria. */
function uguale(db: Database.Database, voce: number, uso: UsoSegreto, atteso: Segreto): boolean {
  const e = leggiSegretoDb(db, voce, uso);
  return e.ok && canonico(e.segreto) === canonico(atteso);
}

function converti(db: Database.Database, esito: EsitoIntegrazioni): void {
  const righe = righeDaConvertire(db);
  if (righe.controller.length === 0 && righe.ad.length === 0) return;
  controllaChiave(db, righe);
  const fkPrima = violazioni(db);

  const piani: Piano[] = [];
  const analisi: Array<[TabellaIntegrazione, number, Analisi]> = [
    ...righe.controller.map((r): [TabellaIntegrazione, number, Analisi] => ["network_controllers", r.id, analizzaController(r)]),
    ...righe.ad.map((r): [TabellaIntegrazione, number, Analisi] => ["ad_integrations", r.id, analizzaAd(r)]),
  ];
  for (const [tabella, id, a] of analisi) {
    if (a == null) continue;
    if ("lasciato" in a) esito.lasciati.push({ tabella, id, motivo: a.lasciato });
    else piani.push(a.piano);
  }

  const nomi = new Set((db.prepare("SELECT name FROM credentials").all() as Array<{ name: string }>).map((r) => r.name));
  const nomeUnico = (p: Piano): string => {
    let nome = p.nomeBase;
    if (nomi.has(nome)) nome = `${p.nomeBase}${p.suffisso}`;
    for (let i = 2; nomi.has(nome); i++) nome = `${p.nomeBase}${p.suffisso.replace(/\)$/, `, ${i})`)}`;
    nomi.add(nome);
    return nome;
  };
  const punta = {
    network_controllers: db.prepare("UPDATE network_controllers SET credential_id = ? WHERE id = ?"),
    ad_integrations: db.prepare("UPDATE ad_integrations SET credential_id = ? WHERE id = ?"),
  };

  const scritti: Array<{ piano: Piano; voce: number }> = [];
  for (const p of piani) {
    const v = creaCredenzialeDb(db, {
      name: nomeUnico(p),
      credential_type: p.tipo,
      auth_method: p.auth_method,
      encrypted_username: p.encrypted_username,
      encrypted_password: p.encrypted_password,
    });
    punta[p.tabella].run(v.id, p.id);
    scritti.push({ piano: p, voce: v.id });
  }

  // Il confronto: la voce riletta dal DB deve ridare il segreto delle colonne.
  for (const { piano: p, voce } of scritti) {
    if (!uguale(db, voce, p.uso, p.atteso)) {
      throw new Error(`${etichetta(p.tabella)} #${p.id}: il confronto decifrato fra le colonne e la voce #${voce} è diverso: niente convertito`);
    }
    if (p.tabella === "network_controllers") esito.controller.push({ id: p.id, voce, metodo: p.metodo as MetodoController });
    else esito.ad.push({ id: p.id, voce });
  }

  const fkDopo = violazioni(db);
  if (fkDopo > fkPrima) throw new Error(`violazioni delle chiavi esterne di controller e AD: ${fkPrima} → ${fkDopo}`);
}

/**
 * Porta in archivio le credenziali di controller e AD (vedi testa del file).
 * Con `aVuoto` fa tutto, controlli compresi, e poi annulla: l'esito è quello
 * che succederebbe. Lancia (e annulla tutto) su un guasto vero: un confronto
 * «diverso», la chiave assente o sbagliata, la colonna `credential_id` che
 * manca, chiavi esterne peggiorate, errori del DB.
 */
export function convertiControllerEAd(db: Database.Database, opzioni: { aVuoto: boolean }): EsitoIntegrazioni {
  const esito: EsitoIntegrazioni = { controller: [], ad: [], lasciati: [] };
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

/**
 * Per ogni riga che punta una voce, il segreto delle colonne vecchie e quello
 * della voce, decifrati in memoria: «uguale», «diverso» o «colonne vuote».
 * Solo lettura; per la prova a vuoto sulla copia. Senza la colonna
 * `credential_id` (schema di prima della 2f) non c'è niente da confrontare.
 */
export function confrontoIntegrazioni(db: Database.Database): ConfrontoRiga[] {
  const out: ConfrontoRiga[] = [];
  // Una riga con le colonne che non si leggono più (un lasciato) non ridà il segreto della voce: «diverso».
  const confronta = (tabella: TabellaIntegrazione, id: number, voce: number, a: Analisi): ConfrontoRiga => {
    if (a == null) return { tabella, id, voce, esito: "colonne vuote" };
    if ("lasciato" in a) return { tabella, id, voce, esito: "diverso" };
    return { tabella, id, voce, esito: uguale(db, voce, a.piano.uso, a.piano.atteso) ? "uguale" : "diverso" };
  };
  if (haColonna(db, "network_controllers", "credential_id")) {
    const righe = db
      .prepare(`${SEL_CONTROLLER.replace("SELECT ", "SELECT credential_id, ")} WHERE credential_id IS NOT NULL ORDER BY id`)
      .all() as Array<RigaController & { credential_id: number }>;
    for (const r of righe) out.push(confronta("network_controllers", r.id, r.credential_id, analizzaController(r)));
  }
  if (haColonna(db, "ad_integrations", "credential_id")) {
    const righe = db
      .prepare(`${SEL_AD.replace("SELECT ", "SELECT credential_id, ")} WHERE credential_id IS NOT NULL ORDER BY id`)
      .all() as Array<RigaAd & { credential_id: number }>;
    for (const r of righe) out.push(confronta("ad_integrations", r.id, r.credential_id, analizzaAd(r)));
  }
  return out;
}

/** Valore del segno `credenziali_t2_integrazioni`: `parziale:` se una riga è stata lasciata. */
export function segnoIntegrazioni(e: EsitoIntegrazioni, quando: Date = new Date()): string {
  const stato = e.lasciati.length > 0 ? "parziale" : "done";
  const conteggi = [
    `controller=${e.controller.length}`,
    `chiave=${e.controller.filter((c) => c.metodo === "chiave").length}`,
    `utente=${e.controller.filter((c) => c.metodo === "utente").length}`,
    `ad=${e.ad.length}`,
    `lasciati=${e.lasciati.length}`,
  ].join(",");
  return `${stato}:${quando.toISOString()}:${conteggi}`;
}

/**
 * Una riga per il journal e per la risposta dell'import: per id, senza nomi
 * né segreti. Ogni riga convertita ha passato il confronto, quindi «uguale».
 */
export function descriviIntegrazioni(e: EsitoIntegrazioni): string {
  // Elementi separati da «; »: i motivi contengono già delle virgole.
  const elenco = (xs: string[]) => (xs.length > 0 ? ` [${xs.join("; ")}]` : "");
  const controller = e.controller.map((c) => `controller #${c.id} → voce #${c.voce} (${c.metodo}, uguale)`);
  const ad = e.ad.map((a) => `AD #${a.id} → voce #${a.voce} (uguale)`);
  const lasciati = e.lasciati.map((l) => `${etichetta(l.tabella)} #${l.id}: ${l.motivo}`);
  return `${e.controller.length} controller${elenco(controller)}, ${e.ad.length} AD${elenco(ad)}, lasciati ${e.lasciati.length}${elenco(lasciati)}`;
}
