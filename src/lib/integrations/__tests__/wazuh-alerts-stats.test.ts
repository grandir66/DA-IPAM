import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATS_WINDOWS,
  SYSTEM_FILTERS,
  bucketIntervalFor,
  buildStatsQuery,
  parseStatsResponse,
  sinceForWindow,
  splitCategories,
} from "../wazuh-alerts-stats";

test("every selectable window declares a label and a duration", () => {
  assert.ok(STATS_WINDOWS.length >= 3);
  for (const w of STATS_WINDOWS) {
    assert.ok(w.id.length > 0);
    assert.ok(w.labelIt.length > 1, w.id);
    assert.ok(w.hours > 0, w.id);
  }
});

test("the shortest window is one hour, for looking at what is happening now", () => {
  const w = STATS_WINDOWS.find((x) => x.id === "1h");
  assert.ok(w, "manca la finestra di un'ora");
  assert.equal(w!.hours, 1);
  // deve restare la piu' stretta, cioe' la prima
  assert.equal(STATS_WINDOWS[0]!.id, "1h");
});

test("the bucket width follows the window so the chart never has 700 columns", () => {
  // un'ora con bucket orari darebbe UNA colonna: serve scendere a 5 minuti
  assert.equal(bucketIntervalFor(1), "5m");
  assert.equal(bucketIntervalFor(24), "1h");
  assert.equal(bucketIntervalFor(24 * 7), "6h");
  assert.equal(bucketIntervalFor(24 * 30), "1d");
});

test("sinceForWindow goes back from the given instant", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  assert.equal(sinceForWindow(24, now), "2026-07-26T12:00:00.000Z");
});

test("the query buckets over time and splits by category", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  assert.equal(q.size, 0);
  const cats = Object.keys(q.aggs.per_category.filters.filters);
  assert.ok(cats.includes("ransomware"));
  assert.ok(cats.includes("auth_failure"));
  // self_probe è assegnata per riclassificazione: non ha una query propria
  assert.ok(!cats.includes("self_probe"));
  assert.equal(q.aggs.per_category.aggs.over_time.date_histogram.fixed_interval, "1h");
});

test("categories are mutually exclusive so a document is counted once", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  const filters = q.aggs.per_category.filters.filters;
  const ids = Object.keys(filters);
  // la prima categoria non esclude nulla, le successive escludono le precedenti
  const first = filters[ids[0]!]!;
  const second = filters[ids[1]!]!;
  assert.equal(first.bool.must_not.length, 0);
  assert.ok(second.bool.must_not.length > 0);
});

test("parseStatsResponse turns the aggregation into rows a chart can draw", () => {
  const raw = {
    hits: { total: { value: 2156 } },
    aggregations: {
      agents: { value: 55 },
      rules: { value: 11 },
      per_category: {
        buckets: {
          auth_failure: {
            doc_count: 1513,
            over_time: {
              buckets: [
                { key_as_string: "2026-07-27T10:00:00.000Z", key: 1, doc_count: 900 },
                { key_as_string: "2026-07-27T11:00:00.000Z", key: 2, doc_count: 613 },
              ],
            },
          },
          ransomware: {
            doc_count: 55,
            over_time: {
              buckets: [
                { key_as_string: "2026-07-27T10:00:00.000Z", key: 1, doc_count: 55 },
                { key_as_string: "2026-07-27T11:00:00.000Z", key: 2, doc_count: 0 },
              ],
            },
          },
        },
      },
    },
  };
  const s = parseStatsResponse(raw);
  assert.equal(s.totals.alerts, 2156);
  assert.equal(s.totals.agents, 55);
  assert.equal(s.totals.rules, 11);

  const auth = s.byCategory.find((c) => c.id === "auth_failure")!;
  assert.equal(auth.count, 1513);
  assert.ok(auth.labelIt.length > 0);
  // ordinata per volume decrescente: la fetta piu' grande prima
  assert.equal(s.byCategory[0]!.id, "auth_failure");

  assert.equal(s.series.length, 2);
  assert.equal(s.series[0]!.bucket, "2026-07-27T10:00:00.000Z");
  assert.equal(s.series[0]!.auth_failure, 900);
  assert.equal(s.series[0]!.ransomware, 55);
  assert.equal(s.series[1]!.auth_failure, 613);
});

