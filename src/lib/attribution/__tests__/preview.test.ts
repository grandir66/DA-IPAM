import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { previewHostAttribution, recomputeHostAttribution } from "../recompute";
import { recordEvidence } from "../evidence";
import type { AttributionSignals } from "../emitters";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  for (const c of ["attr_vendor TEXT","attr_vendor_name TEXT","attr_category TEXT","attr_os_family TEXT","attr_os_name TEXT","attr_confidence_vendor INTEGER","attr_confidence_category INTEGER","attr_confidence_os INTEGER","attr_min_phase TEXT","attr_at TEXT","attr_engine_version TEXT"]) {
    try { db.exec(`ALTER TABLE hosts ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip, vendor, hostname) VALUES (1, 1, '10.0.0.1', 'Ubiquiti Inc', 'ap-piano2')");
});

function signals(): AttributionSignals {
  return {
    host: { id: 1, ip: "10.0.0.1", mac: "24:5a:4c:00:00:01", vendor: "Ubiquiti Inc", hostname: "ap-piano2", os_info: null, open_ports: null, snmp_data: JSON.stringify({ sysDescr: "U6-Pro 6.5.28", sysObjectID: "1.3.6.1.4.1.41112", collected_at: "x" }), detection_json: null },
    adComputer: null, wazuh: null, neighborSightings: [],
  };
}

describe("previewHostAttribution", () => {
  it("non scrive hosts.attr_* né la history", () => {
    const r = previewHostAttribution(db, signals());
    assert.equal(r.vendor.claim, "ubiquiti");
    assert.equal(r.category.claim, "network.access_point");
    const row = db.prepare("SELECT attr_vendor, attr_category FROM hosts WHERE id=1").get() as Record<string, unknown>;
    assert.equal(row.attr_vendor, null);
    assert.equal(row.attr_category, null);
    const histCount = (db.prepare("SELECT COUNT(*) n FROM host_classification_history WHERE host_id=1").get() as { n: number }).n;
    assert.equal(histCount, 0);
  });

  it("è additiva sulle evidenze (recordEvidence gira comunque)", () => {
    previewHostAttribution(db, signals());
    const n = (db.prepare("SELECT COUNT(*) n FROM attribution_evidence WHERE host_id=1 AND superseded_by IS NULL").get() as { n: number }).n;
    assert.ok(n > 0);
  });

  it("preview seguita da apply produce lo stesso risultato di un recompute diretto", () => {
    const preview = previewHostAttribution(db, signals());
    const applied = recomputeHostAttribution(db, signals(), "apply");
    assert.deepEqual(applied.vendor.claim, preview.vendor.claim);
    assert.deepEqual(applied.category.claim, preview.category.claim);
    assert.deepEqual(applied.os.claim, preview.os.claim);
    const row = db.prepare("SELECT attr_vendor, attr_category FROM hosts WHERE id=1").get() as Record<string, unknown>;
    assert.equal(row.attr_vendor, preview.vendor.claim);
    assert.equal(row.attr_category, preview.category.claim);
  });

  it("host con evidenza manual: il claim fuso resta quello manual", () => {
    recordEvidence(db, 1, [
      { source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 },
    ]);
    const r = previewHostAttribution(db, signals());
    // signals() porta segnali SNMP che punterebbero a network.access_point,
    // ma manual deve vincere sempre (fuse.ts punto 1).
    assert.equal(r.category.claim, "network.switch");
    assert.equal(r.category.min_phase, "manual");
  });
});
