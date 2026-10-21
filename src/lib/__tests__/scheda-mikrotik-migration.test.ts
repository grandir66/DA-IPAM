// Migrazione «scheda MikroTik» (piano 2026-10-21, Task 3): cinque colonne nuove su tabelle che esistono già
// (device_interfaces.mtu/disabled, arp_entries.status/dynamic, device_neighbors.remote_version). Additiva, idempotente, in
// UNA transazione; il segno `scheda_mikrotik_v21` dice fin dove è arrivato lo schema (`done:<data>:v1`).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, livelloSchemaSchedaMk, migrateSchedaMikrotik, upsertArpEntries as upsertArpTenant, upsertNeighbors, withTenant } from "@/lib/db-tenant";
import { upsertArpEntries as upsertArpFacciata } from "@/lib/db";
import { aggiornaInterfacceRouterOs, createPhysicalDevice, upsertDeviceInterface } from "@/lib/devices/physical-device-db";
import { parseInterfacce } from "@/lib/devices/mikrotik-stp";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { parseMikrotikArp } from "@/lib/devices/router-client";
import fs from "node:fs";
import path from "node:path";
import { COLONNE_SCHEDA_MK_V1, SEGNO_SCHEDA_MK, TENANT_SCHEMA_SQL, VERSIONE_SCHEDA_MK } from "@/lib/db-tenant-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";

const T = "TESTSCHEDAMKMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const colonne = (db: Database.Database, t: string): string[] =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

/** Un tenant com'era prima: lo schema attuale senza le cinque colonne (le crea solo la migrazione). */
function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(TENANT_SCHEMA_SQL);
  for (const [t, c] of COLONNE_SCHEDA_MK_V1) assert.equal(colonne(db, t).includes(c), false, `${t}.${c} non deve esserci prima`);
  return db;
}

test("aggiunge le cinque colonne; la seconda volta niente; le righe di prima restano", () => {
  const db = vecchio();
  db.exec(`INSERT INTO arp_entries (device_id, mac, ip, interface_name) VALUES (1, 'AA:BB:CC:DD:EE:01', '10.0.0.1', 'ether1')`);
  const sel = "SELECT id, device_id, host_id, mac, ip, interface_name FROM arp_entries";
  const prima = db.prepare(sel).all();
  assert.deepEqual([...migrateSchedaMikrotik(db)].sort(), [
    "arp_entries.dynamic", "arp_entries.status", "device_interfaces.disabled", "device_interfaces.mtu", "device_neighbors.remote_version",
  ]);
  assert.deepEqual(migrateSchedaMikrotik(db), [], "seconda chiamata: niente");
  assert.equal(livelloSchemaSchedaMk(db), VERSIONE_SCHEDA_MK);
  assert.deepEqual(db.prepare(sel).all(), prima);
  const segno = db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_SCHEDA_MK);
  assert.match((segno as { value: string }).value, /^done:\d{4}-\d{2}-\d{2}:v1$/);
  migrateSchedaMikrotik(db);
  assert.deepEqual(db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_SCHEDA_MK), segno, "il segno non si riscrive");
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
});

test("una colonna c'è già: si aggiunge solo ciò che manca", () => {
  const db = vecchio();
  db.exec("ALTER TABLE arp_entries ADD COLUMN status TEXT");
  const aggiunte = migrateSchedaMikrotik(db);
  assert.equal(aggiunte.includes("arp_entries.status"), false);
  assert.equal(aggiunte.includes("arp_entries.dynamic"), true);
});

test("in transazione: se un passo fallisce non resta niente a metà", () => {
  const db = new Database(":memory:");
  // Manca device_neighbors: l'ultimo ALTER fallisce dopo i primi quattro.
  db.exec("CREATE TABLE device_interfaces (id INTEGER PRIMARY KEY); CREATE TABLE arp_entries (id INTEGER PRIMARY KEY)");
  assert.throws(() => migrateSchedaMikrotik(db));
  assert.deepEqual(colonne(db, "device_interfaces"), ["id"]);
  assert.deepEqual(colonne(db, "arp_entries"), ["id"]);
  assert.equal(livelloSchemaSchedaMk(db), 0);
});

test("all'apertura del tenant: colonne presenti, segno done:…:v1, riaprendo niente cambia", () => {
  const d = getTenantDb(T);
  for (const [t, c] of COLONNE_SCHEDA_MK_V1) assert.ok(colonne(d, t).includes(c), `${t}.${c}`);
  assert.match(String(leggiSegno(d, SEGNO_SCHEDA_MK)), /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.equal(livelloSchemaSchedaMk(d), 1);
  assert.deepEqual(migrateSchedaMikrotik(d), []);
});

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "../devices/__tests__/fixtures", n), "utf8");

