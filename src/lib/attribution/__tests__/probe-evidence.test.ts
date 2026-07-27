// src/lib/attribution/__tests__/probe-evidence.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { evidenceFromHttpTls, evidenceFromSmb2, evidenceFromMdns, evidenceFromSsdp, evidenceFromWsd } from "../probe-evidence";
import { isValidCategory } from "../taxonomy";
import type { HttpTlsFinding } from "@/lib/scanner/probes/http-tls";
import type { Smb2Finding } from "@/lib/scanner/probes/smb2";
import { parseNtlmChallenge, parseNegotiateSigningRequired, extractSessionSetupSecurityBuffer } from "@/lib/scanner/probes/smb2";
import type { MdnsFinding } from "@/lib/scanner/probes/mdns";
import { parseTxtRecords } from "@/lib/scanner/probes/mdns";
import type { SsdpFinding } from "@/lib/scanner/probes/ssdp";
import { parseSsdpHeaders } from "@/lib/scanner/probes/ssdp";
import type { WsdFinding } from "@/lib/scanner/probes/wsd";
import { collectByLocalName } from "@/lib/scanner/probes/wsd";

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

function smb2Finding(partial: Partial<Smb2Finding>): Smb2Finding {
  return {
    osVersion: "10.0.20348",
    netbiosName: "WIN-SRV01",
    dnsDomain: "corp.local",
    signingRequired: false,
    ...partial,
  };
}

