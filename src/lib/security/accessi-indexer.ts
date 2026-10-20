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
}

const ORA_MS = 3_600_000;
const CATEGORIA = "auth_failure";
const DURATA_CACHE_MS = 5 * 60_000;

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

  return { ore, giorni, totale24h: ore.reduce((s, o) => s + o.falliti, 0), totale24hPrima };
}

const cache = new Map<string, { quando: number; valore: SerieAccessi }>();

/**
 * Serie degli accessi falliti dall'indexer del tenant, 5 minuti in memoria.
 * `null` = indexer non configurato o non raggiungibile: la dashboard usa la stima.
 */
export async function leggiAccessiIndexer(tenantCode: string): Promise<SerieAccessi | null> {
  const inCache = cache.get(tenantCode);
  if (inCache && Date.now() - inCache.quando < DURATA_CACHE_MS) return inCache.valore;
  try {
    const { cfg, self } = withTenant(tenantCode, () => ({
      cfg: getWazuhConfig(),
      self: collectSelfIdentity(tenantDb()),
    }));
    if (!cfg.enabled || !cfg.indexerUrl) return null;
    const client = createWazuhIndexerClient({
      url: cfg.indexerUrl,
      username: cfg.indexerUsername,
      password: cfg.indexerPassword,
      verifyTls: cfg.verifyTls,
    });
    if (!client) return null;
    const ora = new Date();
    const stats = await client.alertStats({
      since: new Date(ora.getTime() - 15 * 24 * ORA_MS).toISOString(),
      interval: "1h",
      excludeAccounts: self.accounts,
      excludeIps: self.ips,
      extraRuleIds: cfg.deviceRuleIds,
    });
    const valore: SerieAccessi = { fonte: "indexer", ...accessiDaSerie(stats.series, ora) };
    cache.set(tenantCode, { quando: Date.now(), valore });
    return valore;
  } catch (e) {
    console.warn(`[dashboard] indexer non leggibile, uso la stima: ${(e as Error).name}`);
    return null;
  }
}
