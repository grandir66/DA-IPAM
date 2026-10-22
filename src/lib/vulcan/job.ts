/**
 * I timer dell'invio verso l'hub DA-Vul-can (A-IPAM, Task 7), avviati da `server.ts`.
 *
 * - giro della coda ogni minuto, battito ogni 15, il primo di entrambi 2 minuti dopo l'avvio;
 * - fotografia dell'inventario alle 03:00 ora italiana (node-cron, `Europe/Rome`);
 * - recupero: al primo tic e a ogni battito, se l'ultimo inventario è più vecchio di 26 ore
 *   (o non c'è mai stato) se ne accoda uno. Così un'istanza spenta di notte, o che riceve il
 *   gettone di giorno, non aspetta le 03:00 dopo.
 *
 * Il freno: i timer girano sempre, ma ogni tic legge prima `oggetto.env`
 * (`leggiConfigVulcan`, un `stat` e una lettura del file) e senza gettone si ferma lì:
 * niente DB, niente rete, niente journal. Chi scrive le chiavi dopo non riavvia DA-IPAM.
 *
 * Mai due lavori insieme: giro, battito, inventario e «Invia ora» passano da una fila sola;
 * lo stesso lavoro chiesto mentre è già in fila riceve la stessa promessa (due «Invia ora»
 * insieme = un giro). Lo stato sta su globalThis, come `dalink/segnale-job.ts`: le rotte di
 * Next e `server.ts` caricano istanze diverse del modulo, e un secondo avvio (riavvio a
 * caldo) restituisce lo stop del primo invece di creare altri timer.
 */
import cron from "node-cron";
import type Database from "better-sqlite3";
import { parseDbDate } from "@/lib/db-date";
import { getTenantDb, schemaVulcanPresente } from "@/lib/db-tenant";
import { rimettiFalliti, ultimoInventarioCreato } from "./coda";
import { leggiConfigVulcan, tenantPerVulcan, type ConfigVulcan } from "./config";
import { accodaInventario, battito, giroCoda, type EsitoGiroVulcan } from "./giro";
import { scriviRegistroVulcan, type RigaAuditVulcan } from "./registro";

export const CODA_OGNI_MS = 60_000;
export const BATTITO_OGNI_MS = 15 * 60_000;
export const PRIMO_MS = 120_000;
export const CRON_INVENTARIO = "0 3 * * *";
export const FUSO_INVENTARIO = "Europe/Rome";
export const RECUPERO_ORE = 26;

type ConfigPronta = Extract<ConfigVulcan, { stato: "pronta" }>;
type EsitoInventario = Awaited<ReturnType<typeof accodaInventario>>;

/** Quel che serve di node-cron (sostituibile nelle prove). */
export interface CronMinimo {
  schedule(espr: string, fn: () => void, opz?: { timezone?: string; name?: string }): { stop(): void | Promise<void> };
}

export interface DipendenzeJob {
  config: () => ConfigVulcan;
  giro: () => Promise<EsitoGiroVulcan>;
  battito: () => Promise<EsitoGiroVulcan>;
  inventario: () => Promise<EsitoInventario>;
  /** Il DB del cliente dell'invio, o null (cliente assente su questa istanza, coda assente). */
  db: (cfg: ConfigPronta) => Database.Database | null;
  ora: () => Date;
  audit: (r: RigaAuditVulcan) => void;
}

function dbReale(cfg: ConfigPronta): Database.Database | null {
  const tenant = tenantPerVulcan(cfg.codcli);
  if (!tenant) return null;
  try {
    const db = getTenantDb(tenant);
    return schemaVulcanPresente(db) ? db : null;
  } catch {
    return null;
  }
}

const dipendenzeReali: DipendenzeJob = {
  config: () => leggiConfigVulcan(),
  giro: () => giroCoda(),
  battito: () => battito(),
  inventario: () => accodaInventario(),
  db: dbReale,
  ora: () => new Date(),
  audit: (r) => scriviRegistroVulcan(r),
};

type Lavoro = "giro" | "battito" | "inventario" | "invia_ora";

interface StatoJob {
  /** Coda della fila: ogni lavoro parte dopo che il precedente è finito (bene o male). */
  fila: Promise<unknown>;
  /** Lavori in fila o in corso: lo stesso lavoro chiesto di nuovo riceve questa promessa. */
  attesi: Map<Lavoro, Promise<unknown>>;
  stop: (() => void) | null;
}

const CHIAVE = Symbol.for("da-ipam.vulcan.job");
function stato(): StatoJob {
  const g = globalThis as unknown as Record<symbol, StatoJob | undefined>;
  return (g[CHIAVE] ??= { fila: Promise.resolve(), attesi: new Map(), stop: null });
}

function inFila<T>(lavoro: Lavoro, fn: () => Promise<T>): Promise<T> {
  const s = stato();
  const gia = s.attesi.get(lavoro);
  if (gia) return gia as Promise<T>;
  const p: Promise<T> = s.fila.then(fn, fn).finally(() => {
    if (stato().attesi.get(lavoro) === p) stato().attesi.delete(lavoro);
  });
  s.attesi.set(lavoro, p);
  s.fila = p.catch(() => undefined);
  return p;
}

