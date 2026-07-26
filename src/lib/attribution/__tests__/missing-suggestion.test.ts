import { describe, it } from "node:test";
import assert from "node:assert";
import { buildMissingSuggestion } from "../missing";
import type { AttributionResult } from "../fuse";

function res(category: string | null, os: string | null): AttributionResult {
  const dim = { confidence: 0, min_phase: null, evidence_ids: [], conflicts: [], authoritative: false };
  return {
    vendor: { ...dim, claim: "ubiquiti", vendor_name: null },
    category: { ...dim, claim: category },
    os: { ...dim, claim: os, os_name: null },
    engine_version: "2.0.0",
  };
}

describe("buildMissingSuggestion", () => {
  it("categoria assente → suggerisce SNMP", () => {
    assert.match(buildMissingSuggestion(res(null, null)) ?? "", /SNMP/);
  });
  it("livello 1 → suggerisce SNMP per la foglia", () => {
    assert.match(buildMissingSuggestion(res("network", "linux")) ?? "", /livello 1/);
  });
  it("categoria ok ma os assente → suggerisce nmap/credenziali", () => {
    assert.match(buildMissingSuggestion(res("network.switch", null)) ?? "", /OS non attribuito/);
  });
  it("tutto risolto → null", () => {
    assert.equal(buildMissingSuggestion(res("network.switch", "network-os")), null);
  });
});
