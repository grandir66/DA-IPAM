import { test } from "node:test";
import assert from "node:assert/strict";
import { toHubExport } from "../export";
import { ENGINE_VERSION } from "../types";
import type { HealthFinding, HealthScore } from "../types";

const SCORE: HealthScore = {
  global: 35,
  stale: 0,
  privileged: 0,
  trust: 5,
  anomaly: 35,
};

const FINDINGS: HealthFinding[] = [
  {
    ruleId: "DA-A-GuestEnabled",
    axis: "anomaly",
    points: 20,
    severity: "High",
    title: "Guest account enabled",
    description: "Guest is enabled",
    objectCount: 1,
    sampleDns: ["CN=Guest,CN=Users,DC=contoso,DC=local"],
  },
  {
    ruleId: "DA-A-DomainScore",
    axis: "score",
    points: 35,
    severity: "Critical",
    title: "Domain health score",
    description: "global: 35 stale: 0 privileged: 0 trust: 5 anomaly: 35",
    objectCount: 0,
    sampleDns: [],
  },
];

test("toHubExport sets source, engine_version, scores and JSON keys", () => {
  const at = new Date("2026-07-25T15:00:00.000Z");
  const exp = toHubExport({
    domainFqdn: "contoso.local",
    score: SCORE,
    findings: FINDINGS,
    generatedAt: at,
  });

  assert.equal(exp.source, "domarc-ad-health");
  assert.equal(exp.domain_fqdn, "contoso.local");
  assert.equal(exp.engine_version, ENGINE_VERSION);
  assert.equal(exp.generated_at, "2026-07-25T15:00:00.000Z");
  assert.deepEqual(exp.scores, SCORE);

  const keys = Object.keys(exp).sort();
  assert.deepEqual(keys, [
    "domain_fqdn",
    "engine_version",
    "findings",
    "generated_at",
    "scores",
    "source",
  ]);
});

test("toHubExport maps findings with DA-* nvt_oid and source_kind", () => {
  const exp = toHubExport({
    domainFqdn: "contoso.local",
    score: SCORE,
    findings: FINDINGS,
    generatedAt: new Date("2026-07-25T15:00:00.000Z"),
  });

  assert.equal(exp.findings.length, 2);

  for (const f of exp.findings) {
    assert.equal(f.ip, null);
    assert.equal(f.hostname, "contoso.local");
    assert.match(f.nvt_oid, /^DA-/);
    const fKeys = Object.keys(f).sort();
    assert.deepEqual(fKeys, [
      "cvss_score",
      "description",
      "hostname",
      "ip",
      "nvt_name",
      "nvt_oid",
      "raw_json",
      "severity",
      "source_kind",
    ]);
  }

  const guest = exp.findings.find((f) => f.nvt_oid === "DA-A-GuestEnabled")!;
  assert.equal(guest.source_kind, "ad_misconfig");
  assert.equal(guest.severity, "High");
  assert.equal(guest.nvt_name, "Guest account enabled");
  assert.equal(guest.description, "Guest is enabled");
  assert.equal(guest.cvss_score, 8);
  const guestRaw = JSON.parse(guest.raw_json) as Record<string, unknown>;
  assert.equal(guestRaw.ruleId, "DA-A-GuestEnabled");
  assert.equal(guestRaw.points, 20);

  const ds = exp.findings.find((f) => f.nvt_oid === "DA-A-DomainScore")!;
  assert.equal(ds.source_kind, "risk_indicator");
  assert.equal(ds.cvss_score, 3.5); // global/10
});

test("diagnostic findings reach the hub as indicators, not vulnerabilities", () => {
  const exp = toHubExport({
    domainFqdn: "contoso.local",
    score: SCORE,
    findings: [
      {
        ruleId: "DA-A-LdapCollectPartial",
        axis: "anomaly",
        points: 0,
        severity: "High",
        title: "LDAP collect incomplete",
        description: "users query failed",
        objectCount: 1,
        sampleDns: ["users"],
        diagnostic: true,
      },
    ],
  });

  const f = exp.findings[0]!;
  assert.equal(f.source_kind, "risk_indicator");
  assert.equal(f.cvss_score, 0);
});
