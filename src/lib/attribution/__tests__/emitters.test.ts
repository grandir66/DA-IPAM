// src/lib/attribution/__tests__/emitters.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { emitEvidenceFromSignals, vendorSlug } from "../emitters";
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
  it("MAC virtuale (vendor OUI hypervisor) → categoria compute.vm + vendor comunque emesso", () => {
    const s = base();
    s.host.vendor = "VMware, Inc.";
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "oui" && e.dimension === "category");
    assert.ok(cat, "attesa evidenza categoria compute.vm");
    assert.equal(cat.claim, "compute.vm");
    assert.equal(cat.confidence, 0.85);
    assert.equal(cat.phase, "scan_icmp");
    assert.equal(cat.raw_value, "VMware, Inc.");
    const v = out.find((e) => e.source === "oui" && e.dimension === "vendor");
    assert.ok(v, "il vendor (hypervisor) deve restare emesso");
    assert.equal(v.claim, "vmware");
  });
  it("MAC virtuale: match case-insensitive su tutti gli hypervisor noti", () => {
    for (const vendor of ["Proxmox Server Solutions GmbH", "QEMU", "Xensource, Inc.", "Oracle VirtualBox", "Microsoft Hyper-V", "Parallels, Inc.", "Nutanix Inc"]) {
      const s = base();
      s.host.vendor = vendor;
      const cat = emitEvidenceFromSignals(s).find((e) => e.source === "oui" && e.dimension === "category");
      assert.equal(cat?.claim, "compute.vm", `atteso compute.vm per vendor "${vendor}"`);
    }
  });
  it("vendor placeholder del registro (IEEE Registration Authority / Private) → nessuna evidenza vendor", () => {
    for (const vendor of ["IEEE Registration Authority", "private", "  Private  ", "PRIVATE"]) {
      const s = base();
      s.host.vendor = vendor;
      const out = emitEvidenceFromSignals(s);
      assert.deepEqual(out, [], `atteso nessuna evidenza per vendor placeholder "${vendor}"`);
    }
  });
  it("vendor placeholder non sopprime altre evidenze (es. hostname)", () => {
    const s = base();
    s.host.vendor = "Private";
    s.host.hostname = "ap-piano2";
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "oui"), undefined);
    assert.equal(out.find((e) => e.source === "hostname")?.claim, "network.access_point");
  });
  it("alias slug vendor: varianti note convergono sullo stesso claim (voti OUI/SNMP non si spaccano)", () => {
    assert.equal(vendorSlug("Routerboard.com"), "mikrotik");
    assert.equal(vendorSlug("Routerboard"), "mikrotik");
    assert.equal(vendorSlug("Ubiquiti Networks Inc."), "ubiquiti");
    assert.equal(vendorSlug("Hewlett Packard"), "hpe");
    assert.equal(vendorSlug("Hewlett Packard Enterprise"), "hpe");
    // regressione: caso già coperto senza alias deve restare invariato
    assert.equal(vendorSlug("Ubiquiti Inc"), "ubiquiti");
  });
  it("alias slug applicato anche nel flusso emitter (host.vendor = OUI grezzo)", () => {
    const s = base();
    s.host.vendor = "Routerboard.com";
    const v = emitEvidenceFromSignals(s).find((e) => e.source === "oui" && e.dimension === "vendor");
    assert.equal(v?.claim, "mikrotik");
  });
  it("alias slug applicato anche su fonte Wazuh (board_vendor = Routerboard.com) → claim mikrotik", () => {
    const s = base();
    s.wazuh = { os_platform: "rhel", os_name: "RHEL", os_version: "9", board_vendor: "Routerboard.com" };
    const v = emitEvidenceFromSignals(s).find((e) => e.source === "wazuh" && e.dimension === "vendor");
    assert.ok(v, "attesa evidenza vendor da wazuh");
    assert.equal(v.claim, "mikrotik");
  });
  it('vendorSlug con trattino: "Hewlett-Packard Enterprise" → "hpe" (nessun sysObjectID builtin espone la forma non normalizzata: la LOOKUP_TABLE usa già "HPE")', () => {
    assert.equal(vendorSlug("Hewlett-Packard Enterprise"), "hpe");
  });
  it("caso reale 192.168.40.23/.26 (Synology/QNAP): slug vendor societari uniformati alla forma corta usata da SSDP/mDNS", () => {
    assert.equal(vendorSlug("Synology Incorporated"), "synology");
    assert.equal(vendorSlug("QNAP Systems, Inc."), "qnap");
    assert.equal(vendorSlug("Proxmox Server Solutions GmbH"), "proxmox");
  });
  it("nessuno slug vendor societario risulta stringa vuota", () => {
    for (const vendor of [
      "Synology Incorporated", "QNAP Systems, Inc.", "Proxmox Server Solutions GmbH",
      "Ubiquiti Inc", "Belkin International, Inc.", "VMware, Inc.", "Systems Inc",
    ]) {
      assert.notEqual(vendorSlug(vendor), "", `slug vuoto per "${vendor}"`);
    }
  });
  it("alias slug applicato anche su fonte Wazuh (board_vendor = Hewlett-Packard) → claim hpe", () => {
    const s = base();
    s.wazuh = { os_platform: "rhel", os_name: "RHEL", os_version: "9", board_vendor: "Hewlett-Packard" };
    const v = emitEvidenceFromSignals(s).find((e) => e.source === "wazuh" && e.dimension === "vendor");
    assert.ok(v, "attesa evidenza vendor da wazuh");
    assert.equal(v.claim, "hpe");
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
  it("sysObjectID: KB e builtin si combinano — vendor dalla KB, categoria la più profonda (regressione Ubiquiti)", () => {
    const s = base();
    // 1.3.6.1.4.1.41112.1.6 è "UniFi AP" nella LOOKUP_TABLE builtin (categoria
    // level-2 "network.access_point"). La KB (Task 2) ha un match ESATTO sullo
    // stesso OID (vendor "Ubiquiti", TYPE GLPI "NETWORKING", model "UniFi") ma
    // TYPE "NETWORKING" non distingue router/switch/AP → livello 1 "network"
    // soltanto. Se la KB "vincesse" sempre si perderebbe la profondità nota
    // dalla builtin: qui host ha SOLO il sysObjectID (niente sysDescr), quindi
    // nessun'altra fonte può recuperare access_point — il merge DEVE farlo.
    s.host.snmp_data = JSON.stringify({ sysObjectID: "1.3.6.1.4.1.41112.1.6", sysDescr: null, collected_at: "x" });
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "category");
    const ven = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "vendor");
    assert.equal(cat?.claim, "network.access_point", "la categoria più profonda (builtin) deve vincere sulla KB (livello 1)");
    assert.equal(cat?.raw_value, "1.3.6.1.4.1.41112.1.6 → UniFi", "il model della KB deve finire in raw_value anche con categoria builtin");
    assert.ok(ven);
    assert.equal(ven?.claim, "ubiquiti", "il vendor deve venire dalla KB (fonte più ricca)");
  });
  it("sysObjectID presente SOLO nella KB (AKCP, non in LOOKUP_TABLE builtin) → vendor/modello/categoria dalla KB", () => {
    const s = base();
    // 1.3.6.1.4.1.3854 (AKCP) è in attribution-kb.sqlite (TYPE GLPI NETWORKING)
    // ma l'enterprise 3854 non compare nella LOOKUP_TABLE builtin: legacyMatch
    // è null, quindi il merge deve restituire integralmente i dati KB.
    s.host.snmp_data = JSON.stringify({ sysObjectID: "1.3.6.1.4.1.3854", sysDescr: null, collected_at: "x" });
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "category");
    const ven = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "vendor");
    assert.equal(cat?.claim, "network");
    assert.equal(ven?.claim, "akcp");
  });
  it("caso reale 192.168.40.23 (Synology): sysObjectID net-snmp generico 1.3.6.1.4.1.8072.3.2.10 → nessuna evidenza vendor/categoria", () => {
    const s = base();
    s.host.snmp_data = JSON.stringify({ sysObjectID: "1.3.6.1.4.1.8072.3.2.10", sysDescr: null, collected_at: "x" });
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "snmp_sysobj" && e.dimension === "vendor"), undefined);
    assert.equal(out.find((e) => e.source === "snmp_sysobj" && e.dimension === "category"), undefined);
  });
  it("sysObjectID net-snmp generico 1.3.6.1.4.1.8072.3.2.255 (unknown/custom appliance) → nessuna evidenza vendor/categoria", () => {
    const s = base();
    s.host.snmp_data = JSON.stringify({ sysObjectID: "1.3.6.1.4.1.8072.3.2.255", sysDescr: null, collected_at: "x" });
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "snmp_sysobj"), undefined);
  });
  it("vendorSlug: nomi generici da placeholder (linux/unknown/generic/net-snmp/n-a/other) → stringa filtrata come IEEE/private", () => {
    for (const vendor of ["Linux", "unknown", "Generic", "net-snmp", "netsnmp", "n/a", "OTHER"]) {
      const s = base();
      s.host.vendor = vendor;
      const out = emitEvidenceFromSignals(s);
      assert.equal(out.find((e) => e.source === "oui"), undefined, `atteso nessuna evidenza OUI per vendor placeholder "${vendor}"`);
    }
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
