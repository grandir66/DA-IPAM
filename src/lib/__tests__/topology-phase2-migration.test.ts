// src/lib/__tests__/topology-phase2-migration.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateTopologyPhase2 } from "@/lib/db-tenant";

function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE network_devices (id INTEGER PRIMARY KEY);
    CREATE TABLE mac_port_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      mac TEXT NOT NULL, port_name TEXT NOT NULL, vlan INTEGER, port_status TEXT CHECK(port_status IN ('up','down')), speed TEXT, timestamp TEXT DEFAULT (datetime('now')));
    CREATE TABLE topology_position (id INTEGER PRIMARY KEY AUTOINCREMENT, view TEXT NOT NULL DEFAULT 'default', node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 1, structure_sig TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(view, node_id));
    INSERT INTO network_devices (id) VALUES (1);`);
  return db;
}

test("aggiunge colonne, indice unico e topology_maps; la seconda volta non fa niente", () => {
  const db = vecchio();
  const prima = migrateTopologyPhase2(db);
  assert.deepEqual(prima.sort(), ["mac_port_entries.first_seen", "mac_port_entries.source", "topology_maps"].sort());
  assert.deepEqual(migrateTopologyPhase2(db), []);
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_mac_port_entries_key'").get() as { sql: string };
  assert.match(idx.sql, /UNIQUE/);
  db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Prova', 'passo')").run();
  assert.throws(() => db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('X', 'altro')").run());
});

test("i doppi esistenti si riducono alla riga più recente prima dell'indice unico", () => {
  const db = vecchio();
  const ins = db.prepare("INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp) VALUES (1, 'AA:BB:CC:00:00:01', 'Port 3', ?)");
  ins.run("2026-10-01 10:00:00"); ins.run("2026-10-02 10:00:00"); ins.run("2026-10-01 09:00:00");
  migrateTopologyPhase2(db);
  const righe = db.prepare("SELECT timestamp, first_seen, source FROM mac_port_entries").all();
  assert.deepEqual(righe, [{ timestamp: "2026-10-02 10:00:00", first_seen: "2026-10-01 09:00:00", source: "device" }]);
});

test("una sola mappa automatica per tenant", () => {
  const db = vecchio();
  migrateTopologyPhase2(db);
  db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Tutta la rete', 'auto')").run();
  assert.throws(() => db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Altra', 'auto')").run());
});
