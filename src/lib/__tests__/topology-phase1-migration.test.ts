// Migrazione «topologia fase 1» (spec 2026-10-12-topology-map-design §5): solo
// colonne e una tabella nuove, idempotente, dati esistenti intatti. Il DB
// «vecchio» riproduce le tabelle come sono su dev al 13/10.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { resolveDataDir } from "@/lib/data-dir";
import { deleteTenantDatabase, getTenantDb, migrateTopologyPhase1 } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";

const T = "TESTTOPOF1MIG";
const T_VECCHIO = "TESTTOPOF1REBUILD";

function dbVecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL, address TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE networks (id INTEGER PRIMARY KEY AUTOINCREMENT, cidr TEXT NOT NULL UNIQUE, name TEXT NOT NULL, gateway TEXT, location TEXT DEFAULT '');
    CREATE TABLE network_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL, vendor TEXT NOT NULL, protocol TEXT NOT NULL, host_id INTEGER, physical_device_id INTEGER);
    CREATE TABLE switch_ports (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE, port_index INTEGER NOT NULL, port_name TEXT NOT NULL, UNIQUE(device_id, port_index));
    CREATE TABLE device_neighbors (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE, local_port TEXT NOT NULL, remote_device_name TEXT NOT NULL DEFAULT '', remote_port TEXT NOT NULL DEFAULT '', protocol TEXT NOT NULL, remote_ip TEXT, remote_mac TEXT, remote_platform TEXT, timestamp TEXT DEFAULT (datetime('now')), UNIQUE(device_id, local_port, remote_device_name, remote_port));
    CREATE TABLE topology_position (id INTEGER PRIMARY KEY AUTOINCREMENT, view TEXT NOT NULL DEFAULT 'default', node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, pinned INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(view, node_id));
  `);
  db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api')").run();
  db.prepare("INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, timestamp) VALUES (1, 'Port 1', 'RTR-1', 'ether2', 'lldp', '2026-10-01 03:00:00')").run();
  return db;
}

const COLONNE = [
  "network_devices.location_id", "network_devices.location_set_by", "network_devices.location_set_at",
  "network_devices.topology_role", "network_devices.topology_hidden", "network_devices.controller_mac",
  "network_devices.uplink_mac", "network_devices.uplink_remote_port", "network_devices.uplink_seen_at",
  "switch_ports.is_uplink", "device_neighbors.first_seen", "device_neighbors.source",
  "locations.head_device_id", "locations.head_set_by", "locations.head_set_at",
  "networks.location_id", "networks.location_set_by", "networks.location_set_at",
  "topology_position.structure_sig",
];

function colonne(db: Database.Database, tabella: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).map((c) => c.name);
}

after(() => {
  deleteTenantDatabase(T);
  deleteTenantDatabase(T_VECCHIO);
  closeHubDb();
  removeTestHubDb();
});

test("su un DB vecchio aggiunge tutte le colonne, una volta sola", () => {
  const db = dbVecchio();
  assert.deepEqual([...migrateTopologyPhase1(db)].sort(), [...COLONNE].sort());
  assert.deepEqual(migrateTopologyPhase1(db), []);
  assert.ok(colonne(db, "topology_link_overrides").includes("a_node"));
});

test("i vicini esistenti tengono la data e nascono con first_seen = timestamp e fonte «device»", () => {
  const db = dbVecchio();
  migrateTopologyPhase1(db);
  const r = db.prepare("SELECT timestamp, first_seen, source FROM device_neighbors").get() as Record<string, string>;
  assert.deepEqual(r, { timestamp: "2026-10-01 03:00:00", first_seen: "2026-10-01 03:00:00", source: "device" });
});

test("testa della sede: se l'apparato sparisce resta NULL (niente cancellazioni a cascata)", () => {
  const db = dbVecchio();
  migrateTopologyPhase1(db);
  db.prepare("INSERT INTO locations (name) VALUES ('Sede A')").run();
  db.prepare("UPDATE locations SET head_device_id = 1 WHERE id = 1").run();
  db.prepare("DELETE FROM network_devices WHERE id = 1").run();
  assert.equal((db.prepare("SELECT head_device_id FROM locations WHERE id = 1").get() as { head_device_id: number | null }).head_device_id, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM locations").get() as { n: number }).n, 1);
});

test("lo schema dei tenant nuovi ha già tutte le colonne (la migrazione non aggiunge niente)", () => {
  const solo = new Database(":memory:");
  solo.exec(TENANT_SCHEMA_SQL);
  assert.deepEqual(migrateTopologyPhase1(solo), []);
});

test("un tenant nuovo si apre e ha le colonne", () => {
  const db = getTenantDb(T);
  for (const c of COLONNE) {
    const [tabella, colonna] = c.split(".");
    assert.ok(colonne(db, tabella).includes(colonna), `${c} manca nello schema dei tenant nuovi`);
  }
});

// getTenantDb ricostruisce network_devices (CHECK device_type senza
// 'access_point') copiando solo le colonne che conosce: se la migrazione della
// topologia girasse prima di quel rebuild, le colonne nuove sparirebbero (e con
// loro l'indice) fino all'apertura successiva. Qui un tenant «vecchio» su file.
test("un tenant vecchio che passa dal rebuild di network_devices tiene le colonne e l'indice", () => {
  const dir = path.join(resolveDataDir(), "tenants");
  fs.mkdirSync(dir, { recursive: true });
  const file = new Database(path.join(dir, `${T_VECCHIO}.db`));
  file.exec(`CREATE TABLE network_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor')),
    vendor TEXT NOT NULL, vendor_subtype TEXT, protocol TEXT NOT NULL,
    credential_id INTEGER, snmp_credential_id INTEGER, username TEXT, encrypted_password TEXT,
    community_string TEXT, api_token TEXT, api_url TEXT, port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1,
    classification TEXT, sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT,
    part_number TEXT, last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
    last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT, scan_target TEXT, product_profile TEXT,
    use_for_arp_poll INTEGER NOT NULL DEFAULT 0, host_id INTEGER, physical_device_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  file.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api')").run();
  file.close();

  const db = getTenantDb(T_VECCHIO);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='network_devices'").get() as { sql: string }).sql;
  assert.ok(sql.includes("'access_point'"), "il rebuild di network_devices non è avvenuto: la prova non prova niente");
  for (const c of COLONNE.filter((x) => x.startsWith("network_devices."))) {
    assert.ok(colonne(db, "network_devices").includes(c.split(".")[1]), `${c} persa nel rebuild`);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_network_devices_location'").get());
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n, 1);
});
