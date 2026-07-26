import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { recordEvidence, getActiveEvidence } from "../evidence";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.0.0.1')");
});

describe("recordEvidence", () => {
  it("inserisce evidenza nuova con weight di default", () => {
    const r = recordEvidence(db, 1, [
      { source: "oui", phase: "scan_icmp", dimension: "vendor", claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" },
    ]);
    assert.equal(r.inserted, 1);
    const rows = getActiveEvidence(db, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].weight, 0.9); // ATTR_SOURCE_WEIGHTS.oui
  });
  it("ri-emissione identica → refresh, non duplicato", () => {
    const input = { source: "oui" as const, phase: "scan_icmp" as const, dimension: "vendor" as const, claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" };
    recordEvidence(db, 1, [input]);
    const r2 = recordEvidence(db, 1, [input]);
    assert.equal(r2.refreshed, 1);
    assert.equal(r2.inserted, 0);
    assert.equal(getActiveEvidence(db, 1).length, 1);
  });
  it("claim diverso dalla stessa (source,dimension) → supersede", () => {
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const r2 = recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.switch", confidence: 0.5 }]);
    assert.equal(r2.inserted, 1);
    assert.equal(r2.superseded, 1);
    const active = getActiveEvidence(db, 1);
    assert.equal(active.length, 1);
    assert.equal(active[0].claim, "network.switch");
    const all = db.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE host_id=1").get() as { n: number };
    assert.equal(all.n, 2); // la storia resta
  });
  it("manual non viene mai superseded da sorgenti automatiche", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const active = getActiveEvidence(db, 1);
    assert.ok(active.some((e) => e.source === "manual" && e.claim === "network.switch"));
  });
  it("nuovo manual supersede il manual precedente sulla stessa dimensione", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.router", confidence: 1 }]);
    const manuals = getActiveEvidence(db, 1).filter((e) => e.source === "manual");
    assert.equal(manuals.length, 1);
    assert.equal(manuals[0].claim, "network.router");
  });
});
