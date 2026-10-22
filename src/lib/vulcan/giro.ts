/**
 * Il giro verso l'hub DA-Vul-can (A-IPAM, Task 6): svuota la coda, prova il gettone
 * (ping), batte, accoda l'inventario del giorno. Lo chiama il timer di `job.ts`.
 *
 * Ordine di ogni giro (freni prima della rete):
 * 1. configurazione: `spento` → si torna PRIMA di aprire il DB (niente righe, niente
 *    audit, niente journal); `non_valida` → il motivo, senza DB né rete;
 * 2. tenant dell'invio (`tenantPerVulcan`): nessuno → «cliente non presente su questa istanza»;
 * 3. sospensione: se `vulcan_stato.sospeso_gettone` è l'impronta del gettone attuale
 *    non si chiama nessuno; se il gettone in `oggetto.env` è cambiato la sospensione si
 *    toglie da sola e si riparte;
 * 4. ping al primo giro con un gettone nuovo (per processo) e poi ogni 24 ore: un
 *    `codcli` diverso da `DALINK_CODCLI` sospende; 503 = hub spento, si prosegue (le
 *    righe prendono 503 e il backoff);
 * 5. fino a 20 righe scadute, una alla volta, con l'esito del contratto (`decidi`).
 *
 * Della risposta dell'hub si leggono solo lo stato HTTP e, per un invio riuscito,
 * l'id numerico (`report_id`/`inventario_id`): nessuna risposta cambia configurazione
 * o comportamento. Errori e motivi sono frasi nostre, mai testo dell'hub, gettone, URL
 * o IP. Il journal (`[vulcan]`) ha una riga al cambio di esito; l'audit
 * (`registro.ts`) una per invio riuscito, scarto, fallimento definitivo e sospensione.
 */
import zlib from "node:zlib";
import type Database from "better-sqlite3";
import { parseDbDate } from "@/lib/db-date";
import { getTenantDb, schemaVulcanPresente } from "@/lib/db-tenant";
import { versioneIstanza } from "@/lib/dalink/fatti";
import { dataSqlite } from "@/lib/dalink/stato";
import {
  accoda,
  conteggiCoda,
  leggiStatoVulcan,
  prendiProssimi,
  puliziaCoda,
  registraScartoSenzaCorpo,
  rilascia,
  scriviStatoVulcan,
  segnaInviato,
  segnaRitento,
  segnaScartato,
  ultimoInviato,
  type RigaCoda,
  type StatoVulcanRiga,
  type TipoInvio,
} from "./coda";
import { leggiConfigVulcan, tenantPerVulcan, type ConfigVulcan } from "./config";
import { corpoInventario } from "./corpo-inventario";
import { leggiDatiInventario, type DatiInventario } from "./dati-inventario";
import { scriviRegistroVulcan, type RigaAuditVulcan } from "./registro";
import { ErroreHub, chiamaHub, type PercorsoHub, type RichiestaHub, type RispostaHub } from "./trasporto";

export const MAX_PER_GIRO = 20;
export const PING_OGNI_ORE = 24;

export type Decisione = "inviato" | "ritenta" | "scarta" | "sospendi";

export type EsitoGiroVulcan = {
  esito: "spento" | "non_valida" | "sospeso" | "ok" | "errore";
  dettaglio: string;
  inviati?: number;
};

type ConfigPronta = Extract<ConfigVulcan, { stato: "pronta" }>;

export interface DipendenzeGiro {
  config: () => ConfigVulcan;
  tenant: (codcli: string) => string | null;
  db: (tenant: string) => Database.Database;
  chiama: (r: RichiestaHub) => Promise<RispostaHub>;
  ora: () => Date;
  versione: () => string;
  audit: (r: RigaAuditVulcan) => void;
  /** I dati letti per l'inventario (sostituibile nelle prove per far fallire il costruttore). */
  inventario: (db: Database.Database) => DatiInventario;
}

const dipendenzeReali: DipendenzeGiro = {
  config: () => leggiConfigVulcan(),
  tenant: (codcli) => tenantPerVulcan(codcli),
  db: (tenant) => getTenantDb(tenant),
  chiama: (r) => chiamaHub(r),
  ora: () => new Date(),
  versione: () => versioneIstanza(),
  audit: (r) => scriviRegistroVulcan(r),
  inventario: (db) => leggiDatiInventario(db),
};

