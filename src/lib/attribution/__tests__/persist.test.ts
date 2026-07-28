import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { applyAttribution } from "../persist";
import type { AttributionResult, DimensionResult } from "../fuse";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  for (const c of [
    "attr_vendor TEXT", "attr_vendor_name TEXT", "attr_category TEXT",
    "attr_os_family TEXT", "attr_os_name TEXT",
    "attr_confidence_vendor INTEGER", "attr_confidence_category INTEGER", "attr_confidence_os INTEGER",
    "attr_min_phase TEXT", "attr_at TEXT", "attr_engine_version TEXT",
    "inferred_device_type TEXT", "inferred_vendor TEXT", "inferred_os_family TEXT",
    "inferred_confidence INTEGER",
  ]) {
    try { db.exec(`ALTER TABLE hosts ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
});

function insertHost(opts: { id: number; classificationManual?: 0 | 1; classification?: string | null }) {
  db.exec(
    `INSERT INTO hosts (id, network_id, ip, classification, classification_manual)
     VALUES (${opts.id}, 1, '10.0.0.${opts.id}', ${opts.classification ? `'${opts.classification}'` : "'unknown'"}, ${opts.classificationManual ?? 0})`
  );
}

function dim(claim: string | null, confidence = 80): DimensionResult {
  return { claim, confidence, min_phase: null, evidence_ids: [], conflicts: [], authoritative: false };
}

function fusionResult(opts: { category?: string | null; categoryConfidence?: number; os?: string | null; vendor?: string | null }): AttributionResult {
  return {
    vendor: { ...dim(opts.vendor ?? null), vendor_name: null },
    category: dim(opts.category ?? null, opts.categoryConfidence ?? 80),
    os: { ...dim(opts.os ?? null), os_name: null },
    engine_version: "2.0.0",
  };
}

function hostRow(id: number) {
  return db.prepare(
    "SELECT classification, classification_manual, inferred_device_type, inferred_vendor, inferred_os_family, inferred_confidence FROM hosts WHERE id = ?"
  ).get(id) as Record<string, unknown>;
}

describe("applyAttribution — proiezione legacy (fase 4)", () => {
  it("host con classification_manual=1 → nessuna scrittura sulle colonne legacy", () => {
    insertHost({ id: 1, classificationManual: 1, classification: "server" });
    applyAttribution(db, 1, fusionResult({ category: "network.router", os: null, vendor: "cisco" }), "scan");
    const row = hostRow(1);
    assert.equal(row.classification, "server", "classification manuale non deve mai essere toccata");
    assert.equal(row.inferred_device_type, null, "inferred_* non devono essere scritte su host manuale");
    assert.equal(row.inferred_vendor, null);
    assert.equal(row.inferred_os_family, null);
    assert.equal(row.inferred_confidence, null);
  });

  it("host non manuale → le colonne legacy si allineano alla proiezione", () => {
    insertHost({ id: 2, classificationManual: 0, classification: "unknown" });
    applyAttribution(db, 2, fusionResult({ category: "network.router", categoryConfidence: 91, os: null, vendor: "cisco" }), "scan");
    const row = hostRow(2);
    assert.equal(row.classification, "router");
    assert.equal(row.inferred_device_type, "router");
    assert.equal(row.inferred_vendor, "cisco");
    assert.equal(row.inferred_confidence, 91);
  });

  it("proiezione null (es. categoria 'network' livello 1) → classification preesistente invariata", () => {
    insertHost({ id: 3, classificationManual: 0, classification: "workstation" });
    applyAttribution(db, 3, fusionResult({ category: "network", os: null, vendor: null }), "scan");
    const row = hostRow(3);
    assert.equal(row.classification, "workstation", "meglio un dato vecchio che nessun dato");
  });

  it("compute.server + os=windows → classification diventa server_windows", () => {
    insertHost({ id: 4, classificationManual: 0, classification: "unknown" });
    applyAttribution(db, 4, fusionResult({ category: "compute.server", os: "windows" }), "scan");
    assert.equal(hostRow(4).classification, "server_windows");
  });

  it("valore già allineato → non riscrive (nessun cambiamento, resta idempotente)", () => {
    insertHost({ id: 5, classificationManual: 0, classification: "router" });
    db.exec("UPDATE hosts SET inferred_device_type='router', inferred_vendor='cisco', inferred_os_family=NULL, inferred_confidence=91 WHERE id=5");
    // Pre-popola anche attr_* allo stesso valore per far scattare il guard "invariato"
    // e verificare che il ramo legacy non venga nemmeno considerato in quel caso.
    applyAttribution(db, 5, fusionResult({ category: "network.router", categoryConfidence: 91, os: null, vendor: "cisco" }), "scan");
    const wrote = applyAttribution(db, 5, fusionResult({ category: "network.router", categoryConfidence: 91, os: null, vendor: "cisco" }), "scan");
    assert.equal(wrote, false, "il secondo apply con stesso risultato non deve scrivere nulla (guard esistente)");
  });
});