describe("evidenceFromSmb2", () => {
  it("finding completo → os windows @0.9 (raw_value = build) + categoria compute @0.5", () => {
    const out = evidenceFromSmb2(smb2Finding({}));
    const os = out.find((e) => e.dimension === "os");
    const cat = out.find((e) => e.dimension === "category");
    assert.ok(os && cat);
    assert.equal(os.claim, "windows");
    assert.equal(os.confidence, 0.9);
    assert.equal(os.raw_value, "10.0.20348");
    assert.equal(os.source, "smb");
    assert.equal(cat.claim, "compute");
    assert.equal(cat.confidence, 0.5);
    assert.equal(cat.source, "smb");
  });

  it("osVersion assente (Version non letta dalla CHALLENGE) → nessun claim OS, categoria compute presente", () => {
    const out = evidenceFromSmb2(smb2Finding({ osVersion: null }));
    const os = out.find((e) => e.dimension === "os");
    const cat = out.find((e) => e.dimension === "category");
    assert.equal(os, undefined);
    assert.equal(cat?.claim, "compute");
  });

  it("netbiosName/dnsDomain non producono evidenze dirette (nessuna dimensione hostname nel motore)", () => {
    const out = evidenceFromSmb2(smb2Finding({ netbiosName: "FOO", dnsDomain: "bar.local" }));
    assert.equal(out.length, 2, "solo os + category, mai altre righe");
  });

  it("Ogni claim category è dentro la tassonomia", () => {
    const out = evidenceFromSmb2(smb2Finding({}));
    for (const e of out.filter((x) => x.dimension === "category")) {
      assert.ok(isValidCategory(e.claim));
    }
  });

  it("phase 'scan_naabu' e expires_at ~30 giorni", () => {
    const out = evidenceFromSmb2(smb2Finding({}));
    assert.ok(out.length > 0);
    for (const e of out) {
      assert.equal(e.phase, "scan_naabu");
      const days = (new Date(e.expires_at as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(days > 29 && days < 31);
    }
  });

  describe("payload reali (VM 533, rete 192.168.40.0/24) — fix falso positivo Samba/NAS", () => {
    it("QNAP NAS 192.168.40.26 (build=0, confermato Linux+Samba da mDNS/TLS): nessuna evidenza os, resta compute", () => {
      const out = evidenceFromSmb2(smb2Finding({
        osVersion: "6.1.0", netbiosName: "DA-765", dnsDomain: "", signingRequired: false,
      }));
      const os = out.find((e) => e.dimension === "os");
      const cat = out.find((e) => e.dimension === "category");
      assert.equal(os, undefined, "build 0 non e' un Windows plausibile: niente claim os");
      assert.ok(cat);
      assert.equal(cat?.claim, "compute");
    });

    it("Windows Server 2022/2025 reale (build 20348, 4-5 cifre) → os windows @0.9, raw_value con la build", () => {
      const out = evidenceFromSmb2(smb2Finding({
        osVersion: "10.0.20348", netbiosName: "DC01", dnsDomain: "contoso.local", signingRequired: true,
      }));
      const os = out.find((e) => e.dimension === "os");
      assert.ok(os);
      assert.equal(os?.claim, "windows");
      assert.equal(os?.confidence, 0.9);
      assert.ok(os?.raw_value?.toString().includes("10.0.20348"));
    });

    it("Windows 7 / 2008 R2 reale (build 7601) → os windows", () => {
      const out = evidenceFromSmb2(smb2Finding({ osVersion: "6.1.7601" }));
      const os = out.find((e) => e.dimension === "os");
      assert.equal(os?.claim, "windows");
    });

    it("osVersion null (Version non letta dalla CHALLENGE) → nessun claim os, categoria compute presente", () => {
      const out = evidenceFromSmb2(smb2Finding({ osVersion: null }));
      const os = out.find((e) => e.dimension === "os");
      const cat = out.find((e) => e.dimension === "category");
      assert.equal(os, undefined);
      assert.equal(cat?.claim, "compute");
    });
  });
});

function mdnsFinding(partial: Partial<MdnsFinding>): MdnsFinding {
  return {
    services: [],
    model: null,
    usbMfg: null,
    usbMdl: null,
    hapCategory: null,
    ...partial,
  };
}

describe("evidenceFromMdns", () => {
  it("_ipp._tcp presente + usb_MFG/usb_MDL → peripheral.printer @0.9 + vendor @0.9", () => {
    const out = evidenceFromMdns(mdnsFinding({
      services: ["_ipp._tcp.local"], usbMfg: "Canon", usbMdl: "TS3350",
    }));
    const cat = out.find((e) => e.dimension === "category");
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(cat?.claim, "peripheral.printer");
    assert.equal(cat?.confidence, 0.9);
    assert.equal(cat?.source, "mdns");
    assert.equal(v?.claim, "canon");
    assert.equal(v?.confidence, 0.9);
    assert.equal(v?.raw_value, "Canon TS3350");
  });

  it("_pdl-datastream._tcp presente senza usb_MFG → solo categoria stampante, nessun vendor", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_pdl-datastream._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "peripheral.printer");
    assert.equal(out.find((e) => e.dimension === "vendor"), undefined);
  });

  it("_hap._tcp con ci=17 (IP Camera) → av.camera @0.75", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_hap._tcp.local"], hapCategory: 17 }));
    const cat = out.find((e) => e.dimension === "category");
    assert.equal(cat?.claim, "av.camera");
    assert.equal(cat?.confidence, 0.75);
    assert.equal(cat?.raw_value, "17");
  });

  it("_hap._tcp con ci=2 (bridge, non mappato) → nessuna evidenza categoria", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_hap._tcp.local"], hapCategory: 2 }));
    assert.equal(out.find((e) => e.dimension === "category"), undefined);
  });

  it("_airplay._tcp → av.display @0.7", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_airplay._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.display");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.7);
  });

  it("_googlecast._tcp → av.display @0.7", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_googlecast._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.display");
  });

  it("model= di _device-info → vendor apple a bassa confidence (0.35, spoofabile da NAS/Netatalk)", () => {
    const out = evidenceFromMdns(mdnsFinding({ model: "Xserve1,1" }));
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(v?.claim, "apple");
    assert.equal(v?.confidence, 0.35);
    assert.equal(v?.raw_value, "Xserve1,1");
  });

  it("finding vuoto → nessuna evidenza", () => {
    assert.deepEqual(evidenceFromMdns(mdnsFinding({})), []);
  });

  it("hap camera + airplay insieme → due categorie distinte, nessuna deduplicata via confidence", () => {
    const out = evidenceFromMdns(mdnsFinding({
      services: ["_hap._tcp.local", "_airplay._tcp.local"], hapCategory: 17,
    }));
    const cats = out.filter((e) => e.dimension === "category").map((e) => e.claim).sort();
    assert.deepEqual(cats, ["av.camera", "av.display"]);
  });

  it("Ogni claim category è dentro la tassonomia", () => {
    const findings: MdnsFinding[] = [
      mdnsFinding({ services: ["_ipp._tcp.local"], usbMfg: "HP", usbMdl: "LaserJet" }),
      mdnsFinding({ services: ["_hap._tcp.local"], hapCategory: 9 }),
      mdnsFinding({ services: ["_hap._tcp.local"], hapCategory: 33 }),
      mdnsFinding({ services: ["_hap._tcp.local"], hapCategory: 34 }),
      mdnsFinding({ services: ["_airplay._tcp.local"] }),
    ];
    for (const f of findings) {
      for (const e of evidenceFromMdns(f).filter((x) => x.dimension === "category")) {
        assert.ok(isValidCategory(e.claim), `claim fuori tassonomia: ${e.claim}`);
      }
    }
  });

  it("phase 'scan_naabu' e expires_at ~30 giorni", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_ipp._tcp.local"], usbMfg: "HP" }));
    assert.ok(out.length > 0);
    for (const e of out) {
      assert.equal(e.phase, "scan_naabu");
      const days = (new Date(e.expires_at as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(days > 29 && days < 31);
    }
  });

  // --- Regole aggiunte da evidenza rete reale (VM 533, 192.168.40.0/24) ---

  it("_printer._tcp (oltre a _ipp/_pdl-datastream) → peripheral.printer @0.9", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_printer._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "peripheral.printer");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.9);
  });

  it("_qdiscover (QNAP) → vendor qnap @0.85 + storage.nas @0.8", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_qdiscover._tcp.local"] }));
    const v = out.find((e) => e.dimension === "vendor");
    const c = out.find((e) => e.dimension === "category");
    assert.equal(v?.claim, "qnap");
    assert.equal(v?.confidence, 0.85);
    assert.equal(c?.claim, "storage.nas");
    assert.equal(c?.confidence, 0.8);
  });

  it("_sonos → vendor sonos @0.85", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_sonos._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "sonos");
  });

  it("_axis → vendor axis + av.camera @0.85", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_axis-video._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "axis");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.camera");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.85);
  });

  it("_smb da solo (senza _device-info/_http) → compute @0.5, MAI storage.nas (lo espone anche Windows)", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_smb._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.5);
    assert.equal(out.filter((e) => e.claim === "storage.nas").length, 0);
  });

  it("_smb + _http insieme → storage.nas @0.6 (NAS che espone share e si amministra via HTTP)", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_smb._tcp.local", "_http._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.6);
  });

  it("_adisk + _device-info insieme → storage.nas @0.6", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_adisk._tcp.local", "_device-info._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
  });

  it("_workstation da solo → compute @0.5", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_workstation._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.5);
  });

  it("_raop._tcp (AirPlay audio) → av.display @0.7", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_raop._tcp.local"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.display");
  });

  it("_hap._tcp SENZA ci= → iot.other @0.6 (accessorio HomeKit generico)", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_hap._tcp.local"], hapCategory: null }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "iot.other");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.6);
  });

  it("_hp._tcp + usb_MFG (senza _ipp/_pdl/_printer) → vendor da usbMfg, nessuna categoria stampante", () => {
    const out = evidenceFromMdns(mdnsFinding({ services: ["_hp._tcp.local"], usbMfg: "HP" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "hp");
    assert.equal(out.find((e) => e.dimension === "category"), undefined);
  });

  it("_sftp-ssh/_ssh (troppo generici) → nessuna evidenza", () => {
    assert.deepEqual(evidenceFromMdns(mdnsFinding({ services: ["_sftp-ssh._tcp.local"] })), []);
    assert.deepEqual(evidenceFromMdns(mdnsFinding({ services: ["_ssh._tcp.local"] })), []);
  });

  describe("payload reali (VM 533, rete 192.168.40.0/24)", () => {
    it("QNAP 192.168.40.26: _workstation+_http+_smb+_qdiscover → vendor qnap, storage.nas @0.8 (vince su compute)", () => {
      const out = evidenceFromMdns(mdnsFinding({
        services: ["_workstation._tcp.local", "_http._tcp.local", "_smb._tcp.local", "_qdiscover._tcp.local"],
        model: null, usbMfg: null, usbMdl: null, hapCategory: null,
      }));
      const vendors = out.filter((e) => e.dimension === "vendor");
      const categories = out.filter((e) => e.dimension === "category").map((e) => e.claim).sort();
      assert.equal(vendors.length, 1);
      assert.equal(vendors[0].claim, "qnap");
      assert.equal(vendors[0].confidence, 0.85);
      // "compute" (da _workstation/_smb) e "storage.nas" (da _qdiscover, piu' forte) coesistono:
      // la fusione pesata a valle decide, qui emettiamo tutti i claim osservati.
      assert.deepEqual(categories, ["compute", "storage.nas"]);
      assert.equal(out.find((e) => e.claim === "storage.nas")?.confidence, 0.8);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper di parsing esportati (parte più fragile: buffer costruiti a mano)
// ---------------------------------------------------------------------------

function buildNtlmChallengeBuffer(opts: {
  includeVersion?: boolean;
  major?: number;
  minor?: number;
  build?: number;
  nbComputerName?: string | null;
  dnsDomainName?: string | null;
  noTargetInfo?: boolean;
  prefixJunk?: Buffer;
}): Buffer {
  const {
    includeVersion = true, major = 10, minor = 0, build = 20348,
    nbComputerName = "WIN-SRV01", dnsDomainName = "corp.local",
    noTargetInfo = false, prefixJunk,
  } = opts;

  const avPairs: Buffer[] = [];
  const pushAv = (id: number, value: string) => {
    const valBuf = Buffer.from(value, "utf16le");
    const p = Buffer.alloc(4 + valBuf.length);
    p.writeUInt16LE(id, 0);
    p.writeUInt16LE(valBuf.length, 2);
    valBuf.copy(p, 4);
    avPairs.push(p);
  };
  if (!noTargetInfo) {
    if (nbComputerName) pushAv(0x0001, nbComputerName);
    if (dnsDomainName) pushAv(0x0004, dnsDomainName);
    avPairs.push(Buffer.from([0, 0, 0, 0])); // MsvAvEOL
  }
  const targetInfo = Buffer.concat(avPairs);
  const targetInfoOffset = 56;
  const targetInfoLen = noTargetInfo ? 0 : targetInfo.length;

  const header = Buffer.alloc(56);
  header.write("NTLMSSP\0", 0, "latin1");
  header.writeUInt32LE(2, 8); // MessageType = CHALLENGE
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(0, 16); // TargetNameFields (vuoto)
  header.writeUInt32LE(includeVersion ? 0x02008205 : 0x00008205, 20); // NegotiateFlags
  header.writeUInt16LE(targetInfoLen, 40);
  header.writeUInt16LE(targetInfoLen, 42);
  header.writeUInt32LE(targetInfoOffset, 44);
  if (includeVersion) {
    header.writeUInt8(major, 48);
    header.writeUInt8(minor, 49);
    header.writeUInt16LE(build, 50);
    header.writeUInt8(15, 55); // NTLMRevisionCurrent
  }
  const msg = Buffer.concat([header, targetInfo]);
  return prefixJunk ? Buffer.concat([prefixJunk, msg]) : msg;
}

describe("parseNtlmChallenge", () => {
  it("CHALLENGE completa → version + AV_PAIRS nb/dns", () => {
    const r = parseNtlmChallenge(buildNtlmChallengeBuffer({}));
    assert.ok(r);
    assert.equal(r?.version, "10.0.20348");
    assert.equal(r?.nbComputerName, "WIN-SRV01");
    assert.equal(r?.dnsDomainName, "corp.local");
  });

  it("preceduta da byte di busta SPNEGO (indexOf trova comunque la signature)", () => {
    const r = parseNtlmChallenge(buildNtlmChallengeBuffer({ prefixJunk: Buffer.from([0xa1, 0x82, 0x00, 0x50]) }));
    assert.equal(r?.nbComputerName, "WIN-SRV01");
  });

  it("senza flag NEGOTIATE_VERSION → version null, AV_PAIRS comunque letti", () => {
    const r = parseNtlmChallenge(buildNtlmChallengeBuffer({ includeVersion: false }));
    assert.equal(r?.version, null);
    assert.equal(r?.nbComputerName, "WIN-SRV01");
  });

  it("senza TargetInfo (Len=0) → nb/dns null", () => {
    const r = parseNtlmChallenge(buildNtlmChallengeBuffer({ noTargetInfo: true }));
    assert.equal(r?.nbComputerName, null);
    assert.equal(r?.dnsDomainName, null);
  });

  it("buffer senza signature NTLMSSP → null", () => {
    assert.equal(parseNtlmChallenge(Buffer.from("not an ntlm message at all")), null);
  });

  it("buffer troppo corto → null, mai eccezione", () => {
    assert.equal(parseNtlmChallenge(Buffer.alloc(3)), null);
  });

  it("MessageType diverso da 2 (non è una CHALLENGE) → null", () => {
    const buf = buildNtlmChallengeBuffer({});
    buf.writeUInt32LE(1, 8); // forza MessageType = NEGOTIATE
    assert.equal(parseNtlmChallenge(buf), null);
  });

  it("TargetInfoOffset fuori dai limiti del buffer → nb/dns null, nessuna eccezione", () => {
    const buf = buildNtlmChallengeBuffer({});
    buf.writeUInt32LE(999999, 44); // offset assurdo
    const r = parseNtlmChallenge(buf);
    assert.ok(r); // il resto del parsing resta valido
    assert.equal(r?.nbComputerName, null);
    assert.equal(r?.dnsDomainName, null);
  });

  it("buffer troncato a metà TargetInfo → nb/dns null (AV_PAIR troncata), nessuna eccezione", () => {
    const buf = buildNtlmChallengeBuffer({});
    const truncated = buf.subarray(0, 60); // taglia dentro le AV_PAIRS
    const r = parseNtlmChallenge(truncated);
    assert.ok(r);
    assert.equal(r?.nbComputerName, null);
  });

  it("payload reale (QNAP 192.168.40.26, VM 533, root-cause investigation SMB2): SESSION_SETUP response completa (239 byte, Status=STATUS_MORE_PROCESSING_REQUIRED) → version 6.1.0, nbComputerName DA-765", () => {
    // Catturato con NEGOTIATE senza dialetto 0x0311 (vedi fix in smb2.ts): con
    // 0x0311 offerto senza NegotiateContextList il device rifiuta l'intera
    // richiesta con STATUS_INVALID_PARAMETER e non si arriva mai qui.
    const raw = Buffer.from(
      "fe534d4240000000160000c0010001000100000000000000010000000000000000000000000000003b612e12000000000000000000000000000000000000000009000000" +
      "4800a700a181a43081a1a0030a0101a10c060a2b06010401823702020aa2818b0481884e544c4d53535000020000000c000c003800000005828a02662f82d8f58a8fed" +
      "00000000000000004400440044000000060100000000000f440041002d0037003600350002000c00440041002d0037003600350001000c00440041002d00370036003500" +
      "0400000003000c00640061002d0037003600350007000800b4308fc4bb1ddd0100000000",
      "hex"
    );
    assert.equal(raw.length, 239);
    assert.equal(raw.readUInt32LE(8), 0xc0000016, "Status atteso: STATUS_MORE_PROCESSING_REQUIRED");
    const r = parseNtlmChallenge(raw);
    assert.ok(r);
    assert.equal(r?.version, "6.1.0");
    assert.equal(r?.nbComputerName, "DA-765");
    assert.equal(r?.dnsDomainName, ""); // AV_PAIR MsvAvDnsDomainName presente ma vuoto (len=0)
  });
});

describe("parseNegotiateSigningRequired / extractSessionSetupSecurityBuffer — root cause reale (rete 192.168.40.0/24)", () => {
  it("NEGOTIATE response con Status=STATUS_INVALID_PARAMETER (0xC000000D, catturato su 192.168.40.23 offrendo il dialetto 0x0311 senza NegotiateContextList) → null, MAI il body letto come se fosse un successo", () => {
    const raw = Buffer.from(
      "fe534d42400000000d0000c0000001000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000900000000000000" + "00",
      "hex"
    );
    assert.equal(raw.length, 73);
    assert.equal(raw.readUInt32LE(8), 0xc000000d);
    assert.equal(parseNegotiateSigningRequired(raw), null);
  });

  it("NEGOTIATE response con Status=STATUS_SUCCESS (catturato su 192.168.40.26, dialetto 0x0311 escluso) → SecurityMode letto correttamente", () => {
    const raw = Buffer.from(
      "fe534d42400000000000000000000100010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041000100" +
      "0203000064612d3736350000000000000000000007000000000080000000800000001000d83f8ec4bb1ddd01000000000000000080004a0000000000604806062b0601" +
      "050502a03e303ca00e300c060a2b06010401823702020aa32a3028a0261b246e6f745f646566696e65645f696e5f5246433431373840706c656173655f69676e6f7265",
      "hex"
    );
    assert.equal(raw.readUInt32LE(8), 0x00000000);
    assert.notEqual(parseNegotiateSigningRequired(raw), null);
  });

  it("SESSION_SETUP response con Status=STATUS_LOGON_FAILURE (0xC000006D, catturato su 192.168.40.23/.27: accesso anonimo SMB disabilitato) → null, MAI un security buffer spazzatura", () => {
    const raw = Buffer.from(
      "fe534d42400000006d0000c001000100010000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000090000000000000000",
      "hex"
    );
    assert.equal(raw.length, 73);
    assert.equal(raw.readUInt32LE(8), 0xc000006d);
    assert.equal(extractSessionSetupSecurityBuffer(raw), null);
  });

  it("SESSION_SETUP response con Status=STATUS_MORE_PROCESSING_REQUIRED (catturato su 192.168.40.26) → security buffer estratto, contiene la CHALLENGE NTLMSSP", () => {
    const raw = Buffer.from(
      "fe534d4240000000160000c0010001000100000000000000010000000000000000000000000000003b612e12000000000000000000000000000000000000000009000000" +
      "4800a700a181a43081a1a0030a0101a10c060a2b06010401823702020aa2818b0481884e544c4d53535000020000000c000c003800000005828a02662f82d8f58a8fed" +
      "00000000000000004400440044000000060100000000000f440041002d0037003600350002000c00440041002d0037003600350001000c00440041002d00370036003500" +
      "0400000003000c00640061002d0037003600350007000800b4308fc4bb1ddd0100000000",
      "hex"
    );
    const secBuf = extractSessionSetupSecurityBuffer(raw);
    assert.ok(secBuf);
    const challenge = parseNtlmChallenge(secBuf as Buffer);
    assert.equal(challenge?.nbComputerName, "DA-765");
  });
});

function txtBuf(...entries: string[]): Buffer {
  return Buffer.concat(
    entries.map((e) => {
      const b = Buffer.from(e, "utf8");
      return Buffer.concat([Buffer.from([b.length]), b]);
    })
  );
}

describe("parseTxtRecords", () => {
  it("coppie key=value standard", () => {
    const r = parseTxtRecords(txtBuf("usb_MFG=Canon", "usb_MDL=TS3350"));
    assert.deepEqual(r, { usb_mfg: "Canon", usb_mdl: "TS3350" });
  });

  it("chiave booleana senza '=' → valore stringa vuota", () => {
    const r = parseTxtRecords(txtBuf("txtvers"));
    assert.equal(r["txtvers"], "");
  });

  it("chiavi case-insensitive, normalizzate in minuscolo; il valore mantiene il case originale", () => {
    const r = parseTxtRecords(txtBuf("Model=MacBookPro16,1"));
    assert.equal(r["model"], "MacBookPro16,1");
  });

  it("buffer vuoto → oggetto vuoto", () => {
    assert.deepEqual(parseTxtRecords(Buffer.alloc(0)), {});
  });

  it("ultima character-string troncata (length byte oltre i limiti) → ignora la coda, non lancia", () => {
    const good = txtBuf("ci=17");
    const truncated = Buffer.concat([good, Buffer.from([200, 1, 2, 3])]); // length=200 ma solo 3 byte disponibili
    const r = parseTxtRecords(truncated);
    assert.deepEqual(r, { ci: "17" });
  });

  it("ci= numerico per HomeKit category", () => {
    const r = parseTxtRecords(txtBuf("ci=17", "sf=0"));
    assert.equal(r["ci"], "17");
    assert.equal(r["sf"], "0");
  });
});

// ---------------------------------------------------------------------------
// SSDP/UPnP (fase 3 Task 3)
// ---------------------------------------------------------------------------

function ssdpFinding(partial: Partial<SsdpFinding>): SsdpFinding {
  return {
    st: null,
    server: null,
    location: null,
    manufacturer: null,
    modelName: null,
    deviceType: null,
    ...partial,
  };
}

describe("evidenceFromSsdp", () => {
  it("deviceType WLANAccessPointDevice → network.access_point @0.85", () => {
    const out = evidenceFromSsdp(ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:WLANAccessPointDevice:1" }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "network.access_point");
    assert.equal(c?.confidence, 0.85);
    assert.equal(c?.source, "ssdp");
  });

  it("deviceType InternetGatewayDevice → network.router @0.8", () => {
    const out = evidenceFromSsdp(ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:InternetGatewayDevice:1" }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "network.router");
    assert.equal(c?.confidence, 0.8);
  });

  it("deviceType MediaRenderer → av.display @0.7", () => {
    const out = evidenceFromSsdp(ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:MediaRenderer:1" }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "av.display");
    assert.equal(c?.confidence, 0.7);
  });

  it("deviceType Printer → peripheral.printer @0.85", () => {
    const out = evidenceFromSsdp(ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:Printer:1" }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "peripheral.printer");
    assert.equal(c?.confidence, 0.85);
  });

  it("deviceType non riconosciuto → nessuna evidenza categoria", () => {
    const out = evidenceFromSsdp(ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:BasicDevice:1" }));
    assert.equal(out.find((e) => e.dimension === "category"), undefined);
  });

  it("manufacturer + modelName → vendor @0.75, raw_value combinato", () => {
    const out = evidenceFromSsdp(ssdpFinding({ manufacturer: "Canon Inc.", modelName: "TS3350" }));
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(v?.claim, "canon");
    assert.equal(v?.confidence, 0.75);
    assert.equal(v?.raw_value, "Canon Inc. TS3350");
    assert.equal(v?.source, "ssdp");
  });

  it("manufacturer senza modelName → vendor comunque, raw_value solo manufacturer", () => {
    const out = evidenceFromSsdp(ssdpFinding({ manufacturer: "Sonos" }));
    const v = out.find((e) => e.dimension === "vendor");
    assert.equal(v?.claim, "sonos");
    assert.equal(v?.raw_value, "Sonos");
  });

  it("finding vuoto → nessuna evidenza", () => {
    assert.deepEqual(evidenceFromSsdp(ssdpFinding({})), []);
  });

  it("Ogni claim category è dentro la tassonomia", () => {
    const findings: SsdpFinding[] = [
      ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:WLANAccessPointDevice:1" }),
      ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:InternetGatewayDevice:1" }),
      ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:MediaRenderer:1" }),
      ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:Printer:1" }),
    ];
    for (const f of findings) {
      for (const e of evidenceFromSsdp(f).filter((x) => x.dimension === "category")) {
        assert.ok(isValidCategory(e.claim), `claim fuori tassonomia: ${e.claim}`);
      }
    }
  });

  it("phase 'scan_naabu' e expires_at ~30 giorni", () => {
    const out = evidenceFromSsdp(ssdpFinding({ deviceType: "urn:schemas-upnp-org:device:Printer:1" }));
    assert.ok(out.length > 0);
    for (const e of out) {
      assert.equal(e.phase, "scan_naabu");
      const days = (new Date(e.expires_at as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(days > 29 && days < 31);
    }
  });

  // --- Regole aggiunte da evidenza rete reale: campo `server`, oggi ignorato ---

  it("server 'Synology/DSM/...' → vendor synology + storage.nas @0.85", () => {
    const out = evidenceFromSsdp(ssdpFinding({ server: "Synology/DSM/7.2.1-69057" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "synology");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.85);
  });

  it("server 'QNAP/QTS ...' → vendor qnap + storage.nas @0.85", () => {
    const out = evidenceFromSsdp(ssdpFinding({ server: "Linux/3.x QNAP/QTS UPnP/1.0" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "qnap");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
  });

  it("server 'Linux UPnP/1.0 MikroTik/...' → vendor mikrotik + network.router @0.8", () => {
    const out = evidenceFromSsdp(ssdpFinding({ server: "Linux UPnP/1.0 MikroTik/7.11" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "mikrotik");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "network.router");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.8);
  });

  it("server 'Ubiquiti UniFi ...' → vendor ubiquiti, nessuna categoria dal server", () => {
    const out = evidenceFromSsdp(ssdpFinding({ server: "Ubiquiti UniFi OS" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "ubiquiti");
    assert.equal(out.find((e) => e.dimension === "category"), undefined);
  });

  it("server 'AsusWRT ...' → vendor asus + network.router @0.75", () => {
    const out = evidenceFromSsdp(ssdpFinding({ server: "AsusWRT/Linux UPnP/1.1" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "asus");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "network.router");
  });

  it("server 'Sonos/...' → vendor sonos + av.speaker @0.85", () => {
    const out = evidenceFromSsdp(ssdpFinding({ server: "Linux UPnP/1.0 Sonos/62.1" }));
    assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "sonos");
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.speaker");
  });

  it("server 'Roku/Chromecast/SmartTV/Samsung/LG' → av.display @0.75, nessun vendor", () => {
    for (const server of ["Roku UPnP/1.0", "Chromecast/1.0", "Samsung SmartTV", "LG WebOS"]) {
      const out = evidenceFromSsdp(ssdpFinding({ server }));
      assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.display", server);
      assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.75, server);
    }
  });

  it("server 'Brother/EPSON/Canon/HP' → peripheral.printer @0.8", () => {
    for (const server of ["Brother NC-1234h", "EPSON Web Server", "Canon iR-ADV", "HP HTTP Server"]) {
      const out = evidenceFromSsdp(ssdpFinding({ server }));
      assert.equal(out.find((e) => e.dimension === "category")?.claim, "peripheral.printer", server);
    }
  });

  it("Ogni claim category dalle regole `server` è dentro la tassonomia", () => {
    for (const server of [
      "Synology/DSM/7.2.1", "QNAP/QTS", "Linux UPnP/1.0 MikroTik/7.11", "AsusWRT/Linux",
      "Linux UPnP/1.0 Sonos/62.1", "Roku UPnP/1.0", "Brother NC-1234h",
    ]) {
      const out = evidenceFromSsdp(ssdpFinding({ server }));
      for (const e of out.filter((x) => x.dimension === "category")) {
        assert.ok(isValidCategory(e.claim), `claim fuori tassonomia: ${e.claim}`);
      }
    }
  });

  describe("payload reali (VM 533, rete 192.168.40.0/24)", () => {
    it("192.168.40.23 (Synology): server='Synology/DSM/192.168.16.23', manufacturer/deviceType assenti → vendor synology + storage.nas", () => {
      const out = evidenceFromSsdp(ssdpFinding({
        st: "upnp:rootdevice",
        server: "Synology/DSM/192.168.16.23",
        location: "http://192.168.16.23:5000/ssdp/desc-DSM-ovs_eth4.xml",
        manufacturer: null, modelName: null, deviceType: null,
      }));
      assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "synology");
      assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
    });

    it("192.168.40.27: server='Synology/DSM/...' → vendor synology + storage.nas", () => {
      const out = evidenceFromSsdp(ssdpFinding({ server: "Synology/DSM/6.2.4" }));
      assert.equal(out.find((e) => e.dimension === "vendor")?.claim, "synology");
      assert.equal(out.find((e) => e.dimension === "category")?.claim, "storage.nas");
    });
  });
});

describe("parseSsdpHeaders", () => {
  it("risposta M-SEARCH tipica → st/server/usn/location estratti case-insensitive", () => {
    const raw =
      "HTTP/1.1 200 OK\r\n" +
      "CACHE-CONTROL: max-age=1800\r\n" +
      "ST: urn:schemas-upnp-org:device:Printer:1\r\n" +
      "server: MyPrinter/1.0 UPnP/1.0\r\n" +
      "USN: uuid:1234::urn:schemas-upnp-org:device:Printer:1\r\n" +
      "LOCATION: http://192.168.1.50:80/description.xml\r\n" +
      "\r\n";
    const h = parseSsdpHeaders(raw);
    assert.equal(h.st, "urn:schemas-upnp-org:device:Printer:1");
    assert.equal(h.server, "MyPrinter/1.0 UPnP/1.0");
    assert.equal(h.usn, "uuid:1234::urn:schemas-upnp-org:device:Printer:1");
    assert.equal(h.location, "http://192.168.1.50:80/description.xml");
  });

  it("header assenti → tutti null, nessuna eccezione", () => {
    const h = parseSsdpHeaders("HTTP/1.1 200 OK\r\n\r\n");
    assert.deepEqual(h, { st: null, server: null, usn: null, location: null });
  });

  it("righe senza ':' o vuote → ignorate senza eccezione", () => {
    const h = parseSsdpHeaders("HTTP/1.1 200 OK\r\ngarbageline\r\n\r\nST: ssdp:all\r\n");
    assert.equal(h.st, "ssdp:all");
  });

  it("buffer latin1 equivalente alla stringa → stesso risultato", () => {
    const raw = "HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n\r\n";
    assert.deepEqual(parseSsdpHeaders(Buffer.from(raw, "latin1")), parseSsdpHeaders(raw));
  });
});

// ---------------------------------------------------------------------------
// WS-Discovery (fase 3 Task 3)
// ---------------------------------------------------------------------------

function wsdFinding(partial: Partial<WsdFinding>): WsdFinding {
  return { types: [], scopes: [], ...partial };
}

describe("evidenceFromWsd", () => {
  it("Types con NetworkVideoTransmitter (ONVIF) → av.camera @0.95", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["dn:NetworkVideoTransmitter", "tds:Device"] }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "av.camera");
    assert.equal(c?.confidence, 0.95);
    assert.equal(c?.source, "wsd");
  });

  it("Types con PrintDeviceType → peripheral.printer @0.9", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["wprt:PrintDeviceType"] }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "peripheral.printer");
    assert.equal(c?.confidence, 0.9);
  });

  it("Types con PrinterServiceType → peripheral.printer @0.9", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["wsdp:PrinterServiceType"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "peripheral.printer");
  });

  it("Types con Device + Computer → compute @0.5", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["wsdp:Device", "pub:Computer"] }));
    const c = out.find((e) => e.dimension === "category");
    assert.equal(c?.claim, "compute");
    assert.equal(c?.confidence, 0.5);
  });

  it("solo Device senza Computer → nessuna evidenza categoria (troppo ambiguo)", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["wsdp:Device"] }));
    assert.equal(out.find((e) => e.dimension === "category"), undefined);
  });

  it("Types non riconosciuti → nessuna evidenza categoria", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["custom:SomeVendorSpecificType"] }));
    assert.deepEqual(out, []);
  });

  it("finding vuoto (nessun Types) → nessuna evidenza", () => {
    assert.deepEqual(evidenceFromWsd(wsdFinding({})), []);
  });

  it("Ogni claim category è dentro la tassonomia", () => {
    const findings: WsdFinding[] = [
      wsdFinding({ types: ["dn:NetworkVideoTransmitter"] }),
      wsdFinding({ types: ["wprt:PrintDeviceType"] }),
      wsdFinding({ types: ["wsdp:Device", "pub:Computer"] }),
    ];
    for (const f of findings) {
      for (const e of evidenceFromWsd(f).filter((x) => x.dimension === "category")) {
        assert.ok(isValidCategory(e.claim), `claim fuori tassonomia: ${e.claim}`);
      }
    }
  });

  it("phase 'scan_naabu' e expires_at ~30 giorni", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["dn:NetworkVideoTransmitter"] }));
    assert.ok(out.length > 0);
    for (const e of out) {
      assert.equal(e.phase, "scan_naabu");
      const days = (new Date(e.expires_at as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(days > 29 && days < 31);
    }
  });

  // --- Matching namespace-agnostico: il prefisso QName varia per implementazione ---

  it("'Computer' da solo (senza 'Device') → compute @0.5", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["pub:Computer"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "compute");
    assert.equal(out.find((e) => e.dimension === "category")?.confidence, 0.5);
  });

  it("prefisso di namespace diverso ('dp0:') → NetworkVideoTransmitter riconosciuto comunque", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["dp0:NetworkVideoTransmitter"] }));
    assert.equal(out.find((e) => e.dimension === "category")?.claim, "av.camera");
  });

  it("'Device' con prefisso diverso ('pub:Device'), senza 'Computer' → nessuna evidenza", () => {
    const out = evidenceFromWsd(wsdFinding({ types: ["pub:Device"] }));
    assert.deepEqual(out, []);
  });

  describe("payload reali (VM 533, rete 192.168.40.0/24)", () => {
    it("192.168.40.23 (Synology): types=['wsdp:Device','pub:Computer'], scopes=[] → compute @0.5", () => {
      const out = evidenceFromWsd(wsdFinding({ types: ["wsdp:Device", "pub:Computer"], scopes: [] }));
      const c = out.find((e) => e.dimension === "category");
      assert.equal(c?.claim, "compute");
      assert.equal(c?.confidence, 0.5);
    });
  });
});

