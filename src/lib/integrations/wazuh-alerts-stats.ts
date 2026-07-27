/**
 * Aggregazioni per l'analisi degli eventi di sicurezza: distribuzione nel tempo
 * e composizione per categoria.
 *
 * Perche' non si calcolano dagli eventi salvati: l'event store deduplica per
 * coppia (agent, regola), quindi conosce un conteggio e due estremi temporali,
 * non la distribuzione. Il profilo orario vero ce l'ha solo l'indexer, e una
 * date_histogram con size 0 lo restituisce senza scaricare un solo documento.
 *
 * Modulo puro: query e parsing sono testabili senza indexer.
 */

import {
  ALERT_CATEGORIES,
  minSelectedLevel,
  selectedGroups,
  type AlertCategory,
} from "./wazuh-alerts";

export interface StatsWindow {
  id: string;
  labelIt: string;
  hours: number;
}

export const STATS_WINDOWS: StatsWindow[] = [
  { id: "24h", labelIt: "Ultime 24 ore", hours: 24 },
  { id: "7d", labelIt: "Ultimi 7 giorni", hours: 24 * 7 },
  { id: "30d", labelIt: "Ultimi 30 giorni", hours: 24 * 30 },
];

export function windowById(id: string): StatsWindow | undefined {
  return STATS_WINDOWS.find((w) => w.id === id);
}

/** Larghezza del bucket: sempre fra ~24 e ~30 colonne, mai centinaia. */
export function bucketIntervalFor(hours: number): string {
  if (hours <= 24) return "1h";
  if (hours <= 24 * 7) return "6h";
  return "1d";
}

export function sinceForWindow(hours: number, now: Date = new Date()): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

/** Categorie interrogabili: quelle assegnate per riclassificazione non lo sono. */
function queryableCategories(): AlertCategory[] {
  return ALERT_CATEGORIES.filter((c) => !c.assignedOnly);
}

interface CategoryFilter {
  bool: {
    filter: Array<{ terms: { "rule.groups": string[] } }>;
    must_not: Array<{ terms: { "rule.groups": string[] } }>;
  };
}

export interface StatsQuery {
  size: 0;
  query: { bool: { filter: unknown[] } };
  aggs: {
    per_category: {
      filters: { filters: Record<string, CategoryFilter> };
      aggs: {
        over_time: {
          date_histogram: {
            field: string;
            fixed_interval: string;
            min_doc_count: number;
          };
        };
      };
    };
    agents: { cardinality: { field: string } };
    rules: { cardinality: { field: string } };
  };
}

export function buildStatsQuery(args: { since: string; interval: string }): StatsQuery {
  const cats = queryableCategories();
  const filters: Record<string, CategoryFilter> = {};

  cats.forEach((c, i) => {
    // Ogni categoria esclude i gruppi di quelle che la precedono: riproduce il
    // "primo che matcha vince" di categorizeAlert, cosi' un documento non viene
    // contato due volte e le fette della torta sommano al totale.
    const previous = cats.slice(0, i).flatMap((p) => p.groups);
    filters[c.id] = {
      bool: {
        filter: [{ terms: { "rule.groups": c.groups } }],
        must_not: previous.length ? [{ terms: { "rule.groups": [...new Set(previous)] } }] : [],
      },
    };
  });

  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { range: { "@timestamp": { gte: args.since } } },
          { range: { "rule.level": { gte: minSelectedLevel() } } },
          { terms: { "rule.groups": selectedGroups() } },
        ],
      },
    },
    aggs: {
      per_category: {
        filters: { filters },
        aggs: {
          over_time: {
            date_histogram: {
              field: "@timestamp",
              fixed_interval: args.interval,
              min_doc_count: 0,
            },
          },
        },
      },
      agents: { cardinality: { field: "agent.id" } },
      rules: { cardinality: { field: "rule.id" } },
    },
  };
}

export interface CategorySlice {
  id: string;
  labelIt: string;
  count: number;
  diagnostic: boolean;
}

/** Una riga per bucket temporale: { bucket, <categoria>: n, … }. */
export type SeriesRow = { bucket: string } & Record<string, number | string>;

export interface AlertStats {
  totals: { alerts: number; agents: number; rules: number };
  byCategory: CategorySlice[];
  series: SeriesRow[];
}

interface RawAgg {
  hits?: { total?: { value?: number } | number };
  aggregations?: {
    agents?: { value?: number };
    rules?: { value?: number };
    per_category?: {
      buckets?: Record<
        string,
        {
          doc_count?: number;
          over_time?: { buckets?: Array<{ key_as_string?: string; doc_count?: number }> };
        }
      >;
    };
  };
}

export function parseStatsResponse(raw: RawAgg): AlertStats {
  const total = raw.hits?.total;
  const alerts = typeof total === "number" ? total : (total?.value ?? 0);
  const buckets = raw.aggregations?.per_category?.buckets ?? {};

  const byCategory: CategorySlice[] = [];
  const rowsByBucket = new Map<string, SeriesRow>();

  for (const [id, agg] of Object.entries(buckets)) {
    const meta = ALERT_CATEGORIES.find((c) => c.id === id);
    const count = agg.doc_count ?? 0;
    if (count > 0) {
      byCategory.push({
        id,
        labelIt: meta?.labelIt ?? id,
        count,
        diagnostic: meta?.diagnostic === true,
      });
    }
    for (const b of agg.over_time?.buckets ?? []) {
      const key = b.key_as_string;
      if (!key) continue;
      const row = rowsByBucket.get(key) ?? ({ bucket: key } as SeriesRow);
      row[id] = b.doc_count ?? 0;
      rowsByBucket.set(key, row);
    }
  }

  byCategory.sort((a, b) => b.count - a.count);
  const series = [...rowsByBucket.values()].sort((a, b) =>
    a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0,
  );

  return {
    totals: {
      alerts,
      agents: raw.aggregations?.agents?.value ?? 0,
      rules: raw.aggregations?.rules?.value ?? 0,
    },
    byCategory,
    series,
  };
}