/** Vero se un «Invia ora» è già in fila o in corso (un secondo sarebbe lo stesso giro: la rotta dice 409). */
export function invioOraInCorso(): boolean {
  return stato().attesi.has("invia_ora");
}

/** Vero se un giro, un battito, un inventario o un «Invia ora» è in fila o in corso. */
export function lavoroInCorso(): boolean {
  return stato().attesi.size > 0;
}

/** Accoda l'inventario se l'ultimo è più vecchio di `RECUPERO_ORE` (o non c'è). Solo a gettone presente. */
async function recupero(d: DipendenzeJob, cfg: ConfigPronta): Promise<void> {
  const db = d.db(cfg);
  if (!db) return;
  const ultimo = ultimoInventarioCreato(db);
  if (ultimo) {
    const t = parseDbDate(ultimo).getTime();
    if (!Number.isNaN(t) && d.ora().getTime() - t < RECUPERO_ORE * 3_600_000) return;
  }
  await d.inventario();
}

/** La configurazione, se c'è il gettone; null = flusso spento, il tic si ferma qui. */
function pronta(d: DipendenzeJob): ConfigVulcan | null {
  const cfg = d.config();
  return cfg.stato === "spento" ? null : cfg;
}

function avvisa(cosa: string, e: unknown): void {
  console.error(`[vulcan] ${cosa} fallito:`, e instanceof Error ? e.message : "errore imprevisto");
}

/**
 * «Invia ora» (pulsante in «Cosa esce», solo admin): accoda l'inventario, rimette in attesa i
 * falliti, svuota la coda e batte. Senza gettone, o con la configurazione non valida, non
 * fa niente e lo dice. Due richieste insieme fanno un giro solo.
 */
export function inviaOraVulcan(chi: string, dip: Partial<DipendenzeJob> = {}): Promise<EsitoGiroVulcan> {
  const d: DipendenzeJob = { ...dipendenzeReali, ...dip };
  return inFila("invia_ora", async () => {
    const cfg = d.config();
    if (cfg.stato === "spento") return { esito: "spento", dettaglio: "nessun gettone dell'hub su questa istanza" };
    if (cfg.stato === "non_valida") return { esito: "non_valida", dettaglio: cfg.motivo };
    try {
      d.audit({ azione: "invia_ora", da: chi.slice(0, 80) });
    } catch {
      console.error("[vulcan] registro degli invii non scritto: azione=invia_ora");
    }
    await d.inventario();
    const db = d.db(cfg);
    if (db) rimettiFalliti(db);
    const g = await d.giro();
    await d.battito();
    return g;
  });
}

export function avviaInvioVulcan(
  opz: Partial<DipendenzeJob> & { cron?: CronMinimo; primoMs?: number; codaMs?: number; battitoMs?: number } = {},
): () => void {
  const s = stato();
  if (s.stop) return s.stop;
  const { cron: c = cron, primoMs = PRIMO_MS, codaMs = CODA_OGNI_MS, battitoMs = BATTITO_OGNI_MS, ...dip } = opz;
  const d: DipendenzeJob = { ...dipendenzeReali, ...dip };

  const ticGiro = () => {
    if (!pronta(d)) return;
    inFila("giro", () => d.giro()).catch((e: unknown) => avvisa("giro della coda", e));
  };
  const ticBattito = () => {
    const cfg = pronta(d);
    if (!cfg) return;
    inFila("battito", async () => {
      if (cfg.stato === "pronta") {
        try {
          await recupero(d, cfg);
        } catch (e) {
          avvisa("recupero dell'inventario", e);
        }
      }
      return d.battito();
    }).catch((e: unknown) => avvisa("battito", e));
  };
  const ticInventario = () => {
    if (!pronta(d)) return;
    inFila("inventario", () => d.inventario()).catch((e: unknown) => avvisa("inventario del giorno", e));
  };

  let ogniGiro: ReturnType<typeof setInterval> | null = null;
  let ogniBattito: ReturnType<typeof setInterval> | null = null;
  const primo = setTimeout(() => {
    ticGiro();
    ticBattito();
    ogniGiro = setInterval(ticGiro, codaMs);
    ogniBattito = setInterval(ticBattito, battitoMs);
    ogniGiro.unref?.();
    ogniBattito.unref?.();
  }, primoMs);
  primo.unref?.();
  const notte = c.schedule(CRON_INVENTARIO, ticInventario, { timezone: FUSO_INVENTARIO, name: "vulcan-inventario" });

  const stop = () => {
    clearTimeout(primo);
    if (ogniGiro) clearInterval(ogniGiro);
    if (ogniBattito) clearInterval(ogniBattito);
    Promise.resolve(notte.stop()).catch(() => {});
    if (stato().stop === stop) stato().stop = null;
  };
  s.stop = stop;
  return stop;
}
