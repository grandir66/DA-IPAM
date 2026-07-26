import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES } from "../rules";
import {
  actionableFindings,
  getRuleGuide,
  groupFindingsForUi,
} from "../rule-catalog";
import type { HealthFinding } from "../types";

test("every ALL_RULES id has a non-fallback Italian guide", () => {
  for (const r of ALL_RULES) {
    const g = getRuleGuide(r.id);
    assert.notEqual(g.titleIt, r.id, r.id);
    assert.ok(g.why.length > 20, r.id);
    assert.ok(g.fix.length > 10, r.id);
  }
  const ds = getRuleGuide("DA-A-DomainScore");
  assert.ok(ds.why.includes("aggregato"));
});

test("groupFindingsForUi orders by axis and severity", () => {
  const findings: HealthFinding[] = [
    {
      ruleId: "DA-S-InactiveUser",
      axis: "stale",
      points: 10,
      severity: "Low",
      title: "x",
      description: "",
      objectCount: 1,
      sampleDns: [],
    },
    {
      ruleId: "DA-P-DCSyncRights",
      axis: "privileged",
      points: 40,
      severity: "Critical",
      title: "x",
      description: "",
      objectCount: 2,
      sampleDns: [],
    },
    {
      ruleId: "DA-A-DomainScore",
      axis: "score",
      points: 40,
      severity: "Critical",
      title: "x",
      description: "",
      objectCount: 0,
      sampleDns: [],
    },
  ];
  const groups = groupFindingsForUi(findings);
  assert.equal(groups[0]!.axis, "privileged");
  assert.equal(groups[1]!.axis, "stale");
  assert.equal(actionableFindings(findings).length, 2);
});
