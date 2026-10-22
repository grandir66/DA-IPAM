// Migrazione «LibreNMS come fonte di dati» (piano 2026-10-22 LibreNMS, task 2): dieci tabelle `librenms_*` e due indici.
// Additiva, idempotente, in UNA transazione; il segno `librenms_fonte_v21` dice che lo schema c'è (`done:<data>:v1`).
// Provata su un DB nuovo (apertura del tenant) e su un DB fatto con lo schema di oggi più le migrazioni di oggi.
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/migrazione-librenms-fonte.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  chiudiMigrazioneLibrenmsFonteFallita,
  deleteTenantDatabase,
  getTenantDb,
  livelloSchemaLibrenmsDb,
  migrateLibrenmsFonte,
  migrateSchedaMikrotik,
  migrateSwitchVlan,
  migrateSwitchVlanNativa,
  migrateTopologyPhase1,
  migrateTopologyPhase2,
} from "@/lib/db-tenant";
import { DDL_LIBRENMS_FONTE_V1, INDICI_LIBRENMS_FONTE_V1, SEGNO_LIBRENMS_FONTE, TENANT_INDEXES_SQL, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";

const T = "TESTLIBRENMSFONTEMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const TABELLE = DDL_LIBRENMS_FONTE_V1.map(([n]) => n).sort();
const INDICI = INDICI_LIBRENMS_FONTE_V1.map(([n]) => n).sort();
const c = (db: Database.Database, type: string, n: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, n);
const schema = (db: Database.Database): string[] =>
  (db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string; sql: string | null }>)
    .map((r) => `${r.type} ${r.name} ${r.sql ?? ""}`);

/** Un tenant com'è oggi: lo schema e le migrazioni di oggi, senza le tabelle di LibreNMS. */
function diOggi(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  migrateTopologyPhase1(db);
  migrateTopologyPhase2(db);
  migrateSchedaMikrotik(db);
  migrateSwitchVlan(db);
  migrateSwitchVlanNativa(db);
  for (const n of TABELLE) assert.equal(c(db, "table", n), false, `${n} non deve esserci prima`);
  return db;
}

test("DB di oggi: dieci tabelle, due indici e segno; la seconda volta niente; nient'altro cambia", () => {
  const db = diOggi();
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'rete-a')").run();
  db.prepare("INSERT INTO librenms_host_map (network_id, host_ip, librenms_device_id) VALUES (1, '192.0.2.10', 7)").run();
  const prima = schema(db);
  assert.equal(livelloSchemaLibrenmsDb(db), 0);
  const t0 = performance.now();
  const aggiunte = migrateLibrenmsFonte(db);
  const ms = performance.now() - t0;
  assert.deepEqual([...aggiunte].sort(), [...TABELLE, ...INDICI].sort());
  assert.ok(ms < 50, `migrazione in ${ms.toFixed(1)} ms`);
  assert.equal(livelloSchemaLibrenmsDb(db), 1);
  const segno = db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_LIBRENMS_FONTE) as { value: string };
  assert.match(segno.value, /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.deepEqual(migrateLibrenmsFonte(db), [], "seconda chiamata: niente");
  assert.deepEqual(db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_LIBRENMS_FONTE), segno, "il segno non si riscrive");
  const nuovi = [...TABELLE, ...INDICI];
  const dopo = schema(db).filter((r) => !nuovi.some((n) => r.includes(` ${n} `) || r.includes(`sqlite_autoindex_${n}_`)));
  assert.deepEqual(dopo, prima, "lo schema di prima resta com'era");
  assert.deepEqual(db.prepare("SELECT host_ip, librenms_device_id FROM librenms_host_map").all(), [{ host_ip: "192.0.2.10", librenms_device_id: 7 }]);
  // Nessuna chiave esterna (spec §4.4): un apparato di LibreNMS senza host di DA-IPAM si scrive.
  for (const n of TABELLE) assert.deepEqual(db.prepare(`PRAGMA foreign_key_list(${n})`).all(), [], `${n} senza FK`);
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
});