test("an empty aggregation yields empty rows, not a crash", () => {
  const s = parseStatsResponse({ hits: { total: { value: 0 } }, aggregations: {} });
  assert.equal(s.totals.alerts, 0);
  assert.deepEqual(s.series, []);
  assert.deepEqual(s.byCategory, []);
});

test("categories with zero hits are dropped from the pie", () => {
  const s = parseStatsResponse({
    hits: { total: { value: 5 } },
    aggregations: {
      per_category: {
        buckets: {
          auth_failure: { doc_count: 5, over_time: { buckets: [] } },
          ransomware: { doc_count: 0, over_time: { buckets: [] } },
        },
      },
    },
  });
  assert.equal(s.byCategory.length, 1);
  assert.equal(s.byCategory[0]!.id, "auth_failure");
});

test("the query asks who is being targeted, not just where", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  const acc = q.aggs.accounts;
  assert.ok(acc, "manca l'aggregazione sugli account");
  assert.equal(acc.aggs.by_user.terms.field, "data.win.eventdata.targetUserName");
  // l'origine e' la parte azionabile: dice DA DOVE partono i tentativi
  assert.ok(acc.aggs.by_user.aggs.top_source);
  assert.ok(acc.aggs.by_user.aggs.top_workstation);
});

test("our own service accounts are kept out of the targeted list", () => {
  const q = buildStatsQuery({
    since: "2026-07-26T12:00:00.000Z",
    interval: "1h",
    excludeAccounts: ["domarc"],
  });
  const mustNot = q.aggs.accounts.filter.bool.must_not;
  assert.ok(
    mustNot.some((m) => JSON.stringify(m).includes("domarc")),
    "l'account di servizio non e' escluso",
  );
});

test("without exclusions the account filter stays permissive", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  assert.deepEqual(q.aggs.accounts.filter.bool.must_not, []);
});

test("parseStatsResponse ranks the targeted accounts with their origin", () => {
  const s = parseStatsResponse({
    hits: { total: { value: 10 } },
    aggregations: {
      accounts: {
        by_user: {
          buckets: [
            {
              key: "gs.sicurezza",
              doc_count: 1438,
              top_source: { buckets: [{ key: "::ffff:172.16.1.154" }] },
              top_workstation: { buckets: [{ key: "SRV-WIN2025" }] },
              last_seen: { value_as_string: "2026-07-27T10:00:00.000Z" },
            },
            { key: "mrossi", doc_count: 12, top_source: { buckets: [] }, top_workstation: { buckets: [] } },
          ],
        },
      },
    },
  });
  assert.equal(s.topAccounts.length, 2);
  const first = s.topAccounts[0]!;
  assert.equal(first.account, "gs.sicurezza");
  assert.equal(first.count, 1438);
  // l'IP viene normalizzato: Windows lo scrive in forma mappata
  assert.equal(first.sourceIp, "172.16.1.154");
  assert.equal(first.workstation, "SRV-WIN2025");
  assert.equal(s.topAccounts[1]!.sourceIp, null);
});

test("no account aggregation yields an empty ranking, not a crash", () => {
  const s = parseStatsResponse({ hits: { total: { value: 0 } }, aggregations: {} });
  assert.deepEqual(s.topAccounts, []);
});

test("the account aggregation covers Windows, Microsoft 365 and Linux", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  const a = q.aggs.accounts.aggs;
  assert.equal(a.by_user.terms.field, "data.win.eventdata.targetUserName");
  assert.equal(a.by_user_cloud.aggs.u.terms.field, "data.office365.UserId");
  assert.equal(a.by_user_unix.terms.field, "data.srcuser");
  // i login cloud RIUSCITI non sono fallimenti: filtrati sull'Operation
  assert.ok(JSON.stringify(a.by_user_cloud.filter).includes("UserLoginFailed"));
});

