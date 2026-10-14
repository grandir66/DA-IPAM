// Migrazione «orientamento della mappa» (spec 2026-10-12-topology-map-design §12.2,
// piano 2026-10-14-topologia-verticale-stampa, Task 1): `topology_maps.orientation`
// (`'lr'` verticale, predefinito anche per le mappe già salvate; `'tb'` orizzontale)
// e `topology_position.orientation` (l'orientamento in cui è stato fatto un ritocco;
// NULL = `tb`, le righe di oggi). Solo cose nuove, idempotente, righe esistenti
// intatte. Il DB «vecchio» riproduce le due tabelle come sono alla v0.3.280.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateTopologyOrientation } from "@/lib/db-tenant";

const T = "TESTTOPOORIENTMIG";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE topology_position (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      view TEXT NOT NULL DEFAULT 'default',
      node_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 1,
      structure_sig TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(view, node_id)
    );
    CREATE TABLE topology_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('auto', 'passo')),
      roots TEXT NOT NULL DEFAULT '[]',
      head_node TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_topology_maps_auto ON topology_maps(kind) WHERE kind = 'auto';
    INSERT INTO topology_maps (id, name, kind, roots, head_node, created_by, created_at, updated_at)
      VALUES (1, 'Tutta la rete', 'auto', '[]', 'dev:4', 'admin', '2026-10-13 09:00:00', '2026-10-13 09:00:00'),
             (2, 'Sede A', 'passo', '["dev:4"]', NULL, 'admin', '2026-10-13 10:00:00', '2026-10-13 10:00:00');
    INSERT INTO topology_position (view, node_id, x, y, pinned, structure_sig, updated_at)
      VALUES ('auto', 'dev:4', 120, 40, 1, 'sig-a', '2026-10-13 11:00:00'),
             ('mappa:2', 'dev:4', 0, 0, 0, NULL, '2026-10-13 11:00:00'),
             ('mappa:2', 'dev:5', 300, 88, 1, 'sig-b', '2026-10-13 11:00:00');
  `);
  return db;
}

type Col = { name: string; type: string; notnull: number; dflt_value: string | null };
function colonna(db: Database.Database, tabella: string, nome: string): [string, string, number, string | null] | undefined {
  const c = (db.prepare(`PRAGMA table_info(${tabella})`).all() as Col[]).find((x) => x.name === nome);
  return c ? [c.name, c.type, c.notnull, c.dflt_value] : undefined;
}

test("aggiunge l'orientamento alle mappe e ai ritocchi; la seconda volta niente", () => {
  const db = vecchio();
  assert.deepEqual([...migrateTopologyOrientation(db)].sort(), ["topology_maps.orientation", "topology_position.orientation"]);
  assert.deepEqual(colonna(db, "topology_maps", "orientation"), ["orientation", "TEXT", 1, "'lr'"]);
  assert.deepEqual(colonna(db, "topology_position", "orientation"), ["orientation", "TEXT", 0, null]);
  assert.match(
    String((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'topology_maps'").get() as { sql: string }).sql),
    /orientation TEXT NOT NULL DEFAULT 'lr' CHECK\(orientation IN \('lr','tb'\)\)/,
  );

  // Seconda apertura: niente da fare, niente cambiato.
  const schemaPrima = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
  assert.deepEqual(migrateTopologyOrientation(db), []);
  assert.deepEqual(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all(), schemaPrima);
});

test("le mappe già salvate diventano verticali ('lr'); i ritocchi di oggi restano NULL (= 'tb'); il resto intatto", () => {
  const db = vecchio();
  const mappePrima = db.prepare("SELECT * FROM topology_maps ORDER BY id").all() as Array<Record<string, unknown>>;
  const posPrima = db.prepare("SELECT * FROM topology_position ORDER BY id").all() as Array<Record<string, unknown>>;
  migrateTopologyOrientation(db);
  assert.deepEqual(db.prepare("SELECT * FROM topology_maps ORDER BY id").all(), mappePrima.map((r) => ({ ...r, orientation: "lr" })));
  assert.deepEqual(db.prepare("SELECT * FROM topology_position ORDER BY id").all(), posPrima.map((r) => ({ ...r, orientation: null })));
});

test("il CHECK rifiuta un orientamento sconosciuto e il NULL sulle mappe; i ritocchi accettano NULL", () => {
  const db = vecchio();
  migrateTopologyOrientation(db);
  assert.throws(() => db.prepare("UPDATE topology_maps SET orientation = 'verticale' WHERE id = 2").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE topology_maps SET orientation = NULL WHERE id = 2").run(), /NOT NULL/);
  db.prepare("UPDATE topology_maps SET orientation = 'tb' WHERE id = 2").run();
  assert.equal((db.prepare("SELECT orientation FROM topology_maps WHERE id = 2").get() as { orientation: string }).orientation, "tb");
  const nuova = db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Nuova', 'passo')").run().lastInsertRowid;
  assert.equal((db.prepare("SELECT orientation FROM topology_maps WHERE id = ?").get(nuova) as { orientation: string }).orientation, "lr");
  db.prepare("INSERT INTO topology_position (view, node_id, x, y, pinned) VALUES ('auto', 'dev:9', 1, 2, 1)").run();
  assert.equal((db.prepare("SELECT orientation FROM topology_position WHERE node_id = 'dev:9'").get() as { orientation: null }).orientation, null);
});

test("se una parte fallisce non resta niente a metà (transazione)", () => {
  const db = new Database(":memory:");
  // Manca topology_position: la prima aggiunta (topology_maps) riesce, la seconda no,
  // e la prima deve sparire con lei.
  db.exec("CREATE TABLE topology_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL)");
  assert.throws(() => migrateTopologyOrientation(db), /no such table|topology_position/);
  assert.equal(colonna(db, "topology_maps", "orientation"), undefined, "orientation rimasta a metà");
});

test("un tenant aperto con getTenantDb ha le due colonne; la migrazione non ha più niente da fare", () => {
  deleteTenantDatabase(T);
  const db = getTenantDb(T);
  assert.deepEqual(colonna(db, "topology_maps", "orientation"), ["orientation", "TEXT", 1, "'lr'"]);
  assert.deepEqual(colonna(db, "topology_position", "orientation"), ["orientation", "TEXT", 0, null]);
  assert.deepEqual(migrateTopologyOrientation(db), []);
});
