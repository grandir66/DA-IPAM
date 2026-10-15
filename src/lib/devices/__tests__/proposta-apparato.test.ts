/**
 * Proposta dell'apparato da un host (tappa 1 credenziali, 15/10).
 *
 * Incidente: promuovendo un server Windows su hardware HP la finestra proponeva
 * «hp» + SSH + profilo ProCurve; un PC con marca dedotta «microsoft» finiva su
 * un valore che la tabella degli apparati rifiuta; la finestra in blocco partiva
 * sempre da «server + Altro + UPS + SNMP v2». Gli host qui hanno la forma vera
 * delle righe di `hosts` (campi inferred_* scritti da auto-classify).
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/proposta-apparato.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  proponiApparato,
  piattaformaDaHost,
  classificazioneValida,
  riallineaAlProtocollo,
  type HostPerProposta,
  type CredenzialeArchivio,
} from "../proposta-apparato";

function host(campi: Partial<HostPerProposta>): HostPerProposta {
  return {
    ip: "10.0.0.10",
    hostname: null,
    custom_name: null,
    classification: "unknown",
    classification_manual: 0,
    inferred_vendor: null,
    inferred_os_family: null,
    inferred_protocol: null,
    inferred_device_type: null,
    inferred_scan_target: null,
    device_manufacturer: null,
    os_info: null,
    model: null,
    vendor: null,
    snmp_data: null,
    host_credentials: [],
    ...campi,
  };
}

const ARCHIVIO: CredenzialeArchivio[] = [
  { id: 1, name: "Dominio", credential_type: "windows", port: null },
  { id: 2, name: "root linux", credential_type: "linux", port: null },
  { id: 3, name: "community", credential_type: "snmp", port: null },
  { id: 4, name: "ssh 2022", credential_type: "ssh", port: 2022 },
];

describe("proponiApparato — piattaforma, protocollo, porta", () => {
  it("server Windows su hardware HP → windows + WinRM 5985, profilo server Windows (non ProCurve)", () => {
    const h = host({
      hostname: "SRV-DC01",
      classification: "server_windows",
      inferred_vendor: "hp",
      inferred_os_family: "windows",
      inferred_protocol: null,
      inferred_device_type: "server",
      inferred_scan_target: "windows",
      device_manufacturer: "HPE",
      os_info: "Windows Server 2019 Standard",
      vendor: "Hewlett Packard Enterprise",
      snmp_data: JSON.stringify({ sysName: "SRV-DC01", sysDescr: "Hardware: Intel64 Family 6 - Software: Windows Version 6.3" }),
    });
    const p = proponiApparato(h, ARCHIVIO);
    assert.equal(p.vendor, "windows");
    assert.equal(p.protocol, "winrm");
    assert.equal(p.port, 5985);
    assert.equal(p.productProfile, "windows_server");
    assert.equal(p.scanTarget, "windows");
    assert.equal(p.name, "SRV-DC01");
  });

  it("PC con marca dedotta «microsoft» → windows, mai microsoft", () => {
    const p = proponiApparato(host({ inferred_vendor: "microsoft", inferred_device_type: "workstation" }), ARCHIVIO);
    assert.equal(p.vendor, "windows");
    assert.equal(p.protocol, "winrm");
    assert.equal(p.classification, "workstation");
    assert.equal(p.productProfile, "windows_client");
  });

  it("server Dell Linux → linux + SSH 22", () => {
    const p = proponiApparato(host({
      inferred_vendor: "dell", inferred_os_family: "linux", inferred_protocol: "ssh",
      inferred_device_type: "server", inferred_scan_target: "linux", device_manufacturer: "Dell Inc.",
    }), ARCHIVIO);
    assert.equal(p.vendor, "linux");
    assert.equal(p.protocol, "ssh");
    assert.equal(p.port, 22);
    assert.equal(p.productProfile, "linux_server");
  });

  it("MikroTik letto in SNMP → mikrotik + SNMP 161, sorgente ARP accesa per un router", () => {
    const p = proponiApparato(host({
      classification: "router", inferred_vendor: "mikrotik", inferred_os_family: "network-os",
      inferred_protocol: "snmp_v2", inferred_device_type: "router", inferred_scan_target: "network",
      snmp_data: JSON.stringify({ sysName: "core-gw", manufacturer: "MikroTik" }),
    }), ARCHIVIO);
    assert.equal(p.vendor, "mikrotik");
    assert.equal(p.protocol, "snmp_v2");
    assert.equal(p.port, 161);
    assert.equal(p.classification, "router");
    assert.equal(p.productProfile, "mikrotik_router");
    assert.equal(p.scanTarget, null, "«network» non è un valore di network_devices.scan_target");
    assert.equal(p.useForArpPoll, true);
    assert.equal(p.name, "core-gw");
  });

  it("Proxmox (Linux) resta proxmox: è una piattaforma, non hardware", () => {
    const p = proponiApparato(host({
      classification: "hypervisor", inferred_vendor: "proxmox", inferred_os_family: "linux",
      inferred_protocol: "api", inferred_device_type: "hypervisor", inferred_scan_target: "proxmox",
    }), ARCHIVIO);
    assert.equal(p.vendor, "proxmox");
    assert.equal(p.protocol, "api");
    assert.equal(p.productProfile, "proxmox_ve");
  });

  it("switch Ubiquiti (Linux) resta ubiquiti; un server Cisco UCS con Linux no", () => {
    assert.equal(piattaformaDaHost(host({ classification: "switch", inferred_vendor: "ubiquiti", inferred_os_family: "linux", inferred_device_type: "switch" })), "ubiquiti");
    assert.equal(piattaformaDaHost(host({ classification: "server", inferred_vendor: "cisco", inferred_os_family: "linux", inferred_device_type: "server" })), "linux");
  });

  it("marche fuori elenco senza famiglia SO → other", () => {
    for (const marca of ["dell", "lenovo", "juniper", "fortinet", "sonicwall", "draytek"]) {
      assert.equal(piattaformaDaHost(host({ inferred_vendor: marca })), "other", marca);
    }
  });

  it("Mac → apple + SSH, profilo Mac", () => {
    const p = proponiApparato(host({ inferred_vendor: "apple", inferred_os_family: "macos", os_info: "macOS 14.5", model: "MacBookPro18,3" }), ARCHIVIO);
    assert.equal(p.vendor, "apple");
    assert.equal(p.protocol, "ssh");
    assert.equal(p.classification, "notebook");
    assert.equal(p.productProfile, "macos_notebook");
    assert.equal(p.scanTarget, "macos");
  });
});

describe("proponiApparato — classificazione", () => {
  it("stampante dedotta «printer» → stampante", () => {
    const p = proponiApparato(host({ inferred_device_type: "printer", inferred_vendor: "brother" }), ARCHIVIO);
    assert.equal(p.classification, "stampante");
    assert.equal(p.vendor, "other");
    assert.equal(p.productProfile, "generic_stampante");
  });

  it("stampante HP → hp + profilo stampante HP", () => {
    const p = proponiApparato(host({ inferred_device_type: "printer", inferred_vendor: "hp" }), ARCHIVIO);
    assert.equal(p.vendor, "hp");
    assert.equal(p.productProfile, "hp_stampante");
  });

  it("scelta manuale sull'host vince sulla deduzione", () => {
    const p = proponiApparato(host({ classification: "nas", classification_manual: 1, inferred_device_type: "server" }), ARCHIVIO);
    assert.equal(p.classification, "nas");
  });

  it("host sconosciuto → classificazione da scegliere", () => {
    const p = proponiApparato(host({ classification: "unknown" }), ARCHIVIO);
    assert.equal(p.classification, "");
  });

  it("classificazioneValida: alias e valori fuori elenco", () => {
    assert.equal(classificazioneValida("printer"), "stampante");
    assert.equal(classificazioneValida("macos"), "notebook");
    assert.equal(classificazioneValida("unknown"), "");
    assert.equal(classificazioneValida("network-os"), "");
    assert.equal(classificazioneValida(null), "");
    assert.equal(classificazioneValida("ups"), "ups");
  });
});

describe("proponiApparato / riallineaAlProtocollo — credenziale e porta", () => {
  it("credenziale SSH validata sulla 2222 → porta 2222", () => {
    const p = proponiApparato(host({
      inferred_os_family: "linux", inferred_device_type: "server",
      host_credentials: [{ credential_id: 2, protocol_type: "ssh", port: 2222, validated: 1 }],
    }), ARCHIVIO);
    assert.equal(p.credentialId, "2");
    assert.equal(p.port, 2222);
  });

  it("una credenziale validata di tipo incompatibile non si propone", () => {
    const p = proponiApparato(host({
      inferred_os_family: "linux", inferred_device_type: "server",
      host_credentials: [{ credential_id: 1, protocol_type: "ssh", port: 22, validated: 1 }],
    }), ARCHIVIO);
    assert.equal(p.credentialId, null);
  });

  it("SNMP come protocollo: la credenziale principale è la SNMP, la seconda resta vuota", () => {
    const p = proponiApparato(host({
      classification: "switch", inferred_vendor: "mikrotik", inferred_os_family: "network-os",
      inferred_protocol: "snmp_v2", inferred_device_type: "switch",
      host_credentials: [{ credential_id: 3, protocol_type: "snmp", port: 161, validated: 1 }],
    }), ARCHIVIO);
    assert.equal(p.credentialId, "3");
    assert.equal(p.snmpCredentialId, null);
  });

  it("protocollo SSH: la SNMP validata va nella seconda tendina", () => {
    const p = proponiApparato(host({
      classification: "switch", inferred_vendor: "mikrotik", inferred_os_family: "network-os",
      inferred_protocol: "ssh", inferred_device_type: "switch",
      host_credentials: [
        { credential_id: 4, protocol_type: "ssh", port: 2022, validated: 1 },
        { credential_id: 3, protocol_type: "snmp", port: 161, validated: 1 },
      ],
    }), ARCHIVIO);
    assert.equal(p.credentialId, "4");
    assert.equal(p.port, 2022);
    assert.equal(p.snmpCredentialId, "3");
  });

  it("credenziale Windows validata, protocollo cambiato in SNMP → credenziale azzerata, porta 161", () => {
    const h = host({
      inferred_os_family: "windows", inferred_device_type: "server",
      host_credentials: [{ credential_id: 1, protocol_type: "winrm", port: 5985, validated: 1 }],
    });
    const p = proponiApparato(h, ARCHIVIO);
    assert.equal(p.credentialId, "1");
    const q = riallineaAlProtocollo(p, "snmp_v2", ARCHIVIO, h);
    assert.equal(q.protocol, "snmp_v2");
    assert.equal(q.credentialId, null);
    assert.equal(q.port, 161);
  });

  it("riallineaAlProtocollo usa la porta propria della credenziale d'archivio", () => {
    const p = proponiApparato(host({ inferred_os_family: "linux", inferred_device_type: "server" }), ARCHIVIO);
    const q = riallineaAlProtocollo({ ...p, credentialId: "4" }, "ssh", ARCHIVIO);
    assert.equal(q.credentialId, "4");
    assert.equal(q.port, 2022);
  });

  it("da SNMP a SSH la SNMP scelta scende nella seconda tendina", () => {
    const h = host({ classification: "switch", inferred_vendor: "mikrotik", inferred_protocol: "snmp_v2", inferred_device_type: "switch",
      host_credentials: [{ credential_id: 3, protocol_type: "snmp", port: 161, validated: 1 }] });
    const p = proponiApparato(h, ARCHIVIO);
    const q = riallineaAlProtocollo(p, "ssh", ARCHIVIO, h);
    assert.equal(q.credentialId, null);
    assert.equal(q.snmpCredentialId, "3");
    assert.equal(q.port, 22);
  });
});