/**
 * Lo stato HTTP secondo il contratto (DA-Vul-can `docs/operativo/contratto-ipam-hub.md` §2):
 * 200/201 (anche doppione) inviato · 401/403/409 sospendi · 3xx e 4xx scarta, tranne
 * 408/429 · 5xx, 0 e il resto si ritenta (il doppione per sha256 sull'hub rende sicuro
 * ritentare).
 */
export function decidi(status: number): Decisione {
  if (status === 200 || status === 201) return "inviato";
  if (status === 401 || status === 403 || status === 409) return "sospendi";
  if (status >= 300 && status < 400) return "scarta";
  if (status === 408 || status === 429) return "ritenta";
  if (status >= 400 && status < 500) return "scarta";
  return "ritenta";
}

function motivoSospeso(status: number): string {
  if (status === 401) return "l'hub ha rifiutato il gettone (401): serve un gettone nuovo da DA-Link";
  if (status === 403) return "fonte revocata sull'hub (403): invii fermati finché DA-Link non scrive un gettone nuovo";
  return "l'hub dice che i dati sono di un altro cliente (409): invii fermati finché il gettone non cambia";
}

function motivoScarto(status: number, tipo: TipoInvio): string {
  if (status === 404) {
    return tipo === "inventario" ? "l'hub non riceve ancora l'inventario (404): scartato" : "l'hub non ha la rotta d'invio (404): scartato";
  }
  if (status === 400) return "l'hub non ha letto il corpo (400): scartato";
  if (status === 413) return "corpo oltre i limiti dell'hub (413): scartato";
  if (status === 422) return "l'hub ha rifiutato la forma dei dati (422): scartato";
  if (status >= 300 && status < 400) return `l'hub ha risposto con un rimando (${status}): non si segue, scartato`;
  return `l'hub ha rifiutato l'invio (${status}): scartato`;
}

function motivoRitento(status: number): string {
  if (status === 503) return "ricezione spenta o non disponibile sull'hub (503): si ritenta";
  return `l'hub ha risposto ${status}: si ritenta`;
}

/** Errore di trasporto → esito breve e frase nostra (i messaggi di `ErroreHub` lo sono già). */
function daErrore(e: unknown): { esito: string; messaggio: string } {
  if (e instanceof ErroreHub) return { esito: e.tipo, messaggio: e.message };
  return { esito: "errore", messaggio: "errore imprevisto nella chiamata all'hub" };
}

// ── memoria di processo (globalThis: le rotte di Next e server.ts caricano istanze diverse) ──
interface Memoria {
  /** tenant → impronta del gettone per cui il ping ha detto ok in questo processo. */
  ping: Map<string, string>;
  /** canale → ultimo esito scritto nel journal. */
  righe: Map<string, string>;
}
const CHIAVE = Symbol.for("da-ipam.vulcan.giro");
function memoria(): Memoria {
  const g = globalThis as unknown as Record<symbol, Memoria | undefined>;
  return (g[CHIAVE] ??= { ping: new Map(), righe: new Map() });
}

/** Solo per le prove: riparte senza ping fatti e senza righe di journal ricordate. */
export function _azzeraMemoriaVulcan(): void {
  memoria().ping.clear();
  memoria().righe.clear();
}

/** Una riga `[vulcan]` solo quando l'esito del canale cambia; `spento` è muto. */
function registra(canale: "invio" | "battito" | "inventario", e: EsitoGiroVulcan, causa?: string): EsitoGiroVulcan {
  if (e.esito === "spento") return e;
  const chiave = `${e.esito}|${causa ?? (e.esito === "ok" ? "" : e.dettaglio)}`;
  const m = memoria().righe;
  if (m.get(canale) === chiave) return e;
  m.set(canale, chiave);
  const riga = `[vulcan] ${canale}: ${e.esito} — ${e.dettaglio}`;
  if (e.esito === "ok") console.warn(riga);
  else console.error(riga);
  return e;
}

