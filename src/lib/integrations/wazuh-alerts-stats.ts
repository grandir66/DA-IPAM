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

/**
 * Sistemi selezionabili come filtro. Il match e' su rule.groups: sono le
 * etichette che Wazuh assegna in base al decoder, quindi dicono da che mondo
 * arriva l'alert. La VPN resta in elenco anche dove nessun apparato la manda:
 * meglio una lista vuota che far credere che la voce non esista.
 */
export interface SystemFilter {
  id: string;
  labelIt: string;
  /** rule.groups che identificano il sistema. */
  match: string[];
}

export const SYSTEM_FILTERS: SystemFilter[] = [
  { id: "windows", labelIt: "Windows", match: ["windows", "windows_security"] },
  { id: "microsoft365", labelIt: "Microsoft 365", match: ["office365"] },
  { id: "linux", labelIt: "Linux", match: ["sshd", "pam", "sudo"] },
  { id: "vpn", labelIt: "VPN / apparati", match: ["fortigate", "pfsense", "openvpn", "radius", "vpn", "cisco"] },
];

export function systemFilterById(id: string | undefined): SystemFilter | undefined {
  return id ? SYSTEM_FILTERS.find((s) => s.id === id) : undefined;
}

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
    /** Dove avviene la violazione. */
    targets: RankedAgg;
    /**
     * Da dove parte la richiesta: IP e postazione, per ogni sorgente.
     * Deve essere un'aggregazione a bucket con le sue sotto-aggregazioni sotto
     * `aggs`: un oggetto nudo verrebbe letto come un TIPO di aggregazione
     * inesistente ("Unknown aggregation type [by_win]").
     */
    sources: {
      filter: { match_all: Record<string, never> };
      aggs: {
        by_win: RankedAgg;
        by_unix: RankedAgg;
        by_cloud: RankedAgg;
        by_workstation: RankedAgg;
      };
    };
  };
}

interface RankedAgg {
  terms: { field: string; size: number };
  aggs: {
    top_user: { terms: { field: string; size: number } };
    top_source?: { terms: { field: string; size: number } };
    last_seen: { max: { field: string } };
  };
}

function ranked(field: string, userField: string, sourceField?: string): RankedAgg {
  return {
    terms: { field, size: TOP_ACCOUNTS },
    aggs: {
      top_user: { terms: { field: userField, size: 1 } },
      ...(sourceField ? { top_source: { terms: { field: sourceField, size: 1 } } } : {}),
      last_seen: { max: { field: "@timestamp" } },
    },
  };
}

export function buildStatsQuery(args: {
  since: string;
  interval: string;
  /** Account di servizio nostri: fuori dalla classifica dei bersagliati. */
  excludeAccounts?: string[];
  /** IP nostri: il nostro scanner prova credenziali note (admin, oracle, …). */
  excludeIps?: string[];
  /** Restringe a un solo sistema (windows | microsoft365 | linux | vpn). */
  system?: string;
}): StatsQuery {
  const sys = systemFilterById(args.system);
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
          ...(sys ? [{ terms: { "rule.groups": sys.match } }] : []),
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
      targets: ranked(
        "agent.name",
        "data.win.eventdata.targetUserName",
        "data.win.eventdata.ipAddress",
      ),
      sources: {
        filter: { match_all: {} },
        aggs: {
          by_win: ranked("data.win.eventdata.ipAddress", "data.win.eventdata.targetUserName"),
          by_unix: ranked("data.srcip", "data.srcuser"),
          by_cloud: ranked("data.office365.ClientIP", "data.office365.UserId"),
          by_workstation: ranked(
            "data.win.eventdata.workstationName",
            "data.win.eventdata.targetUserName",
          ),
        },
      },
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

/** Riga di una classifica diagnostica. */
export interface RankedEntry {
  key: string;
  count: number;
  /** Contesto: per la destinazione l'utente piu' colpito, per l'origine chi prova. */
  detail: string | null;
  lastSeenAt: string | null;
}

export interface AlertStats {
  totals: { alerts: number; agents: number; rules: number };
  byCategory: CategorySlice[];
  series: SeriesRow[];
  topAccounts: TargetedAccount[];
  /** Dove avviene la violazione (host che registra il fallimento). */
  byTarget: RankedEntry[];
  /** Da dove parte la richiesta: IP pubblici/privati e postazioni. */
  bySource: RankedEntry[];
}

interface UserBucket {
  key?: string;
  doc_count?: number;
  top_source?: { buckets?: TermsBucket[] };
  top_workstation?: { buckets?: TermsBucket[] };
  top_agent?: { buckets?: TermsBucket[] };
  last_seen?: { value_as_string?: string };
}

interface RankedBucket {
  key?: string;
  doc_count?: number;
  top_user?: { buckets?: TermsBucket[] };
  top_source?: { buckets?: TermsBucket[] };
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
    targets?: { buckets?: RankedBucket[] };
    sources?: {
      by_win?: { buckets?: RankedBucket[] };
      by_unix?: { buckets?: RankedBucket[] };
      by_cloud?: { buckets?: RankedBucket[] };
      by_workstation?: { buckets?: RankedBucket[] };
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

  const rank = (buckets: RankedBucket[] | undefined, normalize = false): RankedEntry[] =>
    (buckets ?? [])
      .map((b) => ({
        key: (normalize ? normalizeIp(b.key) : (b.key ?? null)) ?? "",
        count: b.doc_count ?? 0,
        detail: b.top_user?.buckets?.[0]?.key ?? b.top_source?.buckets?.[0]?.key ?? null,
        lastSeenAt: b.last_seen?.value_as_string ?? null,
      }))
      .filter((e) => e.key !== "" && e.key !== "-");

  // Le origini arrivano da campi diversi: si uniscono e si ordinano insieme,
  // cosi' un IP pubblico e una postazione interna stanno nella stessa classifica.
  const src = raw.aggregations?.sources;
  const bySource = [
    ...rank(src?.by_win?.buckets, true),
    ...rank(src?.by_unix?.buckets, true),
    ...rank(src?.by_cloud?.buckets, true),
    ...rank(src?.by_workstation?.buckets),
  ].sort((a, b) => b.count - a.count);

  return {
    byTarget: rank(raw.aggregations?.targets?.buckets).sort((a, b) => b.count - a.count),
    bySource,
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
