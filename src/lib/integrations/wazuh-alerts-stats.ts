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
  EXCLUDED_OUTCOME_GROUPS,
  accountKind,
  minSelectedLevel,
  normalizeIp,
  selectedGroups,
  type AlertCategory,
  type SourceSystem,
} from "./wazuh-alerts";

/**
 * Quanti account bersagliati raccogliere per sorgente. Ampio di proposito: la
 * coda lunga (chi sbaglia due o tre volte) e' spesso il segnale piu'
 * interessante, e la pagina la impagina invece di troncarla.
 */
const TOP_ACCOUNTS = 100;

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

interface TermsBucket {
  key?: string;
  doc_count?: number;
}

interface UserTermsAgg {
  terms: { field: string; size: number };
  aggs: {
    top_source: { terms: { field: string; size: number } };
    top_workstation?: { terms: { field: string; size: number } };
    /** Agent che ha inviato l'alert: NON e' l'origine del tentativo. */
    top_agent: { terms: { field: string; size: number } };
    last_seen: { max: { field: string } };
  };
}

interface AccountsAgg {
  filter: { bool: { filter: unknown[]; must_not: unknown[] } };
  aggs: {
    /** Windows: targetUserName. */
    by_user: UserTermsAgg;
    /** Microsoft 365: UserId, ma solo sugli accessi FALLITI. */
    by_user_cloud: {
      filter: { term: Record<string, string> };
      aggs: { u: UserTermsAgg };
    };
    /** Decoder generici (sshd, pam, sudo): srcuser. */
    by_user_unix: UserTermsAgg;
  };
}

export interface StatsQuery {
  size: 0;
  query: { bool: { filter: unknown[]; must_not: unknown[] } };
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
    accounts: AccountsAgg;
  };
}

