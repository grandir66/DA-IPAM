/**
 * Apparato creato da solo (Riccardo, 10/11/2026). Regole: classe del motore solo se sicura (≥ 80) o scelta a mano;
 * SNMP, SSH e WinRM; ogni credenziale validata diventa un legame dell'apparato; interruttore che nasce spento.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/apparato-automatico.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { apparatiAutomaticiAccesi, impostaApparatiAutomatici, pianoApparatoAutomatico } from "../apparato-automatico";
import type { HostPerProposta } from "../proposta-apparato";

const ARCHIVIO = [
  { id: 7, name: "snmp ro", credential_type: "snmp", port: null },
  { id: 9, name: "admin ssh", credential_type: "ssh", port: null },
  { id: 11, name: "admin windows", credential_type: "windows", port: null },
];

function host(campi: Partial<HostPerProposta> & { attr_confidence_category?: number | null }) {
  return {
    id: 1, ip: "10.80.0.20", hostname: "nas-sala", custom_name: null, classification: "nas", classification_manual: 0,
    attr_confidence_category: 90, inferred_vendor: null, inferred_os_family: null, inferred_protocol: null,
    inferred_device_type: null, inferred_scan_target: null, device_manufacturer: null, os_info: null, model: null,
    vendor: null, snmp_data: null,
    host_credentials: [
      { credential_id: 9, protocol_type: "ssh", port: 22, validated: 1 },
      { credential_id: 7, protocol_type: "snmp", port: 161, validated: 1 },
    ], ...campi,
  };
}

describe("piano dell'apparato automatico (regola pura)", () => {
  it("classe del motore sicura, due protocolli validati → entrambe le credenziali finiscono sull'apparato", () => {
    const r = pianoApparatoAutomatico(host({}), ARCHIVIO);
    assert.ok("corpo" in r);
    assert.equal(r.corpo.classification, "nas");
    const legate = [r.corpo.credential_id, r.corpo.snmp_credential_id, ...r.altri.map((l) => l.credential_id)].filter((x) => x != null);
    assert.deepEqual([...legate].sort(), [7, 9]);
  });
  it("classe del motore poco sicura → niente; la stessa scelta a mano → sì", () => {
    assert.deepEqual(pianoApparatoAutomatico(host({ attr_confidence_category: 60 }), ARCHIVIO), { motivo: "categoria_incerta" });
    assert.ok("corpo" in pianoApparatoAutomatico(host({ attr_confidence_category: 60, classification_manual: 1 }), ARCHIVIO));
  });
  it("senza classe o senza credenziale validata → niente", () => {
    assert.deepEqual(pianoApparatoAutomatico(host({ classification: null }), ARCHIVIO), { motivo: "senza_classe" });
    assert.deepEqual(pianoApparatoAutomatico(host({ host_credentials: [{ credential_id: 9, protocol_type: "ssh", port: 22, validated: 0 }] }), ARCHIVIO), { motivo: "nessuna_credenziale" });
  });
  it("una credenziale sola, di un protocollo diverso da quello proposto → l'apparato usa quella", () => {
    const r = pianoApparatoAutomatico(host({ classification: "switch", host_credentials: [{ credential_id: 9, protocol_type: "ssh", port: 22, validated: 1 }] }), ARCHIVIO);
    assert.ok("corpo" in r);
    assert.equal(r.corpo.protocol, "ssh");
    assert.equal(r.corpo.credential_id, 9);
  });
});

describe("difetti visti sull'hub 533 alla prima creazione (10/11/2026)", () => {
  it("una VM su Proxmox classificata server non diventa un nodo Proxmox", () => {
    const r = pianoApparatoAutomatico(host({
      classification: "server", inferred_vendor: "proxmox", inferred_os_family: "linux", vendor: "Proxmox Server Solutions GmbH",
      inferred_scan_target: "proxmox", host_credentials: [{ credential_id: 9, protocol_type: "ssh", port: 22, validated: 1 }],
    }), ARCHIVIO);
    assert.ok("corpo" in r);
    assert.equal(r.corpo.vendor, "linux");
    assert.equal(r.corpo.device_type, "server");
    assert.notEqual(r.corpo.scan_target, "proxmox");
  });
  it("un hypervisor vero resta Proxmox", () => {
    const r = pianoApparatoAutomatico(host({
      classification: "hypervisor", inferred_vendor: "proxmox", inferred_os_family: "linux",
      host_credentials: [{ credential_id: 9, protocol_type: "ssh", port: 22, validated: 1 }],
    }), ARCHIVIO);
    assert.ok("corpo" in r);
    assert.equal(r.corpo.vendor, "proxmox");
    assert.equal(r.corpo.device_type, "hypervisor");
  });
  it("una postazione Windows non nasce switch", () => {
    const r = pianoApparatoAutomatico(host({
      classification: "workstation", inferred_os_family: "windows", inferred_vendor: "hp",
      host_credentials: [{ credential_id: 11, protocol_type: "winrm", port: 5985, validated: 1 }],
    }), ARCHIVIO);
    assert.ok("corpo" in r);
    assert.equal(r.corpo.classification, "workstation");
    assert.equal(r.corpo.device_type, "server");
  });
});

describe("interruttore", () => {
  it("nasce spento e si accende solo scrivendolo", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE tenant_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
    assert.equal(apparatiAutomaticiAccesi(db), false);
    impostaApparatiAutomatici(db, true);
    assert.equal(apparatiAutomaticiAccesi(db), true);
    impostaApparatiAutomatici(db, false);
    assert.equal(apparatiAutomaticiAccesi(db), false);
  });
});