test("accounts from different systems are merged and ranked together", () => {
  const s = parseStatsResponse({
    hits: { total: { value: 100 } },
    aggregations: {
      accounts: {
        by_user: {
          buckets: [
            { key: "PC-MARIO$", doc_count: 40, top_source: { buckets: [] }, top_workstation: { buckets: [{ key: "PC-MARIO" }] } },
          ],
        },
        by_user_cloud: {
          u: {
            buckets: [
              { key: "celestiano@acme.it", doc_count: 69, top_source: { buckets: [{ key: "203.0.113.9" }] } },
            ],
          },
        },
        by_user_unix: {
          buckets: [{ key: "root", doc_count: 12, top_source: { buckets: [{ key: "192.0.2.7" }] } }],
        },
      },
    },
  });
  assert.equal(s.topAccounts.length, 3);
  // ordinati per volume, non per sorgente
  assert.equal(s.topAccounts[0]!.account, "celestiano@acme.it");
  assert.equal(s.topAccounts[0]!.system, "microsoft365");
  assert.equal(s.topAccounts[1]!.account, "PC-MARIO$");
  assert.equal(s.topAccounts[1]!.system, "windows");
  // l'account macchina va distinto da una persona
  assert.equal(s.topAccounts[1]!.kind, "computer");
  assert.equal(s.topAccounts[2]!.system, "linux");
  assert.equal(s.topAccounts[2]!.kind, "utente");
});

test("the self-account exclusion covers every user field, not just Windows", () => {
  // Visto a schermo: "domarc" compariva fra i bersagliati perche' l'esclusione
  // filtrava solo data.win.eventdata.targetUserName, mentre i decoder Linux
  // usano data.srcuser.
  const q = buildStatsQuery({
    since: "2026-07-26T12:00:00.000Z",
    interval: "1h",
    excludeAccounts: ["domarc"],
  });
  const json = JSON.stringify(q.aggs.accounts.filter.bool.must_not);
  assert.ok(json.includes("data.win.eventdata.targetUserName"), "manca il campo Windows");
  assert.ok(json.includes("data.srcuser"), "manca il campo dei decoder generici");
  assert.ok(json.includes("data.dstuser"), "manca dstuser");
  assert.ok(json.includes("data.office365.UserId"), "manca il campo Microsoft 365");
});

test("the account ranking goes deep enough not to lose the long tail", () => {
  // Con un tetto a 10 chi sbaglia poche volte spariva: la coda lunga e' spesso
  // il segnale piu' interessante (un attaccante che prova un account per volta).
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  assert.ok(q.aggs.accounts.aggs.by_user.terms.size >= 100);
  assert.ok(q.aggs.accounts.aggs.by_user_cloud.aggs.u.terms.size >= 100);
});

test("successful logins never reach the account ranking", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  assert.ok(JSON.stringify(q.query.bool).includes("authentication_success"));
});

test("who reported the alert is kept separate from where it came from", () => {
  // Erano confusi: la colonna origine mostrava di fatto l'agent che ha inviato
  // l'alert (quasi sempre il domain controller), non da dove partiva il tentativo.
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  assert.ok(q.aggs.accounts.aggs.by_user.aggs.top_agent, "manca l'agent che rileva");

  const s = parseStatsResponse({
    hits: { total: { value: 1 } },
    aggregations: {
      accounts: {
        by_user: {
          buckets: [
            {
              key: "DA-SYN-VM$",
              doc_count: 1127,
              top_source: { buckets: [{ key: "192.168.4.27" }] },
              top_workstation: { buckets: [{ key: "DA-SYN-VM" }] },
              top_agent: { buckets: [{ key: "SRV-DC01" }] },
            },
          ],
        },
      },
    },
  });
  assert.equal(s.topAccounts[0]!.detectedBy, "SRV-DC01");
  assert.equal(s.topAccounts[0]!.sourceIp, "192.168.4.27");
});