test("un oggetto con lo stesso nome c'è già: niente a metà, livello 0, segno errore; il resto del tenant è intatto", () => {
  const db = diOggi();
  db.exec("CREATE VIEW librenms_sensore AS SELECT 1 AS x");
  assert.throws(() => migrateLibrenmsFonte(db));
  for (const n of ["librenms_apparato", "librenms_porta", "librenms_vicino"]) assert.equal(c(db, "table", n), false, `${n} non resta a metà`);
  assert.equal(leggiSegno(db, SEGNO_LIBRENMS_FONTE), null);
  chiudiMigrazioneLibrenmsFonteFallita(db, "X", new Error("table librenms_sensore already exists"));
  assert.match(String(leggiSegno(db, SEGNO_LIBRENMS_FONTE)), /^errore:/);
  assert.equal(livelloSchemaLibrenmsDb(db), 0);
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
});

test("migrazione fallita ma schema completo (un altro processo ha vinto la corsa): segno done, livello 1", () => {
  const db = diOggi();
  migrateLibrenmsFonte(db);
  db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_LIBRENMS_FONTE);
  chiudiMigrazioneLibrenmsFonteFallita(db, "X", new Error("table librenms_apparato already exists"));
  assert.match(String(leggiSegno(db, SEGNO_LIBRENMS_FONTE)), /^done:.*:v1$/);
  assert.equal(livelloSchemaLibrenmsDb(db), 1);
});

test("un indice mancante: si aggiunge solo quello, e senza il livello resta 0", () => {
  const db = diOggi();
  migrateLibrenmsFonte(db);
  db.exec("DROP INDEX idx_librenms_sensore_device");
  const fresco = new Database(db.serialize());
  assert.equal(livelloSchemaLibrenmsDb(fresco), 0, "senza l'indice lo schema non è completo");
  assert.deepEqual(migrateLibrenmsFonte(fresco), ["idx_librenms_sensore_device"]);
  assert.equal(livelloSchemaLibrenmsDb(fresco), 1);
});

test("DB nuovo, all'apertura del tenant: tabelle, segno done:…:v1, riaprendo niente cambia", () => {
  const d = getTenantDb(T);
  for (const n of TABELLE) assert.ok(c(d, "table", n), n);
  for (const n of INDICI) assert.ok(c(d, "index", n), n);
  assert.match(String(leggiSegno(d, SEGNO_LIBRENMS_FONTE)), /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.equal(livelloSchemaLibrenmsDb(d), 1);
  assert.deepEqual(migrateLibrenmsFonte(d), []);
});

test("esportazione e importazione portano le fotografie di LibreNMS (tier history)", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("@/lib/transfer/export");
  const { importTenant } = await import("@/lib/transfer/import");
  const hub = (): Database.Database => {
    const h = new Database(":memory:");
    h.exec(HUB_SCHEMA_SQL);
    return h;
  };
  const src = diOggi();
  migrateLibrenmsFonte(src);
  src.prepare("INSERT INTO librenms_apparato (librenms_device_id, ip, os, letto_il) VALUES (4, '192.0.2.1', 'routeros', '2026-10-22 08:00:00')").run();
  src.prepare("INSERT INTO librenms_sensore (sensor_id, librenms_device_id, classe, valore, letto_il) VALUES (106, 4, 'temperature', 41.5, '2026-10-22 08:00:00')").run();
  src.prepare("INSERT INTO librenms_lettura (parte, esito, righe, letto_il, tentato_il) VALUES ('sensori', 'letto', 1, '2026-10-22 08:00:00', '2026-10-22 08:00:00')").run();
  const opz = { tenantCode: "DEFAULT", includeVault: false, passphrase: "prova-librenms", exportedAt: "2026-10-22T08:00:00.000Z", appVersion: "test" };
  const bundle = exportTenant({ tenantDb: src, hubDb: hub(), options: { ...opz, tiers: ["history"] } });
  const dst = diOggi();
  migrateLibrenmsFonte(dst);
  const res = importTenant({ bundle, tenantDb: dst, hubDb: hub(), options: { tenantCode: "DEFAULT", passphrase: opz.passphrase, wipe: false } });
  assert.equal(res.tables.librenms_apparato, 1);
  assert.equal(res.tables.librenms_sensore, 1);
  assert.equal(res.tables.librenms_lettura, 1);
  assert.deepEqual(dst.prepare("SELECT sensor_id, classe, valore FROM librenms_sensore").all(), [{ sensor_id: 106, classe: "temperature", valore: 41.5 }]);
});
