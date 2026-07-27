// src/lib/attribution/__tests__/probe-evidence.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { evidenceFromHttpTls, evidenceFromSmb2, evidenceFromMdns } from "../probe-evidence";
import { isValidCategory } from "../taxonomy";
import type { HttpTlsFinding } from "@/lib/scanner/probes/http-tls";
import type { Smb2Finding } from "@/lib/scanner/probes/smb2";
import { parseNtlmChallenge } from "@/lib/scanner/probes/smb2";
import type { MdnsFinding } from "@/lib/scanner/probes/mdns";
import { parseTxtRecords } from "@/lib/scanner/probes/mdns";

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

  it("osVersion assente (Version non letta dalla CHALLENGE) → os windows comunque, raw_value null", () => {
    const out = evidenceFromSmb2(smb2Finding({ osVersion: null }));
    const os = out.find((e) => e.dimension === "os");
    assert.equal(os?.claim, "windows");
    assert.equal(os?.raw_value, null);
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