test("aggiornaInterfacceRouterOs: tipo, MTU, stato, spenta e commento (alias) sulle righe dell'apparato fisico", () => {
  const d = getTenantDb(T);
  withTenant(T, () => {
    const pd = createPhysicalDevice({ vendor: "mikrotik", identity_confidence: 1, identity_anchor: "prova" });
    const righe = parseInterfacce(F("mikrotik-mk2-testa.txt"));
    assert.equal(aggiornaInterfacceRouterOs(pd.id, righe), righe.length);
    const bond = d.prepare("SELECT type, mtu, disabled, status, alias, mac FROM device_interfaces WHERE physical_device_id = ? AND ifname = 'bond1'").get(pd.id);
    assert.deepEqual(bond, { type: "bond", mtu: 1500, disabled: 0, status: "up", alias: "cavo-a", mac: "02:00:a0:10:62:0e" });
    const e1 = d.prepare("SELECT status, disabled FROM device_interfaces WHERE physical_device_id = ? AND ifname = 'ether1'").get(pd.id);
    assert.deepEqual(e1, { status: "down", disabled: 0 });
    // Seconda lettura con una porta spenta a mano: il segno X diventa disabled = 1; una lettura senza MTU (SNMP) non lo cancella.
    aggiornaInterfacceRouterOs(pd.id, parseInterfacce(" 0 X name=ether1 type=ether mtu=1500 mac-address=02:00:A0:10:07:01"));
    assert.deepEqual(d.prepare("SELECT status, disabled, mtu FROM device_interfaces WHERE physical_device_id = ? AND ifname = 'ether1'").get(pd.id), { status: "down", disabled: 1, mtu: 1500 });
    upsertDeviceInterface(pd.id, { ifname: "ether1", status: "down" });
    assert.equal((d.prepare("SELECT mtu FROM device_interfaces WHERE physical_device_id = ? AND ifname = 'ether1'").get(pd.id) as { mtu: number }).mtu, 1500);
  });
});

test("ARP: stato e «dinamica» scritti, dalla facciata e dal modulo del tenant", () => {
  const d = getTenantDb(T);
  d.exec("INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (91, 'RTR-91', '192.0.2.91', 'router', 'mikrotik', 'ssh', 1)");
  const arp = parseMikrotikArp(F("mikrotik-arp-terse.txt"));
  const letti = () => d.prepare("SELECT ip, status, dynamic FROM arp_entries WHERE device_id = 91 ORDER BY id").all() as Array<{ ip: string; status: string | null; dynamic: number | null }>;
  withTenant(T, () => upsertArpFacciata(91, arp));
  assert.equal(letti().length, arp.length);
  assert.deepEqual(letti().slice(0, 3).map((r) => [r.ip, r.status, r.dynamic]),
    [["10.20.1.178", "permanent", 0], ["10.20.2.45", "incomplete", 1], ["10.20.3.130", "reachable", 1]]);
  d.exec("DELETE FROM arp_entries WHERE device_id = 91");
  withTenant(T, () => upsertArpTenant(91, arp));
  assert.deepEqual(letti().slice(0, 1).map((r) => [r.ip, r.status, r.dynamic]), [["10.20.1.178", "permanent", 0]]);
  // SNMP non ha né stato né «dinamica»: null, e la riga si scrive lo stesso.
  withTenant(T, () => upsertArpTenant(91, [{ mac: "02:00:A0:10:00:09", ip: "10.20.9.9", interface_name: "x" }]));
  assert.deepEqual(letti(), [{ ip: "10.20.9.9", status: null, dynamic: null }]);
});

test("vicini: la versione del vicino si scrive a parte; un giro che non la legge non la cancella", () => {
  const d = getTenantDb(T);
  d.exec("INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (92, 'RTR-92', '192.0.2.92', 'router', 'mikrotik', 'ssh', 1)");
  const vicini = parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse.txt"));
  const versione = (nome: string) => d.prepare("SELECT remote_version AS v FROM device_neighbors WHERE device_id = 92 AND remote_device_name = ? LIMIT 1").get(nome) as { v: string | null };
  withTenant(T, () => upsertNeighbors(92, vicini, "ssh"));
  assert.equal(versione("RTR-1").v, "7.21.3 (stable) 2026-03-02 09:15:00");
  assert.equal(versione("SW-ACC-A").v, null);
  withTenant(T, () => upsertNeighbors(92, vicini.map(({ remoteVersion: _v, ...resto }) => resto), "ssh"));
  assert.equal(versione("RTR-1").v, "7.21.3 (stable) 2026-03-02 09:15:00", "senza versione nel giro, quella di prima resta");
});
