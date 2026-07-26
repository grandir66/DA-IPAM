// src/lib/attribution/__tests__/emitters.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { emitEvidenceFromSignals } from "../emitters";
import type { AttributionSignals } from "../emitters";

function base(): AttributionSignals {
  return {
    host: { id: 1, ip: "10.0.0.1", mac: null, vendor: null, hostname: null, os_info: null, open_ports: null, snmp_data: null, detection_json: null },
    adComputer: null, wazuh: null, neighborSightings: [],
  };
}

describe("emitEvidenceFromSignals", () => {
  it("vendor da OUI (hosts.vendor già risolto)", () => {
    const s = base();
    s.host.vendor = "Ubiquiti Inc";
    const out = emitEvidenceFromSignals(s);
    const v = out.find((e) => e.source === "oui" && e.dimension === "vendor");
    assert.ok(v);
    assert.equal(v.claim, "ubiquiti");
    assert.equal(v.raw_value, "Ubiquiti Inc");
    assert.equal(v.phase, "scan_icmp");
  });
  it("sysDescr Ubiquiti: U6-Pro → access_point, USW → switch, UDM → router", () => {
    const mk = (sysDescr: string) => {
      const s = base();
      s.host.snmp_data = JSON.stringify({ sysDescr, sysObjectID: "1.3.6.1.4.1.41112", collected_at: "x" });
      return emitEvidenceFromSignals(s).filter((e) => e.source === "snmp_sysdescr" && e.dimension === "category");
    };
    assert.equal(mk("U6-Pro 6.5.28")[0]?.claim, "network.access_point");
    assert.equal(mk("USW-24-PoE 7.0.1")[0]?.claim, "network.switch");
    assert.equal(mk("UDM-Pro 3.1")[0]?.claim, "network.router");
  });
  it("sysObjectID via lookup KB → vendor + categoria (fallback tabella builtin)", () => {
    const s = base();
    // 1.3.6.1.4.1.41112.1.6 è UniFi AP nella LOOKUP_TABLE builtin
    s.host.snmp_data = JSON.stringify({ sysObjectID: "1.3.6.1.4.1.41112.1.6", sysDescr: null, collected_at: "x" });
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "category");
    const ven = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "vendor");
    assert.equal(cat?.claim, "network.access_point");
    assert.ok(ven);
  });
  it("os_info nmap → os family", () => {
    const s = base();
    s.host.os_info = "Microsoft Windows Server 2019";
    const out = emitEvidenceFromSignals(s);
    const os = out.find((e) => e.source === "nmap_os" && e.dimension === "os");
    assert.equal(os?.claim, "windows");
  });
  it("AD autoritativo: os + categoria server/workstation", () => {
    const s = base();
    s.adComputer = { operating_system: "Windows Server 2022 Standard", operating_system_version: "10.0 (20348)" };
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "ad" && e.dimension === "os")?.claim, "windows");
    assert.equal(out.find((e) => e.source === "ad" && e.dimension === "category")?.claim, "compute.server");
    const s2 = base();
    s2.adComputer = { operating_system: "Windows 11 Pro", operating_system_version: null };
    assert.equal(emitEvidenceFromSignals(s2).find((e) => e.source === "ad" && e.dimension === "category")?.claim, "compute.workstation");
  });
  it("AD autoritativo con Linux domain-joined: os family reale, non windows hardcoded", () => {
    const s = base();
    s.adComputer = { operating_system: "Ubuntu 22.04 LTS", operating_system_version: null };
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "ad" && e.dimension === "os")?.claim, "linux");
    assert.equal(out.find((e) => e.source === "ad" && e.dimension === "category")?.claim, "compute.workstation");
  });
  it("Wazuh: os_platform → famiglia + compute livello 1", () => {
    const s = base();
    s.wazuh = { os_platform: "ubuntu", os_name: "Ubuntu", os_version: "22.04", board_vendor: "Dell Inc." };
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "wazuh" && e.dimension === "os")?.claim, "linux");
    assert.equal(out.find((e) => e.source === "wazuh" && e.dimension === "category")?.claim, "compute");
  });
  it("neighbor LLDP con platform → categoria non autoritativa", () => {
    const s = base();
    s.neighborSightings = [{ protocol: "lldp", remote_platform: "MikroTik RouterOS 7.14 CRS326", remote_device_name: "sw-core" }];
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "lldp" && e.dimension === "category");
    assert.ok(cat, "attesa evidenza categoria da LLDP");
    assert.ok(cat.confidence <= 0.7);
  });
  it("hostname pattern → categoria debole", () => {
    const s = base();
    s.host.hostname = "ap-piano2";
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "hostname" && e.dimension === "category")?.claim, "network.access_point");
  });
  it("nessun segnale → nessuna evidenza (mai claim vuoti)", () => {
    assert.deepEqual(emitEvidenceFromSignals(base()), []);
    for (const e of emitEvidenceFromSignals(base())) assert.ok(e.claim.length > 0);
  });
});
