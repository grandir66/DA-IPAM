import { describe, it } from "node:test";
import assert from "node:assert";
import { fuseAttribution } from "../fuse";
import type { AttributionEvidenceRow } from "../types";

const NOW = "2026-07-26T12:00:00Z";
let nextId = 1;
function ev(partial: Partial<AttributionEvidenceRow> & Pick<AttributionEvidenceRow, "source" | "dimension" | "claim">): AttributionEvidenceRow {
  return {
    id: nextId++, host_id: 1, phase: "scan_icmp", confidence: 0.9, weight: 0.9,
    raw_value: null, observed_at: NOW, expires_at: null, superseded_by: null,
    ...partial,
  } as AttributionEvidenceRow;
}

describe("fuseAttribution", () => {
  it("solo fase ICMP: vendor da OUI, categoria livello 1 assente se sotto soglia", () => {
    const r = fuseAttribution([
      ev({ source: "oui", dimension: "vendor", claim: "ubiquiti", raw_value: "Ubiquiti Inc", confidence: 0.9, weight: 0.9 }),
      ev({ source: "hostname", dimension: "category", claim: "network.access_point", confidence: 0.5, weight: 0.35 }),
    ], NOW);
    assert.equal(r.vendor.claim, "ubiquiti");
    assert.equal(r.vendor.vendor_name, "Ubiquiti Inc");
    assert.equal(r.vendor.min_phase, "scan_icmp");
    assert.equal(r.category.claim, null); // 0.5*0.35=0.175 < 0.56
  });
  it("AP Ubiquiti: sysDescr + hostname concordi superano la soglia sul livello 2", () => {
    const r = fuseAttribution([
      ev({ source: "snmp_sysdescr", dimension: "category", claim: "network.access_point", confidence: 0.85, weight: 0.85, phase: "scan_snmp_verify" }),
      ev({ source: "hostname", dimension: "category", claim: "network.access_point", confidence: 0.5, weight: 0.35 }),
    ], NOW);
    assert.equal(r.category.claim, "network.access_point");
    assert.equal(r.category.min_phase, "scan_snmp_verify"); // fase più avanzata citata
    assert.ok(r.category.confidence >= 56);
  });
  it("switch con hostname fuorviante ap-piano2: conflitto pari livello → ripiega su network", () => {
    const r = fuseAttribution([
      ev({ source: "snmp_sysdescr", dimension: "category", claim: "network.switch", confidence: 0.8, weight: 0.85, phase: "scan_snmp_verify" }),
      ev({ source: "hostname", dimension: "category", claim: "network.access_point", confidence: 0.9, weight: 0.7, raw_value: "ap-piano2" }),
    ], NOW);
    // score switch=0.68, ap=0.63 → delta 0.05 < 0.10 → padre comune
    assert.equal(r.category.claim, "network");
    assert.equal(r.category.conflicts.length, 1);
  });
  it("AD è autoritativo sull'OS e vince su nmap discordante", () => {
    const r = fuseAttribution([
      ev({ source: "nmap_os", dimension: "os", claim: "linux", confidence: 0.9, weight: 0.5, phase: "scan_nmap_base" }),
      ev({ source: "ad", dimension: "os", claim: "windows", confidence: 0.95, weight: 1, raw_value: "Windows Server 2022 Standard", phase: "integration" }),
    ], NOW);
    assert.equal(r.os.claim, "windows");
    assert.equal(r.os.authoritative, true);
    assert.equal(r.os.os_name, "Windows Server 2022 Standard");
  });
  it("manual vince sempre, anche su autoritative", () => {
    const r = fuseAttribution([
      ev({ source: "ad", dimension: "os", claim: "windows", confidence: 0.95, weight: 1, phase: "integration" }),
      ev({ source: "manual", dimension: "os", claim: "linux", confidence: 1, weight: 1, phase: "manual" }),
    ], NOW);
    assert.equal(r.os.claim, "linux");
    assert.equal(r.os.confidence, 100);
  });
  it("evidenza scaduta esclusa dalla fusione", () => {
    const r = fuseAttribution([
      ev({ source: "dhcp", dimension: "vendor", claim: "samsung", confidence: 0.9, weight: 0.9, expires_at: "2026-07-01T00:00:00Z" }),
    ], NOW);
    assert.equal(r.vendor.claim, null);
  });
  it("voti livello 2 discordi fanno comunque emergere il livello 1", () => {
    const r = fuseAttribution([
      ev({ source: "snmp_sysdescr", dimension: "category", claim: "network.switch", confidence: 0.45, weight: 0.85, phase: "scan_snmp_verify" }),
      ev({ source: "ports", dimension: "category", claim: "network.router", confidence: 0.9, weight: 0.3, phase: "scan_naabu" }),
    ], NOW);
    // switch=0.3825, router=0.27: entrambi sotto soglia, ma network=0.6525 sopra
    assert.equal(r.category.claim, "network");
    assert.equal(r.category.min_phase, "scan_snmp_verify");
  });
});
