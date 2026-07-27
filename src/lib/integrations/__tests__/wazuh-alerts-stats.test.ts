import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATS_WINDOWS,
  bucketIntervalFor,
  buildStatsQuery,
  parseStatsResponse,
  sinceForWindow,
} from "../wazuh-alerts-stats";

test("every selectable window declares a label and a duration", () => {
  assert.ok(STATS_WINDOWS.length >= 3);
  for (const w of STATS_WINDOWS) {
    assert.ok(w.id.length > 0);
    assert.ok(w.labelIt.length > 1, w.id);
    assert.ok(w.hours > 0, w.id);
  }
});

test("the bucket width follows the window so the chart never has 700 columns", () => {
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
