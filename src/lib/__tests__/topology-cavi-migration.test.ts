// Migrazione «topologia cavi» (spec 2026-10-14 §13.5.7, tappa T2): tre tabelle di fatti delle letture in più e sei
// colonne (quattro su device_neighbors, due su network_devices), più `lag_state` (stato del membro di un bond, §13.5.5:
// la spec lo usa e il suo DDL non l'aveva). Additiva, idempotente, in UNA transazione: device_neighbors non si ricostruisce
// (CHECK di protocol e chiave unica uguali, ADR 0008 «Alternative scartate», regola 10 del repo). Il DB «vecchio»
// riproduce le due tabelle come sono alla v0.3.293.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateTopologyCavi, schemaCaviPresente, withTenant } from "@/lib/db-tenant";

const T = "TESTTOPOCAVIMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE network_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL,
      vendor TEXT NOT NULL, protocol TEXT NOT NULL, uplink_mac TEXT, uplink_remote_port INTEGER
    );
    CREATE TABLE device_neighbors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      local_port TEXT NOT NULL,
      remote_device_name TEXT NOT NULL DEFAULT '',
      remote_port TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown')),
      remote_ip TEXT,
      remote_mac TEXT,
      remote_platform TEXT,
      first_seen TEXT,
      source TEXT NOT NULL DEFAULT 'device',
      timestamp TEXT DEFAULT (datetime('now')),
      UNIQUE(device_id, local_port, remote_device_name, remote_port)
    );
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (7, 'SW-7', '10.0.0.7', 'switch', 'other', 'ssh');
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac, source, timestamp)
      VALUES (7, 'Port 3', 'RTR-1', 'ether2', 'lldp', '02:00:00:00:01:01', 'unifi', '2026-10-13 11:00:00');
  `);
  return db;
}

const schema = (db: Database.Database) => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
const sqlDi = (db: Database.Database, nome: string): string =>
  String((db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(nome) as { sql: string }).sql);

test("aggiunge colonne, tabelle e indice; la seconda volta niente", () => {
  const db = vecchio();
  assert.deepEqual([...migrateTopologyCavi(db)].sort(), [
    "device_neighbors.discovered_by", "device_neighbors.local_port_index", "device_neighbors.remote_caps",
    "device_neighbors.remote_port_index", "idx_topology_device_macs_mac", "network_devices.uplink_local_port_idx",
    "network_devices.uplink_source", "topology_bridge_facts", "topology_device_macs", "topology_port_facts",
  ]);
  const prima = schema(db);
  assert.deepEqual(migrateTopologyCavi(db), []);
  assert.deepEqual(schema(db), prima, "seconda apertura: niente cambia");
});

test("device_neighbors non si ricostruisce: CHECK, chiave unica e righe di prima uguali", () => {
  const db = vecchio();
  const sqlPrima = sqlDi(db, "device_neighbors");
  migrateTopologyCavi(db);
  const sqlDopo = sqlDi(db, "device_neighbors");
  assert.ok(sqlDopo.includes("CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown'))"));
  assert.ok(sqlDopo.includes("UNIQUE(device_id, local_port, remote_device_name, remote_port)"));
  // ALTER TABLE … ADD COLUMN mette la colonna dopo l'ultima colonna e PRIMA dei vincoli di tabella (UNIQUE): tolte le
  // quattro colonne nuove, il testo è quello di prima, carattere per carattere (nessuna ricostruzione).
  const senzaNuove = sqlDopo.replace(/, (discovered_by TEXT|local_port_index INTEGER|remote_port_index INTEGER|remote_caps TEXT)/g, "");
  assert.equal(senzaNuove, sqlPrima, "solo colonne aggiunte");
  assert.deepEqual(
    db.prepare("SELECT device_id, local_port, remote_device_name, remote_port, protocol, source, discovered_by FROM device_neighbors").all(),
    [{ device_id: 7, local_port: "Port 3", remote_device_name: "RTR-1", remote_port: "ether2", protocol: "lldp", source: "unifi", discovered_by: null }],
  );
  assert.throws(() => db.prepare("INSERT INTO device_neighbors (device_id, local_port, protocol) VALUES (7, 'x', 'snmp')").run(), /CHECK/);
  // Le colonne nuove sono senza CHECK: un valore nuovo non chiede una ricostruzione.
  assert.doesNotThrow(() => db.prepare("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, if_kind) VALUES (7, 'nuova', 'n:x', 'x', 'qualunque')").run());
});

test("una colonna c'è già (ritorno indietro e nuovo avanzamento): si aggiunge solo ciò che manca", () => {
  const db = vecchio();
  db.exec("ALTER TABLE device_neighbors ADD COLUMN discovered_by TEXT");
  const aggiunte = migrateTopologyCavi(db);
  assert.equal(aggiunte.includes("device_neighbors.discovered_by"), false);
  assert.equal(aggiunte.includes("device_neighbors.remote_caps"), true);
});

test("in transazione: se un passo fallisce non resta niente a metà", () => {
  const db = new Database(":memory:");
  // Manca network_devices: l'ALTER su network_devices fallisce dopo quelli su device_neighbors.
  db.exec("CREATE TABLE device_neighbors (id INTEGER PRIMARY KEY, device_id INTEGER, local_port TEXT, protocol TEXT)");
  assert.throws(() => migrateTopologyCavi(db));
  const colonne = (db.prepare("PRAGMA table_info(device_neighbors)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(colonne, ["id", "device_id", "local_port", "protocol"]);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'topology_port_facts'").get(), undefined);
});

test("all'apertura del tenant: schema presente, e le tabelle nuove puntano ancora a network_devices", () => {
  getTenantDb(T);
  assert.equal(withTenant(T, () => schemaCaviPresente()), true);
  for (const t of ["topology_port_facts", "topology_bridge_facts", "topology_device_macs"]) {
    const fk = getTenantDb(T).prepare(`PRAGMA foreign_key_list(${t})`).all() as Array<{ table: string; on_delete: string }>;
    assert.deepEqual(fk.map((f) => [f.table, f.on_delete]), [["network_devices", "CASCADE"]], t);
  }
});