test("our own scanner is excluded by IP too, not only by account name", () => {
  // Visto a schermo: dall'IP dell'appliance partivano tentativi su "admin",
  // "karaf", "oracle" — cioe' il nostro scanner che prova credenziali note.
  // Filtrare solo per nome account non li toglieva.
  const q = buildStatsQuery({
    since: "2026-07-26T12:00:00.000Z",
    interval: "1h",
    excludeAccounts: ["domarc"],
    excludeIps: ["192.168.4.8"],
  });
  const json = JSON.stringify(q.aggs.accounts.filter.bool.must_not);
  assert.ok(json.includes("192.168.4.8"));
  assert.ok(json.includes("data.srcip"));
  assert.ok(json.includes("data.win.eventdata.ipAddress"));
});

// ── Le tre dimensioni diagnostiche + filtro per sistema ─────────────────────

test("every selectable system declares a label and a filter", () => {
  assert.ok(SYSTEM_FILTERS.length >= 4);
  for (const s of SYSTEM_FILTERS) {
    assert.ok(s.id.length > 0);
    assert.ok(s.labelIt.length > 1, s.id);
    assert.ok(s.match.length > 0, s.id);
  }
  assert.ok(SYSTEM_FILTERS.some((s) => s.id === "vpn"), "la VPN deve restare selezionabile");
});

test("the query can be narrowed to a single system", () => {
  const all = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  const win = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h", system: "windows" });
  assert.equal(JSON.stringify(all.query).includes('"windows"'), false);
  assert.ok(JSON.stringify(win.query).includes('"windows"'));
});

test("an unknown system id is ignored rather than emptying the result", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h", system: "chissa" });
  assert.equal(JSON.stringify(q.query).includes("chissa"), false);
});

test("the query ranks destination and request origin, not only the account", () => {
  const q = buildStatsQuery({ since: "2026-07-26T12:00:00.000Z", interval: "1h" });
  // dove avviene la violazione
  assert.equal(q.aggs.targets.aggs.r.terms.field, "agent.name");
  // da dove parte la richiesta: ogni sorgente usa un campo diverso
  // le sotto-aggregazioni vanno sotto `aggs`, altrimenti OpenSearch legge il
  // nome come un tipo di aggregazione e risponde 400
  assert.ok(q.aggs.sources.filter, "sources deve essere un'aggregazione a bucket");
  assert.equal(q.aggs.sources.aggs.by_win.terms.field, "data.win.eventdata.ipAddress");
  assert.equal(q.aggs.sources.aggs.by_unix.terms.field, "data.srcip");
  assert.equal(q.aggs.sources.aggs.by_cloud.terms.field, "data.office365.ClientIP");
  assert.equal(
    q.aggs.sources.aggs.by_workstation.terms.field,
    "data.win.eventdata.workstationName",
  );
});

test("parseStatsResponse returns the three rankings ready to render", () => {
  const s = parseStatsResponse({
    hits: { total: { value: 100 } },
    aggregations: {
      targets: {
        r: { buckets: [
          {
            key: "DA-RDP",
            doc_count: 90,
            top_user: { buckets: [{ key: "pippo" }] },
            top_source: { buckets: [{ key: "85.34.43.2" }] },
            last_seen: { value_as_string: "2026-07-28T09:00:00.000Z" },
          },
        ] },
      },
      sources: {
        by_win: { buckets: [{ key: "::ffff:85.34.43.2", doc_count: 90, top_user: { buckets: [{ key: "pippo" }] } }] },
        by_workstation: { buckets: [{ key: "WKS-05", doc_count: 90, top_user: { buckets: [] } }] },
      },
    },
  });
  assert.equal(s.byTarget[0]!.key, "DA-RDP");
  assert.equal(s.byTarget[0]!.count, 90);
  assert.equal(s.byTarget[0]!.detail, "pippo");

  const ip = s.bySource.find((x) => x.key === "85.34.43.2");
  assert.ok(ip, "l'IP deve comparire normalizzato");
  assert.equal(ip!.count, 90);
  assert.ok(s.bySource.some((x) => x.key === "WKS-05"), "anche la postazione e' un'origine");
});

