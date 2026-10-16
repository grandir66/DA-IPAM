// Migrazione «topologia fase 2b» (spec 2026-10-12-topology-map-design §11.3-11.5,
// piano 2026-10-14-topologia-fase2b, Task 2): il tipo di un collegamento a mano
// (`topology_link_overrides.medium`), il collegamento principale scelto a mano
// (`topology_link_primary`) e il tipo di uplink UniFi (`network_devices.uplink_type`).
// Solo cose nuove, idempotente, righe esistenti intatte. Il DB «vecchio» riproduce
// le tabelle come sono alla v0.3.279.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase,
  getTenantDb,
  listTopologyLinkPrimaries,
  migrateTopologyPhase2b,
  withTenant,
} from "@/lib/db-tenant";

const T = "TESTTOPOF2BMIG";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE network_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, uplink_mac TEXT, uplink_remote_port INTEGER, uplink_seen_at TEXT);
    CREATE TABLE topology_link_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK(action IN ('add', 'ignore')),
      a_node TEXT NOT NULL,
      a_port TEXT NOT NULL DEFAULT '',
      b_node TEXT NOT NULL,
      b_port TEXT NOT NULL DEFAULT '',
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO network_devices (id, name, uplink_mac) VALUES (1, 'AP-1', '02:00:00:00:00:01'), (2, 'SW-1', NULL);
    INSERT INTO topology_link_overrides (action, a_node, a_port, b_node, b_port, note, created_by, created_at)
      VALUES ('add', 'dev:2', 'Port 3', 'dev:1', '', 'a mano', 'admin', '2026-10-13 10:00:00'),
             ('ignore', 'dev:2', '', 'host:7', '', NULL, 'admin', '2026-10-13 11:00:00');
  `);
  return db;
}

function colonne(db: Database.Database, tabella: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).map((c) => c.name);
}

test("aggiunge tipo del collegamento, tabella del principale e tipo di uplink; la seconda volta niente", () => {
  const db = vecchio();
  const aggiunte = migrateTopologyPhase2b(db);
  assert.deepEqual(
    [...aggiunte].sort(),
    ["network_devices.uplink_type", "topology_link_overrides.medium", "topology_link_primary"].sort(),
  );
  assert.ok(colonne(db, "topology_link_overrides").includes("medium"));
  assert.ok(colonne(db, "network_devices").includes("uplink_type"));
  assert.deepEqual(
    (db.prepare("PRAGMA table_info(topology_link_primary)").all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>).map(
      (c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk],
    ),
    [
      ["node_id", "TEXT", 0, null, 1],
      ["other_node", "TEXT", 1, null, 0],
      ["node_port", "TEXT", 1, "''", 0],
      ["other_port", "TEXT", 1, "''", 0],
      ["set_by", "TEXT", 0, null, 0],
      ["set_at", "TEXT", 1, "datetime('now')", 0],
    ],
  );

  // Seconda apertura: niente da fare, niente cambiato.
  const schemaPrima = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
  assert.deepEqual(migrateTopologyPhase2b(db), []);
  assert.deepEqual(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all(), schemaPrima);
});

test("le righe esistenti di topology_link_overrides restano com'erano, con medium NULL", () => {
  const db = vecchio();
  const prima = db.prepare("SELECT * FROM topology_link_overrides ORDER BY id").all() as Array<Record<string, unknown>>;
  migrateTopologyPhase2b(db);
  const dopo = db.prepare("SELECT * FROM topology_link_overrides ORDER BY id").all() as Array<Record<string, unknown>>;
  assert.deepEqual(dopo, prima.map((r) => ({ ...r, medium: null })));
  // Gli apparati tengono il loro uplink; il tipo nasce vuoto.
  assert.deepEqual(db.prepare("SELECT id, uplink_mac, uplink_type FROM network_devices ORDER BY id").all(), [
    { id: 1, uplink_mac: "02:00:00:00:00:01", uplink_type: null },
    { id: 2, uplink_mac: null, uplink_type: null },
  ]);
});

test("topology_link_primary: un principale per oggetto, porte vuote di default, data scritta da sola", () => {
  const db = vecchio();
  migrateTopologyPhase2b(db);
  db.prepare("INSERT INTO topology_link_primary (node_id, other_node) VALUES ('dev:1', 'dev:2')").run();
  const riga = db.prepare("SELECT * FROM topology_link_primary").get() as Record<string, unknown>;
  assert.equal(riga.node_port, "");
  assert.equal(riga.other_port, "");
  assert.match(String(riga.set_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.throws(() => db.prepare("INSERT INTO topology_link_primary (node_id, other_node) VALUES ('dev:1', 'dev:3')").run(), /UNIQUE|PRIMARY/);
  assert.throws(() => db.prepare("INSERT INTO topology_link_primary (node_id, other_node) VALUES ('dev:4', NULL)").run(), /NOT NULL/);
});

test("se una parte fallisce non resta niente a metà (transazione)", () => {
  const db = new Database(":memory:");
  // Manca network_devices: la prima aggiunta (medium) riesce, la seconda no, e
  // la prima deve sparire con lei.
  db.exec("CREATE TABLE topology_link_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, a_node TEXT NOT NULL, b_node TEXT NOT NULL)");
  assert.throws(() => migrateTopologyPhase2b(db), /no such table|network_devices/);
  assert.ok(!colonne(db, "topology_link_overrides").includes("medium"), "medium rimasto a metà");
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'topology_link_primary'").get(), undefined);
});

test("un tenant aperto con getTenantDb ha le colonne e la tabella; listTopologyLinkPrimaries le legge", () => {
  deleteTenantDatabase(T);
  const db = getTenantDb(T);
  assert.ok(colonne(db, "topology_link_overrides").includes("medium"));
  assert.ok(colonne(db, "network_devices").includes("uplink_type"));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'topology_link_primary'").get());
  assert.deepEqual(migrateTopologyPhase2b(db), []);

  assert.deepEqual(withTenant(T, () => listTopologyLinkPrimaries()), []);
  db.prepare(
    "INSERT INTO topology_link_primary (node_id, other_node, node_port, other_port, set_by) VALUES ('dev:9', 'dev:3', 'eno1', 'Port 17', 'admin'), ('dev:4', 'dev:3', '', 'Port 2', NULL)",
  ).run();
  assert.deepEqual(withTenant(T, () => listTopologyLinkPrimaries()), [
    { node_id: "dev:4", other_node: "dev:3", node_port: "", other_port: "Port 2" },
    { node_id: "dev:9", other_node: "dev:3", node_port: "eno1", other_port: "Port 17" },
  ]);
});
