import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  return db;
}

describe("attribution schema wiring", () => {
  it("attribution_evidence esiste con le colonne della spec", () => {
    const db = freshDb();
    const cols = db.prepare("PRAGMA table_info(attribution_evidence)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    for (const c of ["host_id", "source", "phase", "dimension", "claim", "confidence", "weight", "raw_value", "observed_at", "expires_at", "superseded_by"]) {
      assert.ok(names.includes(c), `manca colonna ${c}`);
    }
  });
  it("dimension ha CHECK sui 3 valori", () => {
    const db = freshDb();
    db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
    db.exec("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.0.0.1')");
    assert.throws(() =>
      db.prepare(
        "INSERT INTO attribution_evidence (host_id, source, phase, dimension, claim, confidence, weight) VALUES (1,'oui','scan_icmp','colore','x',1,1)"
      ).run()
    );
  });
  it("indice per host+dimension presente", () => {
    const db = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='attribution_evidence'").all() as Array<{ name: string }>;
    assert.ok(idx.some((i) => i.name === "idx_attr_evidence_host"), "manca idx_attr_evidence_host");
  });
  it("table-registry include attribution_evidence", async () => {
    const { TENANT_TABLES } = await import("@/lib/transfer/table-registry");
    assert.ok(TENANT_TABLES.some((t: { table: string }) => t.table === "attribution_evidence"));
  });
});