function scriviAudit(d: DipendenzeGiro, r: RigaAuditVulcan): void {
  try {
    d.audit(r);
  } catch (e) {
    // L'invio è già avvenuto: lo si dice nel journal, senza fermare il giro.
    const code = (e as NodeJS.ErrnoException)?.code;
    console.error(`[vulcan] registro degli invii non scritto (${typeof code === "string" ? code : "errore"}): azione=${r.azione}`);
  }
}

function richiesta(cfg: ConfigPronta, d: DipendenzeGiro, metodo: "GET" | "POST", percorso: PercorsoHub, corpoGz?: Buffer): RichiestaHub {
  return { url: cfg.url, token: cfg.token, versione: d.versione(), metodo, percorso, ...(corpoGz ? { corpoGz } : {}) };
}

type Apertura = { esito: EsitoGiroVulcan } | { cfg: ConfigPronta; tenant: string; db: Database.Database };

/** Passi 1-2: configurazione, tenant, DB. Nessuna rete. */
function apri(d: DipendenzeGiro): Apertura {
  const cfg = d.config();
  if (cfg.stato === "spento") return { esito: { esito: "spento", dettaglio: "nessun gettone dell'hub su questa istanza" } };
  if (cfg.stato === "non_valida") return { esito: { esito: "non_valida", dettaglio: cfg.motivo } };
  const tenant = d.tenant(cfg.codcli);
  if (!tenant) return { esito: { esito: "non_valida", dettaglio: "cliente non presente su questa istanza: niente da inviare" } };
  let db: Database.Database;
  try {
    db = d.db(tenant);
  } catch {
    return { esito: { esito: "errore", dettaglio: "database del cliente non apribile: niente inviato" } };
  }
  if (!schemaVulcanPresente(db)) return { esito: { esito: "errore", dettaglio: "coda verso DA-Vul-can assente in questo database" } };
  return { cfg, tenant, db };
}

function sospendi(d: DipendenzeGiro, db: Database.Database, cfg: ConfigPronta, tenant: string, motivo: string, extra: Partial<RigaAuditVulcan>): EsitoGiroVulcan {
  scriviStatoVulcan(db, { sospeso_gettone: cfg.improntaGettone, sospeso_motivo: motivo });
  memoria().ping.delete(tenant);
  scriviAudit(d, { azione: "sospeso", ...extra, motivo });
  return { esito: "sospeso", dettaglio: motivo };
}

function serveIlPing(st: StatoVulcanRiga, cfg: ConfigPronta, tenant: string, ora: Date): boolean {
  if (memoria().ping.get(tenant) !== cfg.improntaGettone) return true;
  if (st.ping_esito !== "ok" || !st.ping_il) return true;
  return st.ping_il <= dataSqlite(new Date(ora.getTime() - PING_OGNI_ORE * 3_600_000));
}

/** Il `codcli` della risposta del ping, se è una stringa di cifre; altrimenti null. */
function codcliDelPing(body: string): string | null {
  try {
    const o = JSON.parse(body) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const c = (o as Record<string, unknown>).codcli;
      if (typeof c === "string" && /^\d{1,20}$/.test(c)) return c;
    }
  } catch {
    // risposta illeggibile: la gestisce il chiamante
  }
  return null;
}