export function buildStatsQuery(args: {
  since: string;
  interval: string;
  /** Account di servizio nostri: fuori dalla classifica dei bersagliati. */
  excludeAccounts?: string[];
  /** IP nostri: il nostro scanner prova credenziali note (admin, oracle, …). */
  excludeIps?: string[];
}): StatsQuery {
  const cats = queryableCategories();
  const authGroups = [
    ...(cats.find((c) => c.id === "auth_failure")?.groups ?? []),
    ...(cats.find((c) => c.id === "cloud_auth_failure")?.groups ?? []),
  ];
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
        must_not: [{ terms: { "rule.groups": EXCLUDED_OUTCOME_GROUPS } }],
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
      // Chi viene bersagliato, non solo dove atterra l'evento. L'event store
      // non puo' rispondere: deduplica per (agent, regola) e perde l'account.
      accounts: {
        filter: {
          bool: {
            filter: [{ terms: { "rule.groups": authGroups } }],
            // I nostri account vanno esclusi su OGNI campo utente: i decoder
            // Linux usano srcuser, Microsoft 365 usa UserId. Filtrare solo il
            // campo Windows lasciava passare "domarc" fra i bersagliati.
            must_not: [
              ...((args.excludeAccounts ?? []).length
                ? [
                    { terms: { "data.win.eventdata.targetUserName": args.excludeAccounts } },
                    { terms: { "data.srcuser": args.excludeAccounts } },
                    { terms: { "data.dstuser": args.excludeAccounts } },
                    { terms: { "data.office365.UserId": args.excludeAccounts } },
                  ]
                : []),
              // Il nostro scanner prova credenziali note (admin, oracle, karaf):
              // sono tentativi NOSTRI, e si riconoscono dall'IP di partenza.
              ...((args.excludeIps ?? []).length
                ? [
                    { terms: { "data.srcip": args.excludeIps } },
                    { terms: { "data.win.eventdata.ipAddress": args.excludeIps } },
                  ]
                : []),
            ],
          },
        },
        aggs: {
          by_user: {
            terms: { field: "data.win.eventdata.targetUserName", size: TOP_ACCOUNTS },
            aggs: {
              top_source: { terms: { field: "data.win.eventdata.ipAddress", size: 1 } },
              top_workstation: {
                terms: { field: "data.win.eventdata.workstationName", size: 1 },
              },
              top_agent: { terms: { field: "agent.name", size: 1 } },
              last_seen: { max: { field: "@timestamp" } },
            },
          },
          by_user_cloud: {
            filter: { term: { "data.office365.Operation": "UserLoginFailed" } },
            aggs: {
              u: {
                terms: { field: "data.office365.UserId", size: TOP_ACCOUNTS },
                aggs: {
                  top_source: { terms: { field: "data.office365.ClientIP", size: 1 } },
                  top_agent: { terms: { field: "agent.name", size: 1 } },
                  last_seen: { max: { field: "@timestamp" } },
                },
              },
            },
          },
          by_user_unix: {
            terms: { field: "data.srcuser", size: TOP_ACCOUNTS },
            aggs: {
              top_source: { terms: { field: "data.srcip", size: 1 } },
              top_agent: { terms: { field: "agent.name", size: 1 } },
              last_seen: { max: { field: "@timestamp" } },
            },
          },
        },
      },
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

export interface TargetedAccount {
  account: string;
  count: number;
  /** IP da cui partono i tentativi: la parte azionabile. */
  sourceIp: string | null;
  workstation: string | null;
  /** Agent Wazuh che ha rilevato: dove e' stato visto, non da dove parte. */
  detectedBy: string | null;
  lastSeenAt: string | null;
  /** Da quale sistema arriva il fallimento. */
  system: SourceSystem;
  /** Persona o account macchina (quelli che finiscono con $). */
  kind: "utente" | "computer";
}

export interface AlertStats {
  totals: { alerts: number; agents: number; rules: number };
  byCategory: CategorySlice[];
  series: SeriesRow[];
  topAccounts: TargetedAccount[];
}

interface UserBucket {
  key?: string;
  doc_count?: number;
  top_source?: { buckets?: TermsBucket[] };
  top_workstation?: { buckets?: TermsBucket[] };
  top_agent?: { buckets?: TermsBucket[] };
  last_seen?: { value_as_string?: string };
}

interface RawAgg {
  hits?: { total?: { value?: number } | number };
  aggregations?: {
    agents?: { value?: number };
    rules?: { value?: number };
    accounts?: {
      by_user?: { buckets?: UserBucket[] };
      by_user_cloud?: { u?: { buckets?: UserBucket[] } };
      by_user_unix?: { buckets?: UserBucket[] };
    };
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

  // Ogni sorgente usa un campo diverso per l'account: si uniscono qui e si
  // ordinano per volume, non per sistema di provenienza.
  const fromBuckets = (buckets: UserBucket[] | undefined, system: SourceSystem) =>
    (buckets ?? [])
      .filter((b) => b.key && b.key !== "-")
      .map<TargetedAccount>((b) => ({
        account: b.key as string,
        count: b.doc_count ?? 0,
        sourceIp: normalizeIp(b.top_source?.buckets?.[0]?.key),
        workstation: b.top_workstation?.buckets?.[0]?.key ?? null,
        detectedBy: b.top_agent?.buckets?.[0]?.key ?? null,
        lastSeenAt: b.last_seen?.value_as_string ?? null,
        system,
        kind: accountKind(b.key),
      }));

  const acc = raw.aggregations?.accounts;
  const topAccounts: TargetedAccount[] = [
    ...fromBuckets(acc?.by_user?.buckets, "windows"),
    ...fromBuckets(acc?.by_user_cloud?.u?.buckets, "microsoft365"),
    ...fromBuckets(acc?.by_user_unix?.buckets, "linux"),
  ]
    .sort((a, b) => b.count - a.count);

  return {
    totals: {
      alerts,
      agents: raw.aggregations?.agents?.value ?? 0,
      rules: raw.aggregations?.rules?.value ?? 0,
    },
    byCategory,
    series,
    topAccounts,
  };
}
