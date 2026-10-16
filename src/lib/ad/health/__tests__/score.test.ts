import { test } from "node:test";
import assert from "node:assert/strict";
import { severityFromPoints, aggregateScores } from "../score";
import type { HealthFinding } from "../types";

test("severityFromPoints thresholds", () => {
  assert.equal(severityFromPoints(30), "Critical");
  assert.equal(severityFromPoints(20), "High");
  assert.equal(severityFromPoints(10), "Medium");
  assert.equal(severityFromPoints(1), "Low");
  assert.equal(severityFromPoints(0), "Low");
});

test("aggregateScores takes max axis and caps at 100", () => {
  const findings: HealthFinding[] = [
    { ruleId: "DA-S-X", axis: "stale", points: 60, severity: "Critical", title: "t", description: "d", objectCount: 1, sampleDns: [] },
    { ruleId: "DA-S-Y", axis: "stale", points: 50, severity: "Critical", title: "t", description: "d", objectCount: 1, sampleDns: [] },
    { ruleId: "DA-P-X", axis: "privileged", points: 30, severity: "Critical", title: "t", description: "d", objectCount: 1, sampleDns: [] },
  ];
  const s = aggregateScores(findings);
  assert.equal(s.stale, 100); // 60+50 capped
  assert.equal(s.privileged, 30);
  assert.equal(s.trust, 0);
  assert.equal(s.anomaly, 0);
  assert.equal(s.global, 100);
});

test("aggregateScores ignores diagnostic findings", () => {
  const findings: HealthFinding[] = [
    {
      ruleId: "DA-A-LdapCollectPartial",
      axis: "anomaly",
      points: 20,
      severity: "High",
      title: "t",
      description: "d",
      objectCount: 0,
      sampleDns: [],
      diagnostic: true,
    },
    {
      ruleId: "DA-A-GuestEnabled",
      axis: "anomaly",
      points: 20,
      severity: "High",
      title: "t",
      description: "d",
      objectCount: 1,
      sampleDns: [],
    },
  ];
  const s = aggregateScores(findings);
  // only the real finding counts, not the collector diagnostic
  assert.equal(s.anomaly, 20);
  assert.equal(s.global, 20);
});
