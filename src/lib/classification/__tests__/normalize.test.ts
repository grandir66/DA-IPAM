/**
 * Smoke import tipi/pesi (Task 1). Esteso in Task 2 con normalizeToEvidence.
 * Run: node --import tsx --test src/lib/classification/__tests__/normalize.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE_VERSION,
  CONFLICT_WINDOW,
  MIN_APPLY_CONFIDENCE,
  MAX_EVIDENCE_KEPT,
  HISTORY_CONFIDENCE_DELTA,
  type EvidenceSource,
} from "../types";
import { SOURCE_WEIGHTS } from "../weights";

test("ENGINE_VERSION e costanti policy", () => {
  assert.equal(ENGINE_VERSION, "0.1.0");
  assert.equal(CONFLICT_WINDOW, 10);
  assert.equal(MIN_APPLY_CONFIDENCE, 56);
  assert.equal(MAX_EVIDENCE_KEPT, 20);
  assert.equal(HISTORY_CONFIDENCE_DELTA, 5);
});

test("SOURCE_WEIGHTS copre ogni EvidenceSource con pesi 0–1", () => {
  const sources: EvidenceSource[] = [
    "naabu", "nmap", "snmp", "http", "ssh", "smb",
    "mac_oui", "dns", "ttl", "rule",
  ];
  assert.deepEqual(Object.keys(SOURCE_WEIGHTS).sort(), [...sources].sort());
  for (const source of sources) {
    const w = SOURCE_WEIGHTS[source];
    assert.ok(w > 0 && w <= 1, `${source} weight out of range: ${w}`);
  }
  assert.equal(SOURCE_WEIGHTS.snmp, 0.95);
  assert.equal(SOURCE_WEIGHTS.http, 0.9);
  assert.equal(SOURCE_WEIGHTS.smb, 0.75);
  assert.equal(SOURCE_WEIGHTS.ssh, 0.55);
  assert.equal(SOURCE_WEIGHTS.mac_oui, 0.4);
  assert.equal(SOURCE_WEIGHTS.nmap, 0.45);
  assert.equal(SOURCE_WEIGHTS.dns, 0.35);
  assert.equal(SOURCE_WEIGHTS.ttl, 0.25);
  assert.equal(SOURCE_WEIGHTS.naabu, 0.2);
  assert.equal(SOURCE_WEIGHTS.rule, 0.7);
});
