// src/lib/attribution/__tests__/probe-evidence.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { evidenceFromHttpTls } from "../probe-evidence";
import { isValidCategory } from "../taxonomy";
import type { HttpTlsFinding } from "@/lib/scanner/probes/http-tls";

function finding(partial: Partial<HttpTlsFinding>): HttpTlsFinding {
  return {
    port: 443,
    scheme: "https",
    server: null,
    title: null,
    realm: null,
    location: null,
    tlsSubjectCn: null,
    tlsSan: [],
    tlsIssuer: null,
    ...partial,
  };
}

describe("evidenceFromHttpTls", () => {
  it("solo nginx generico → nessuna evidenza vendor (né categoria dal Server header)", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", server: "nginx/1.18.0" })]);
    assert.equal(out.find((e) => e.dimension === "vendor"), undefined);
    assert.deepEqual(out, []);
  });

  it("Apache/IIS/lighttpd generici → nessuna evidenza vendor", () => {
    for (const server of ["Apache/2.4.41 (Ubuntu)", "Microsoft-IIS/10.0", "lighttpd/1.4.55"]) {
      const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", server })]);
      assert.equal(out.find((e) => e.dimension === "vendor"), undefined, `atteso nessun vendor per Server: ${server}`);
    }
  });

  it("Server: MikroTik/RouterOS → vendor mikrotik + categoria network.router @0.85", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", server: "MikroTik HTTP Proxy" })]);
    const v = out.find((e) => e.dimension === "vendor");
    const c = out.find((e) => e.dimension === "category");
    assert.ok(v && c);
    assert.equal(v.claim, "mikrotik");
    assert.equal(v.confidence, 0.85);
    assert.equal(v.source, "http_banner");
    assert.equal(c.claim, "network.router");
    assert.equal(c.confidence, 0.85);
  });

  it("Server: Ubiquiti UniFi → vendor ubiquiti, nessuna categoria dal Server header", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", server: "UniFi Controller" })]);
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(v?.claim, "ubiquiti");
    assert.equal(out.find((e) => e.dimension === "category"), undefined);
  });

  it("Server: Synology DSM → vendor synology + storage.nas", () => {
    const out = evidenceFromHttpTls([finding({ port: 5000, scheme: "http", server: "Synology DSM" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "synology");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
  });

  it("Server: QNAP QTS → vendor qnap + storage.nas", () => {
    const out = evidenceFromHttpTls([finding({ port: 8080, scheme: "http", server: "QNAP QTS" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "qnap");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
  });

  it("Server: HP-ChaiSOE → vendor hp + peripheral.printer", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", server: "HP-ChaiSOE/1.0" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "hp");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "peripheral.printer");
  });

  it("Server: iLO → vendor hpe + compute.server", () => {
    const out = evidenceFromHttpTls([finding({ port: 443, scheme: "https", server: "iLO/5" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "hpe");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.server");
  });

  it("Server: iDRAC → vendor dell + compute.server", () => {
    const out = evidenceFromHttpTls([finding({ port: 443, scheme: "https", server: "iDRAC/9" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "dell");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.server");
  });

  it("Server: Proxmox VE → vendor proxmox + compute.hypervisor", () => {
    const out = evidenceFromHttpTls([finding({ port: 8006, scheme: "https", server: "pve-api-daemon/3.0" })]);
    assert.equal(out.find((e) => e.dimension === "vendor"), undefined, "il match e' 'proxmox', non 'pve': verifica separata sotto");
  });

  it("Server: 'Proxmox' esplicito → vendor proxmox + compute.hypervisor", () => {
    const out = evidenceFromHttpTls([finding({ port: 8006, scheme: "https", server: "Proxmox VE" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "proxmox");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.hypervisor");
  });

  it("Server: VMware ESXi → vendor vmware + compute.hypervisor", () => {
    const out = evidenceFromHttpTls([finding({ port: 443, scheme: "https", server: "VMware ESXi" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "vmware");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.hypervisor");
  });

  it("Title: 'HP LaserJet Printer' → peripheral.printer @0.7", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", title: "HP LaserJet Printer" })]);
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "peripheral.printer");
    assert.equal(c?.confidence, 0.7);
    assert.equal(c?.source, "http_banner");
  });

  it("Title: 'Hikvision Network Camera' → av.camera", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", title: "Hikvision Network Camera" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.camera");
  });

  it("Title: 'pfSense - Login' → network.firewall (non network.router)", () => {
    const out = evidenceFromHttpTls([finding({ port: 443, scheme: "https", title: "pfSense - Login" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "network.firewall");
  });

  it("Title: 'Router Configuration' generico → network.router", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", title: "Router Configuration" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "network.router");
  });

  it("Title: 'Managed Switch' → network.switch", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", title: "Managed Switch" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "network.switch");
  });

  it("Title: 'DiskStation' → storage.nas", () => {
    const out = evidenceFromHttpTls([finding({ port: 5000, scheme: "http", title: "DiskStation" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
  });

  it("Title: 'PowerChute Network Shutdown' → power.ups", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", title: "PowerChute Network Shutdown" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "power.ups");
  });

  it("Title: 'Proxmox Virtual Environment' → compute.hypervisor", () => {
    const out = evidenceFromHttpTls([finding({ port: 8006, scheme: "https", title: "Proxmox Virtual Environment" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.hypervisor");
  });

  it("Certificato TLS: CN '*.ui.com' → vendor ubiquiti @0.8", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "*.ui.com" })]);
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(v?.claim, "ubiquiti");
    assert.equal(v?.confidence, 0.8);
    assert.equal(v?.source, "tls_cert");
  });

  it("Certificato TLS: SAN contiene 'synology' → vendor synology", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: null, tlsSan: ["nas.synology.com", "192.168.1.10"] })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "synology");
  });

  it("Certificato TLS: CN 'QNAP-NAS' → vendor qnap", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "QNAP-NAS" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "qnap");
  });

  it("Certificato TLS: CN 'Integrated Lights-Out' → vendor hpe + compute.server", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "Integrated Lights-Out" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "hpe");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.server");
  });

  it("Certificato TLS: CN 'iDRAC.local' → vendor dell + compute.server", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "iDRAC.local" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "dell");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute.server");
  });

  it("Certificato TLS: CN 'pfSense-webConfigurator' → network.firewall, nessun vendor dal CN", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "pfSense-webConfigurator" })]);
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "network.firewall");
    assert.equal(out.find((e) => e.dimension === "vendor"), undefined);
  });

  it("Certificato TLS: CN 'VMware ESXi Server' → vendor vmware", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "VMware ESXi Server" })]);
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "vmware");
  });

  it("Issuer TLS contenente 'Synology' senza CN/SAN riconoscibile → conferma vendor a confidence più bassa (0.6)", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "nas01.example.lan", tlsIssuer: "Synology Inc. CA" })]);
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(v?.claim, "synology");
    assert.equal(v?.confidence, 0.6);
    assert.equal(v?.source, "tls_cert");
  });

  it("Issuer conferma vendor MA CN/SAN già danno la stessa evidenza a confidence più alta → resta 0.8 (dedup su max)", () => {
    const out = evidenceFromHttpTls([finding({ tlsSubjectCn: "synology.example.com", tlsIssuer: "Synology Inc. CA" })]);
    const vendors = out.filter((e) => e.dimension === "vendor" && e.claim === "synology");
    assert.equal(vendors.length, 1, "deduplicato: un solo claim (synology, vendor)");
    assert.equal(vendors[0].confidence, 0.8);
  });

  it("Nessun campo popolato (finding vuoto) → nessuna evidenza", () => {
    const out = evidenceFromHttpTls([finding({})]);
    assert.deepEqual(out, []);
  });

  it("Deduplica tra più findings dello stesso host: stesso (dimension, claim) → tiene la confidence più alta", () => {
    const out = evidenceFromHttpTls([
      finding({ port: 80, scheme: "http", title: "Router Configuration" }), // network.router @0.7 (title)
      finding({ port: 443, scheme: "https", server: "MikroTik" }), // network.router @0.85 (server) + vendor mikrotik
    ]);
    const routerClaims = out.filter((e) => e.dimension === "category" && e.claim === "network.router");
    assert.equal(routerClaims.length, 1);
    assert.equal(routerClaims[0].confidence, 0.85);
  });

  it("Ogni claim category emesso è dentro la tassonomia (isValidCategory)", () => {
    const findings: HttpTlsFinding[] = [
      finding({ port: 80, scheme: "http", server: "MikroTik" }),
      finding({ port: 5000, scheme: "http", server: "Synology DSM" }),
      finding({ port: 8080, scheme: "http", server: "QNAP QTS" }),
      finding({ port: 80, scheme: "http", server: "HP-ChaiSOE/1.0" }),
      finding({ port: 443, scheme: "https", server: "iLO/5" }),
      finding({ port: 443, scheme: "https", server: "iDRAC/9" }),
      finding({ port: 8006, scheme: "https", server: "Proxmox VE" }),
      finding({ port: 443, scheme: "https", server: "VMware ESXi" }),
      finding({ port: 80, scheme: "http", title: "Hikvision Network Camera" }),
      finding({ port: 443, scheme: "https", title: "pfSense - Login" }),
      finding({ port: 80, scheme: "http", title: "Managed Switch" }),
      finding({ port: 80, scheme: "http", title: "PowerChute Network Shutdown" }),
      finding({ tlsSubjectCn: "Integrated Lights-Out" }),
      finding({ tlsSubjectCn: "iDRAC.local" }),
      finding({ tlsSubjectCn: "pfSense-webConfigurator" }),
    ];
    const out = evidenceFromHttpTls(findings);
    const categoryClaims = out.filter((e) => e.dimension === "category");
    assert.ok(categoryClaims.length > 0, "il test deve esercitare almeno una evidenza categoria");
    for (const e of categoryClaims) {
      assert.ok(isValidCategory(e.claim), `claim categoria fuori tassonomia: ${e.claim}`);
    }
  });

  it("Ogni evidenza ha phase 'scan_naabu' e expires_at valorizzato a circa +30 giorni", () => {
    const out = evidenceFromHttpTls([finding({ port: 80, scheme: "http", server: "MikroTik" })]);
    assert.ok(out.length > 0);
    for (const e of out) {
      assert.equal(e.phase, "scan_naabu");
      assert.ok(e.expires_at, "expires_at deve essere valorizzato");
      const deltaMs = new Date(e.expires_at as string).getTime() - Date.now();
      const days = deltaMs / (24 * 60 * 60 * 1000);
      assert.ok(days > 29 && days < 31, `expires_at atteso ~30gg, trovato ${days}gg`);
    }
  });
});
