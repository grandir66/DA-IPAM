import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMcSchemaMigrations, dropMcSchema, mcTablesExist } from "@/lib/integrations/meshcentral/schema";

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  // minimal parent so FK references resolve (mc_node/mc_remote_session reference hosts)
  db.exec("CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT);");
  db.pragma("foreign_keys = ON");
  return db;
}

test("applyMcSchemaMigrations creates the 3 tables and is idempotent", () => {
  const db = freshDb();
  applyMcSchemaMigrations(db);
  applyMcSchemaMigrations(db); // second run must not throw
  const names = tableNames(db);
  for (const t of ["mc_node", "mc_remote_session", "mc_node_bind"]) {
    assert.ok(names.includes(t), `missing ${t}`);
  }
  assert.equal(mcTablesExist(db), true);
});

test("mc_node enforces host_id FK as SET NULL and accepts inserts", () => {
  const db = freshDb();
  applyMcSchemaMigrations(db);
  db.prepare("INSERT INTO hosts (id) VALUES (1)").run();
  db.prepare(
    "INSERT INTO mc_node (node_id, host_id, mesh_id, name, conn) VALUES ('node//AAA', 1, 'mesh//X', 'pc1', 1)",
  ).run();
  const row = db.prepare("SELECT host_id, conn FROM mc_node WHERE node_id='node//AAA'").get() as { host_id: number; conn: number };
  assert.equal(row.host_id, 1);
  assert.equal(row.conn, 1);
  db.prepare("DELETE FROM hosts WHERE id=1").run();
  const after = db.prepare("SELECT host_id FROM mc_node WHERE node_id='node//AAA'").get() as { host_id: number | null };
  assert.equal(after.host_id, null); // ON DELETE SET NULL
});

test("dropMcSchema removes all 3 tables in reverse FK order", () => {
  const db = freshDb();
  applyMcSchemaMigrations(db);
  dropMcSchema(db);
  const names = tableNames(db);
  for (const t of ["mc_node", "mc_remote_session", "mc_node_bind"]) {
    assert.ok(!names.includes(t), `${t} should be dropped`);
  }
  assert.equal(mcTablesExist(db), false);
  dropMcSchema(db); // idempotent
});