/** Passi 3-4: sospensione e ping. null = si prosegue. */
async function prepara(d: DipendenzeGiro, cfg: ConfigPronta, tenant: string, db: Database.Database, ora: Date): Promise<EsitoGiroVulcan | null> {
  const st = leggiStatoVulcan(db);
  if (st.sospeso_gettone) {
    if (st.sospeso_gettone === cfg.improntaGettone) {
      return { esito: "sospeso", dettaglio: st.sospeso_motivo ?? "invii sospesi per questo gettone" };
    }
    scriviStatoVulcan(db, { sospeso_gettone: null, sospeso_motivo: null });
    memoria().ping.delete(tenant);
    console.warn("[vulcan] gettone cambiato in oggetto.env: sospensione tolta, si riparte");
  }
  if (!serveIlPing(st, cfg, tenant, ora)) return null;

  const pingIl = dataSqlite(ora);
  let r: RispostaHub;
  try {
    r = await d.chiama(richiesta(cfg, d, "GET", "/api/ipam/ping"));
  } catch (e) {
    const { esito, messaggio } = daErrore(e);
    scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: esito, ping_dettaglio: messaggio });
    return { esito: "errore", dettaglio: `ping: ${messaggio}` };
  }
  if (r.status === 200) {
    const codcli = codcliDelPing(r.body);
    if (codcli === null) {
      scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: "errore", ping_dettaglio: "risposta del ping illeggibile" });
      return { esito: "errore", dettaglio: "ping: risposta dell'hub illeggibile, niente inviato" };
    }
    if (codcli !== cfg.codcli) {
      const motivo = "il gettone è di un altro cliente: invii fermati finché DA-Link non scrive il gettone giusto";
      scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: "altro_cliente", ping_dettaglio: motivo });
      return sospendi(d, db, cfg, tenant, motivo, { tipo: "ping", http: 200 });
    }
    scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: "ok", ping_dettaglio: "gettone riconosciuto dall'hub" });
    memoria().ping.set(tenant, cfg.improntaGettone);
    return null;
  }
  if (r.status === 503) {
    scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: "spento_hub", ping_dettaglio: "ricezione spenta sull'hub (503): gli invii restano in coda" });
    return null;
  }
  if (decidi(r.status) === "sospendi") {
    const motivo = motivoSospeso(r.status);
    scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: `http_${r.status}`, ping_dettaglio: motivo });
    return sospendi(d, db, cfg, tenant, motivo, { tipo: "ping", http: r.status });
  }
  const dettaglio = `l'hub ha risposto ${r.status} al ping: niente inviato`;
  scriviStatoVulcan(db, { ping_il: pingIl, ping_esito: `http_${r.status}`, ping_dettaglio: dettaglio });
  return { esito: "errore", dettaglio };
}

/** L'id numerico della risposta a un invio riuscito; tutto il resto si ignora. */
function rispostaId(body: string, tipo: TipoInvio): string | null {
  try {
    const o = JSON.parse(body) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const v = (o as Record<string, unknown>)[tipo === "ad-health" ? "report_id" : "inventario_id"];
      if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
    }
  } catch {
    // corpo non JSON: l'invio resta riuscito, senza id
  }
  return null;
}

const PERCORSO: Record<TipoInvio, PercorsoHub> = { "ad-health": "/api/ipam/ad-health", inventario: "/api/ipam/inventario" };

