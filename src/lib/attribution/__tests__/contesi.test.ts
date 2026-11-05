import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { applicaScelteContesi, leggiContesiDiRete, valoriInContrasto } from "../contesi";
import { getActiveEvidence, recordEvidence } from "../evidence";
import { fuseAttribution } from "../fuse";
import type { AttributionSignals } from "../emitters";
import type { EvidenceInput } from "../types";

const ORA = "2026-11-06T12:00:00.000Z";
let db: Database.Database;

const cat = (source: EvidenceInput["source"], claim: string, confidence = 0.85): EvidenceInput =>
  ({ source, phase: "integration", dimension: "category", claim, confidence });

/* I segnali vuoti non emettono evidenze nuove: la prova guarda solo le scelte. */
const segnali = (id: number) => ({
  host: { id, ip: "10.0.0.1", mac: null, vendor: null, hostname: null, os_info: null, open_ports: null, snmp_data: null, detection_json: null },
  adComputer: null, wazuh: null, neighborSightings: [],
}) as unknown as AttributionSignals;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  // le colonne attr_* vengono dagli ALTER di getTenantDb: come in recompute.test.ts
  for (const c of ["attr_vendor TEXT","attr_vendor_name TEXT","attr_category TEXT","attr_os_family TEXT","attr_os_name TEXT","attr_confidence_vendor INTEGER","attr_confidence_category INTEGER","attr_confidence_os INTEGER","attr_min_phase TEXT","attr_at TEXT","attr_engine_version TEXT","inferred_device_type TEXT","inferred_vendor TEXT","inferred_os_family TEXT","inferred_confidence INTEGER"]) {
    try { db.exec(`ALTER TABLE hosts ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24'), (2, 'm', '10.0.1.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.0.0.20'), (2, 1, '10.0.0.3'), (3, 2, '10.0.1.1')");
});

describe("valoriInContrasto", () => {
  it("una categoria generica non contraddice la sua foglia", () => {
    assert.deepEqual(valoriInContrasto("category", ["compute", "compute.server"]), ["compute.server"]);
  });
  it("due foglie della stessa radice si contraddicono: e' il server contro vm dell'hub", () => {
    assert.equal(valoriInContrasto("category", ["compute.server", "compute.vm"]).length, 2);
  });
  it("il prefisso del produttore e' lo stesso produttore", () => {
    assert.deepEqual(valoriInContrasto("vendor", ["proxmox-server-solutions", "proxmox"]), ["proxmox"]);
    assert.equal(valoriInContrasto("vendor", ["proxmox", "dell"]).length, 2);
  });
  it("unknown non conta", () => {
    assert.equal(valoriInContrasto("category", ["unknown", "compute.server"]).length, 1);
  });
});

describe("leggiContesiDiRete", () => {
  it("riporta solo gli host contesi della rete, ordinati per IP, con le colonne dalla fonte piu' pesante", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), cat("oui", "compute.vm")]);
    recordEvidence(db, 2, [cat("ports", "compute.workstation", 0.5), cat("ad", "network.router")]);
    recordEvidence(db, 3, [cat("ad", "compute.server"), cat("oui", "compute.vm")]);
    const e = leggiContesiDiRete(db, 1, ORA);
    assert.deepEqual(e.righe.map((r) => r.ip), ["10.0.0.3", "10.0.0.20"]);
    assert.deepEqual(e.fonti, ["ad", "oui", "ports"]);
    assert.equal(e.host_valutati, 2);
  });
  it("un host su cui le fonti concordano non compare", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), cat("wazuh", "compute.server")]);
    assert.equal(leggiContesiDiRete(db, 1, ORA).righe.length, 0);
  });
  it("un'evidenza scaduta non contende piu'", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), { ...cat("dhcp", "compute.vm"), expires_at: "2026-11-01T00:00:00.000Z" }]);
    assert.equal(leggiContesiDiRete(db, 1, ORA).righe.length, 0);
  });
  it("i manuali restano fuori e con il filtro si vedono segnati", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), cat("oui", "compute.vm")]);
    db.exec("UPDATE hosts SET classification_manual = 1 WHERE id = 1");
    assert.equal(leggiContesiDiRete(db, 1, ORA).righe.length, 0);
    const r = leggiContesiDiRete(db, 1, ORA, { includiManuali: true }).righe;
    assert.equal(r.length, 1);
    assert.equal(r[0].manuale, true);
  });
});

describe("applicaScelteContesi", () => {
  it("la scelta diventa manuale, vince la fusione e il dato esce dai contesi", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), cat("oui", "compute.vm")]);
    const esito = applicaScelteContesi(db, [{ host_id: 1, dimensione: "category", valore: "compute.vm" }], segnali, ORA);
    assert.deepEqual(esito, { applicate: 1, rifiutate: [] });
    assert.equal(fuseAttribution(getActiveEvidence(db, 1), ORA).category.claim, "compute.vm");
    assert.equal(leggiContesiDiRete(db, 1, ORA).righe.length, 0);
  });
  it("un valore che nessuna fonte ha detto si rifiuta e si dice perche'", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), cat("oui", "compute.vm")]);
    const esito = applicaScelteContesi(db, [{ host_id: 1, dimensione: "category", valore: "storage.nas" }], segnali, ORA);
    assert.equal(esito.applicate, 0);
    assert.match(esito.rifiutate[0].motivo, /nessuna fonte/);
    assert.equal(getActiveEvidence(db, 1).some((e) => e.source === "manual"), false);
  });
  it("una categoria fissata a mano non si sovrascrive", () => {
    recordEvidence(db, 1, [cat("ad", "compute.server"), cat("oui", "compute.vm")]);
    db.exec("UPDATE hosts SET classification_manual = 1 WHERE id = 1");
    const esito = applicaScelteContesi(db, [{ host_id: 1, dimensione: "category", valore: "compute.vm" }], segnali, ORA);
    assert.equal(esito.applicate, 0);
    assert.match(esito.rifiutate[0].motivo, /a mano/);
  });
  it("un host che non esiste si riporta, non si ignora", () => {
    const esito = applicaScelteContesi(db, [{ host_id: 99, dimensione: "os", valore: "linux" }], segnali, ORA);
    assert.match(esito.rifiutate[0].motivo, /non trovato/);
  });
});