describe("collectByLocalName", () => {
  it("estrae stringhe semplici per nome locale, ovunque annidate", () => {
    const tree = { Envelope: { Body: { ProbeMatches: { ProbeMatch: { Types: "dn:NetworkVideoTransmitter" } } } } };
    assert.deepEqual(collectByLocalName(tree, "Types"), ["dn:NetworkVideoTransmitter"]);
  });

  it("ProbeMatch come array (piu' match) → raccoglie da tutti gli elementi", () => {
    const tree = {
      ProbeMatches: {
        ProbeMatch: [{ Types: "a:Foo" }, { Types: "b:Bar" }],
      },
    };
    assert.deepEqual(collectByLocalName(tree, "Types"), ["a:Foo", "b:Bar"]);
  });

  it("valore come nodo con #text (attributi presenti) → estrae il testo", () => {
    const tree = { ProbeMatch: { Types: { "#text": "dn:NetworkVideoTransmitter" } } };
    assert.deepEqual(collectByLocalName(tree, "Types"), ["dn:NetworkVideoTransmitter"]);
  });

  it("nome locale assente → array vuoto, nessuna eccezione", () => {
    assert.deepEqual(collectByLocalName({ Foo: "bar" }, "Types"), []);
  });

  it("nodo null/undefined → array vuoto", () => {
    assert.deepEqual(collectByLocalName(null, "Types"), []);
    assert.deepEqual(collectByLocalName(undefined, "Types"), []);
  });
});