test("empty aggregations give empty rankings, not a crash", () => {
  const s = parseStatsResponse({ hits: { total: { value: 0 } }, aggregations: {} });
  assert.deepEqual(s.byTarget, []);
  assert.deepEqual(s.bySource, []);
});

test("our own activity is excluded from every ranking, not just the accounts", () => {
  // Visto a schermo: il nostro scanner sui MikroTik era la prima origine con
  // 5.2K tentativi. Se e' nostro non e' un attacco, in nessuna delle tabelle.
  const q = buildStatsQuery({
    since: "2026-07-26T12:00:00.000Z",
    interval: "1h",
    excludeAccounts: ["domarc"],
    excludeIps: ["192.168.4.8"],
  });
  for (const [name, agg] of [
    ["targets", q.aggs.targets],
    ["sources", q.aggs.sources],
  ] as const) {
    const json = JSON.stringify((agg as { filter?: unknown }).filter);
    assert.ok(json.includes("192.168.4.8"), `${name} non esclude i nostri IP`);
  }
});

test("our own probing is counted as self_probe, not as an attack", () => {
  // Bug visto a schermo: con filtro Linux l'istogramma contava 215 alert ma le
  // classifiche erano vuote, perche' l'esclusione valeva solo per le tabelle.
  // Ora il traffico nostro finisce nella sua categoria: totali e tabelle
  // raccontano la stessa storia.
  const q = buildStatsQuery({
    since: "2026-07-28T09:00:00.000Z",
    interval: "5m",
    excludeAccounts: ["domarc"],
    excludeIps: ["192.168.4.8"],
  });
  const f = q.aggs.per_category.filters.filters;
  assert.ok(f.self_probe, "manca la categoria delle nostre sonde");
  const json = JSON.stringify(f.self_probe);
  assert.ok(json.includes("192.168.4.8") && json.includes("domarc"));
  // e auth_failure non deve piu' rivendicarli
  assert.ok(JSON.stringify(f.auth_failure!.bool.must_not).includes("192.168.4.8"));
});

test("without declared identities there is no self_probe bucket", () => {
  const q = buildStatsQuery({ since: "2026-07-28T09:00:00.000Z", interval: "5m" });
  assert.equal(q.aggs.per_category.filters.filters.self_probe, undefined);
});

test("diagnostic activity stays out of the hero chart but is not lost", () => {
  // Segnalato a schermo: rese categoria a pieno titolo, le nostre sonde
  // facevano colonne altissime che annegavano gli attacchi veri. Il grafico
  // principale racconta gli attacchi; il resto resta visibile a parte.
  const split = splitCategories([
    { id: "self_probe", labelIt: "Attività delle nostre sonde", count: 215, diagnostic: true },
    { id: "auth_failure", labelIt: "Autenticazioni fallite", count: 12, diagnostic: false },
    { id: "agent_health", labelIt: "Salute agent", count: 3, diagnostic: true },
  ]);
  assert.deepEqual(
    split.attacks.map((c) => c.id),
    ["auth_failure"],
  );
  assert.deepEqual(
    split.diagnostic.map((c) => c.id),
    ["self_probe", "agent_health"],
  );
  assert.equal(split.attackTotal, 12);
  assert.equal(split.diagnosticTotal, 218);
});

test("with only our own probes the attack total is zero, not 215", () => {
  const split = splitCategories([
    { id: "self_probe", labelIt: "Attività delle nostre sonde", count: 215, diagnostic: true },
  ]);
  assert.equal(split.attacks.length, 0);
  assert.equal(split.attackTotal, 0);
  assert.equal(split.diagnosticTotal, 215);
});