export async function giroCoda(dip: Partial<DipendenzeGiro> = {}): Promise<EsitoGiroVulcan> {
  const d: DipendenzeGiro = { ...dipendenzeReali, ...dip };
  const a = apri(d);
  if ("esito" in a) return registra("invio", a.esito);
  const { cfg, tenant, db } = a;
  const ora = d.ora();
  const pre = await prepara(d, cfg, tenant, db, ora);
  if (pre) return registra("invio", pre);

  const righe = prendiProssimi(db, MAX_PER_GIRO, ora);
  const conto = { inviati: 0, ritentati: 0, scartati: 0, falliti: 0 };
  let ultimo: string | null = null;

  const ritenta = (r: RigaCoda, esito: string, motivo: string) => {
    ultimo = motivo;
    if (segnaRitento(db, r.id, esito, motivo, d.ora()) === "fallito") {
      conto.falliti++;
      scriviAudit(d, { azione: "fallito", tipo: r.tipo, byte: r.byte_json, oggetti: r.oggetti, sha: r.sha256.slice(0, 12), motivo });
    } else conto.ritentati++;
  };
  const scarta = (r: RigaCoda, esito: string, motivo: string, http?: number) => {
    ultimo = motivo;
    conto.scartati++;
    segnaScartato(db, r.id, esito, motivo, d.ora());
    scriviAudit(d, { azione: "scarto", tipo: r.tipo, ...(http !== undefined ? { http } : {}), byte: r.byte_json, oggetti: r.oggetti, sha: r.sha256.slice(0, 12), motivo });
  };

  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    if (!r.corpo_gz || r.corpo_gz.length === 0) {
      scarta(r, "senza_corpo", "corpo assente nella coda: scartato");
      continue;
    }
    let risp: RispostaHub;
    try {
      risp = await d.chiama(richiesta(cfg, d, "POST", PERCORSO[r.tipo], Buffer.from(r.corpo_gz)));
    } catch (e) {
      const { esito, messaggio } = daErrore(e);
      ritenta(r, esito, messaggio);
      continue;
    }
    const dec = decidi(risp.status);
    if (dec === "inviato") {
      const id = rispostaId(risp.body, r.tipo);
      segnaInviato(db, r.id, id, d.ora());
      conto.inviati++;
      scriviAudit(d, { azione: "invio", tipo: r.tipo, http: risp.status, byte: r.byte_json, oggetti: r.oggetti, sha: r.sha256.slice(0, 12), risposta_id: id });
    } else if (dec === "ritenta") {
      ritenta(r, `http_${risp.status}`, motivoRitento(risp.status));
    } else if (dec === "scarta") {
      scarta(r, `http_${risp.status}`, motivoScarto(risp.status, r.tipo), risp.status);
    } else {
      // Sospeso: questa e le righe prese e non ancora tentate tornano in attesa, senza contare un tentativo.
      for (const resto of righe.slice(i)) rilascia(db, resto.id);
      const motivo = motivoSospeso(risp.status);
      return registra("invio", sospendi(d, db, cfg, tenant, motivo, { tipo: r.tipo, http: risp.status, sha: r.sha256.slice(0, 12) }));
    }
  }

  if (righe.length === 0) return registra("invio", { esito: "ok", dettaglio: "niente da inviare", inviati: 0 });
  const conti = `inviati ${conto.inviati}, da ritentare ${conto.ritentati}, scartati ${conto.scartati}, falliti ${conto.falliti}`;
  const esito: EsitoGiroVulcan["esito"] = conto.ritentati + conto.falliti > 0 ? "errore" : "ok";
  return registra(
    "invio",
    { esito, dettaglio: ultimo && esito === "errore" ? `${conti} — ${ultimo}` : conti, inviati: conto.inviati },
    esito === "errore" ? (ultimo ?? "") : "",
  );
}

/** Data del DB (ISO di AD, o forma di SQLite in UTC) → ISO; illeggibile → null. */
function iso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = parseDbDate(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function tabellaPresente(db: Database.Database, nome: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome) !== undefined;
}

/** Il corpo del battito, esattamente quello della rotta dell'hub (`heartbeat/route.ts`, schema `Battito`). */
export function corpoBattito(db: Database.Database, versione: string, ora: Date) {
  let ultimaEsecuzione: string | null = null;
  let esitoAd: string | null = null;
  if (tabellaPresente(db, "ad_health_runs")) {
    const ok = db
      .prepare("SELECT finished_at FROM ad_health_runs WHERE status = 'ok' AND finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1")
      .get() as { finished_at: string } | undefined;
    ultimaEsecuzione = iso(ok?.finished_at);
    const ultimo = db
      .prepare("SELECT status FROM ad_health_runs WHERE status IN ('ok', 'error') ORDER BY COALESCE(finished_at, started_at) DESC, id DESC LIMIT 1")
      .get() as { status: string } | undefined;
    esitoAd = ultimo?.status ?? null;
  }
  const inv = ultimoInviato(db, "inventario");
  const oggetti = inv && Number.isSafeInteger(inv.oggetti) && (inv.oggetti as number) >= 0 ? (inv.oggetti as number) : 0;
  const coda = conteggiCoda(db, ora);
  return {
    versione: (versione || "sconosciuta").slice(0, 40),
    generato_il: ora.toISOString(),
    ad: { ultima_esecuzione: ultimaEsecuzione, esito: esitoAd },
    // `oggetti` non è nullable sull'hub: senza inventari inviati vale 0.
    inventario: { ultimo_invio: iso(inv?.inviato_il), oggetti },
    coda: { in_attesa: coda.in_attesa, falliti: coda.falliti },
  };
}

