/**
 * Accessi falliti della dashboard dagli istogrammi dell'indexer Wazuh (Riccardo, 20/10).
 *
 * La stima di `kpi-dashboard.ts` riparte ogni gruppo d'allarme sulla sua durata: i totali
 * reggono, ma ora per ora le barre escono tutte uguali e i picchi spariscono. L'indexer
 * conta le ore davvero, con le stesse esclusioni della pagina Alert (nostri account e IP,
 * regole degli apparati). Una sola interrogazione oraria su 15 giorni: i bucket dell'indexer
 * sono in UTC, i giorni si sommano qui in ora italiana. Senza indexer la dashboard torna
 * alla stima e lo dice.
 */
import { FUSO_UTENTI } from "@/lib/db-date";
import { withTenant } from "@/lib/db-tenant";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { createWazuhIndexerClient } from "@/lib/integrations/wazuh-indexer-api";
import { collectSelfIdentity } from "@/lib/integrations/self-identity";
import { tenantDb } from "@/lib/integrations/wazuh-alerts-db";
import type { SeriesRow } from "@/lib/integrations/wazuh-alerts-stats";

export interface SerieAccessi {
  fonte: "indexer" | "stima";
  /** Ultime 24 ore, ora italiana «HH», dalla più vecchia all'ora in corso. */
  ore: { ora: string; falliti: number }[];
  /** Ultimi 14 giorni italiani «YYYY-MM-DD», dal più vecchio a oggi. */
  giorni: { giorno: string; falliti: number }[];
  totale24h: number;
  totale24hPrima: number;
  /** Le 24 ore piene più recenti contro le 24 prima (l'ora in corso è parziale e resta fuori). */
  tendenza: "su" | "giu" | "pari";
  /** Con la stima: perché l'indexer non è stato usato. */
  motivo?: string;
}

/** Esito della lettura: la serie, oppure perché non c'è (si mostra accanto alla stima). */
export interface LetturaAccessi {
  serie: SerieAccessi | null;
  motivo: string | null;
}

const ORA_MS = 3_600_000;
const CATEGORIA = "auth_failure";
const DURATA_CACHE_MS = 5 * 60_000;
/** Un indexer spento non deve fermare la dashboard a ogni caricamento (revisione del 20/10). */
const DURATA_CACHE_ERRORE_MS = 2 * 60_000;
const ATTESA_MAX_MS = 5_000;

const oraItaliana = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO_UTENTI, hour: "2-digit", hourCycle: "h23" });
const giornoItaliano = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO_UTENTI, year: "numeric", month: "2-digit", day: "2-digit" });

/** Dalla serie oraria dell'indexer ai punti della dashboard (pura, provata). */
export function accessiDaSerie(serie: SeriesRow[], ora: Date): Omit<SerieAccessi, "fonte"> {
  const perOra = new Map<number, number>();
  for (const r of serie) {
    const t = Date.parse(r.bucket);
    const n = Number(r[CATEGORIA] ?? 0);
    if (Number.isFinite(t) && n > 0) perOra.set(t, (perOra.get(t) ?? 0) + n);
  }
  const inizioOra = Math.floor(ora.getTime() / ORA_MS) * ORA_MS;
  const quante = (t: number) => perOra.get(t) ?? 0;

  const ore = Array.from({ length: 24 }, (_, i) => {
    const t = inizioOra - (23 - i) * ORA_MS;
    return { ora: oraItaliana.format(t), falliti: quante(t) };
  });
  let totale24hPrima = 0;
  for (let k = 24; k < 48; k++) totale24hPrima += quante(inizioOra - k * ORA_MS);
  // Tendenza su blocchi uguali: con l'ora in corso dentro, la freccia pendeva verso «giù».
  let piene = 0;
  let pienePrima = 0;
  for (let k = 1; k <= 24; k++) piene += quante(inizioOra - k * ORA_MS);
  for (let k = 25; k <= 48; k++) pienePrima += quante(inizioOra - k * ORA_MS);
  const tendenza = piene > pienePrima ? "su" : piene < pienePrima ? "giu" : "pari";

  const perGiorno = new Map<string, number>();
  for (const [t, n] of perOra) {
    const g = giornoItaliano.format(t);
    perGiorno.set(g, (perGiorno.get(g) ?? 0) + n);
  }
  // 14 giorni a ritroso da oggi: si scende di 24 ore alla volta da mezzogiorno,
  // lontano dai cambi d'ora che spostano la mezzanotte.
  const oggi = giornoItaliano.format(ora);
  const [y, m, d] = oggi.split("-").map(Number);
  const mezzogiorno = Date.UTC(y, m - 1, d, 12);
  const giorni = Array.from({ length: 14 }, (_, i) => {
    const g = giornoItaliano.format(mezzogiorno - (13 - i) * 24 * ORA_MS);
    return { giorno: g, falliti: perGiorno.get(g) ?? 0 };
  });

  return { ore, giorni, totale24h: ore.reduce((s, o) => s + o.falliti, 0), totale24hPrima, tendenza };
}

const cache = new Map<string, { quando: number; valore: LetturaAccessi }>();

/**
 * Serie degli accessi falliti dall'indexer del tenant, 5 minuti in memoria (un errore 2
 * minuti). `serie: null` = indexer non configurato o non raggiungibile, col motivo: la
 * dashboard usa la stima e lo dice. Oltre 5 secondi d'attesa si rinuncia.
 */
export async function leggiAccessiIndexer(tenantCode: string): Promise<LetturaAccessi> {
  const inCache = cache.get(tenantCode);
  if (inCache && Date.now() - inCache.quando < (inCache.valore.serie ? DURATA_CACHE_MS : DURATA_CACHE_ERRORE_MS)) {
    return inCache.valore;
  }
  const ricorda = (valore: LetturaAccessi) => {
    cache.set(tenantCode, { quando: Date.now(), valore });
    return valore;
  };
  try {
    const { cfg, self } = withTenant(tenantCode, () => ({
      cfg: getWazuhConfig(),
      self: collectSelfIdentity(tenantDb()),
    }));
    if (!cfg.enabled || !cfg.indexerUrl) return ricorda({ serie: null, motivo: "indexer di Wazuh non configurato" });
    const client = createWazuhIndexerClient({
      url: cfg.indexerUrl,
      username: cfg.indexerUsername,
      password: cfg.indexerPassword,
      verifyTls: cfg.verifyTls,
    });
    if (!client) return ricorda({ serie: null, motivo: "indexer di Wazuh non configurato" });
    const ora = new Date();
    let scaduto: ReturnType<typeof setTimeout> | undefined;
    const stats = await Promise.race([
      client.alertStats({
        since: new Date(ora.getTime() - 15 * 24 * ORA_MS).toISOString(),
        interval: "1h",
        excludeAccounts: self.accounts,
        excludeIps: self.ips,
        extraRuleIds: cfg.deviceRuleIds,
      }),
      new Promise<never>((_, rifiuta) => {
        scaduto = setTimeout(() => rifiuta(new Error("attesa oltre 5 secondi")), ATTESA_MAX_MS);
      }),
    ]).finally(() => clearTimeout(scaduto));
    return ricorda({ serie: { fonte: "indexer", ...accessiDaSerie(stats.series, ora) }, motivo: null });
  } catch (e) {
    console.warn(`[dashboard] indexer non leggibile, uso la stima: ${(e as Error).name}`);
    return ricorda({ serie: null, motivo: "indexer di Wazuh non raggiungibile" });
  }
}