export async function battito(dip: Partial<DipendenzeGiro> = {}): Promise<EsitoGiroVulcan> {
  const d: DipendenzeGiro = { ...dipendenzeReali, ...dip };
  const a = apri(d);
  if ("esito" in a) return registra("battito", a.esito);
  const { cfg, tenant, db } = a;
  const ora = d.ora();
  const pre = await prepara(d, cfg, tenant, db, ora);
  if (pre) return registra("battito", pre);

  const il = dataSqlite(ora);
  const chiudi = (esito: string, dettaglio: string, e: EsitoGiroVulcan["esito"]) => {
    scriviStatoVulcan(db, { battito_il: il, battito_esito: esito, battito_dettaglio: dettaglio });
    return registra("battito", { esito: e, dettaglio });
  };
  let gz: Buffer;
  try {
    gz = zlib.gzipSync(Buffer.from(JSON.stringify(corpoBattito(db, d.versione(), ora)), "utf8"));
  } catch {
    return chiudi("errore", "battito non costruito: errore nel leggere il database", "errore");
  }
  let r: RispostaHub;
  try {
    r = await d.chiama(richiesta(cfg, d, "POST", "/api/ipam/heartbeat", gz));
  } catch (e) {
    const { esito, messaggio } = daErrore(e);
    return chiudi(esito, messaggio, "errore");
  }
  // Nessun campo della risposta si legge: solo lo stato HTTP.
  const dec = decidi(r.status);
  if (dec === "inviato") return chiudi("ok", "battito ricevuto dall'hub", "ok");
  if (dec === "sospendi") {
    const motivo = motivoSospeso(r.status);
    scriviStatoVulcan(db, { battito_il: il, battito_esito: `http_${r.status}`, battito_dettaglio: motivo });
    return registra("battito", sospendi(d, db, cfg, tenant, motivo, { tipo: "battito", http: r.status }));
  }
  if (r.status === 503) return chiudi("spento_hub", "ricezione spenta sull'hub (503)", "errore");
  return chiudi(`http_${r.status}`, `l'hub ha risposto ${r.status} al battito`, "errore");
}

/**
 * La fotografia dell'inventario del giorno entra in coda (la più nuova sostituisce quella
 * in attesa). Se il costruttore fallisce: una riga `[vulcan]` nel journal e una riga
 * `scartato` senza corpo col motivo, che la pagina mostra come «ultimo errore».
 * Qui si fa anche la pulizia giornaliera delle righe uscite dalla coda da 90 giorni.
 */
export async function accodaInventario(dip: Partial<DipendenzeGiro> = {}): Promise<"accodato" | "doppione" | "spento" | "errore"> {
  const d: DipendenzeGiro = { ...dipendenzeReali, ...dip };
  // Spento o configurazione non valida: non si accoda niente (il motivo lo dicono giro e pagina).
  const config = d.config();
  if (config.stato !== "pronta") return "spento";
  const a = apri({ ...d, config: () => config });
  if ("esito" in a) {
    registra("inventario", a.esito);
    return "errore";
  }
  const { cfg, db } = a;
  const ora = d.ora();
  try {
    const c = corpoInventario(d.inventario(db), { codcli: cfg.codcli, nodo: cfg.nodo, versione: d.versione(), adesso: ora });
    if ("errore" in c) throw new Error(c.errore);
    const r = accoda(db, { tipo: "inventario", rif: null, json: c.json, oggetti: c.oggetti });
    try {
      puliziaCoda(db, ora);
    } catch (e) {
      console.warn(`[vulcan] pulizia della coda non riuscita: ${e instanceof Error ? e.message : "errore"}`);
    }
    registra("inventario", { esito: "ok", dettaglio: "fotografia dell'inventario in coda" });
    return r.nuovo ? "accodato" : "doppione";
  } catch (e) {
    const motivo = `inventario non costruito: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
    registra("inventario", { esito: "errore", dettaglio: motivo });
    try {
      registraScartoSenzaCorpo(db, "inventario", motivo, ora);
    } catch (e2) {
      console.error(`[vulcan] riga d'errore dell'inventario non scritta: ${e2 instanceof Error ? e2.message : "errore"}`);
    }
    return "errore";
  }
}
