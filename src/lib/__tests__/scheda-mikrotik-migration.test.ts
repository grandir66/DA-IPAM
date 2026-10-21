// Migrazione «scheda MikroTik» (piano 2026-10-21, Task 3): cinque colonne nuove su tabelle che esistono già
// (device_interfaces.mtu/disabled, arp_entries.status/dynamic, device_neighbors.remote_version). Additiva, idempotente, in
// UNA transazione; il segno `scheda_mikrotik_v21` dice fin dove è arrivato lo schema (`done:<data>:v1`).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { contaBridgeMikrotik, deleteTenantDatabase, getTenantDb, leggiSchedaMikrotik, livelloSchemaSchedaMk, migrateSchedaMikrotik, chiudiMigrazioneSchedaMkFallita, rileggiSchemaSchedaMk, scriviSchedaMikrotikTopologia, upsertArpEntries as upsertArpTenant, upsertNeighbors, withTenant } from "@/lib/db-tenant";
import { upsertArpEntries as upsertArpFacciata } from "@/lib/db";
import { aggiornaInterfacceRouterOs, createPhysicalDevice, upsertDeviceInterface } from "@/lib/devices/physical-device-db";
import { parseInterfacce } from "@/lib/devices/mikrotik-stp";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { parseMikrotikArp } from "@/lib/devices/router-client";
import fs from "node:fs";
import path from "node:path";
import { COLONNE_SCHEDA_MK_V1, DDL_SCHEDA_MK_V2, SEGNO_SCHEDA_MK, TENANT_SCHEMA_SQL, VERSIONE_SCHEDA_MK } from "@/lib/db-tenant-schema";
import { parseBondScheda, parseBridgeScheda, parsePorteBridgeScheda } from "@/lib/devices/mikrotik-scheda";
import { leggiSegno } from "@/lib/credentials/segni-t2";

const T = "TESTSCHEDAMKMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const colonne = (db: Database.Database, t: string): string[] =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

const tabella = (db: Database.Database, n: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);

/** Un tenant com'era prima: lo schema attuale senza le cinque colonne (le crea solo la migrazione). */
function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(TENANT_SCHEMA_SQL);
  for (const [t, c] of COLONNE_SCHEDA_MK_V1) assert.equal(colonne(db, t).includes(c), false, `${t}.${c} non deve esserci prima`);
  return db;
}

test("aggiunge le cinque colonne e le tre tabelle; la seconda volta niente; le righe di prima restano", () => {
  const db = vecchio();
  db.exec(`INSERT INTO arp_entries (device_id, mac, ip, interface_name) VALUES (1, 'AA:BB:CC:DD:EE:01', '10.0.0.1', 'ether1')`);
  const sel = "SELECT id, device_id, host_id, mac, ip, interface_name FROM arp_entries";
  const prima = db.prepare(sel).all();
  assert.deepEqual([...migrateSchedaMikrotik(db)].sort(), [
    "arp_entries.dynamic", "arp_entries.status", "device_interfaces.disabled", "device_interfaces.mtu", "device_neighbors.remote_version",
    "mikrotik_bond", "mikrotik_bridge", "mikrotik_bridge_port",
  ]);
  assert.deepEqual(migrateSchedaMikrotik(db), [], "seconda chiamata: niente");
  assert.equal(livelloSchemaSchedaMk(db), VERSIONE_SCHEDA_MK);
  assert.deepEqual(db.prepare(sel).all(), prima);
  const segno = db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_SCHEDA_MK);
  assert.match((segno as { value: string }).value, /^done:\d{4}-\d{2}-\d{2}:v2$/);
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

test("all'apertura del tenant: colonne e tabelle presenti, segno done:…:v2, riaprendo niente cambia", () => {
  const d = getTenantDb(T);
  for (const [t, c] of COLONNE_SCHEDA_MK_V1) assert.ok(colonne(d, t).includes(c), `${t}.${c}`);
  for (const [n] of DDL_SCHEDA_MK_V2) assert.ok(tabella(d, n), n);
  assert.match(String(leggiSegno(d, SEGNO_SCHEDA_MK)), /^done:\d{4}-\d{2}-\d{2}:v2$/);
  assert.equal(livelloSchemaSchedaMk(d), 2);
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

test("alias di RouterOS: autorevole. Il commento tolto sparisce, e un vecchio «ether» (tipo scritto in alias da prima) non resta", () => {
  const d = getTenantDb(T);
  withTenant(T, () => {
    const pd = createPhysicalDevice({ vendor: "mikrotik", identity_confidence: 1, identity_anchor: "alias" });
    const alias = () => (d.prepare("SELECT alias FROM device_interfaces WHERE physical_device_id = ? AND ifname = 'ether1'").get(pd.id) as { alias: string | null }).alias;
    upsertDeviceInterface(pd.id, { ifname: "ether1", alias: "ether" }); // come lo scriveva il probe di prima
    aggiornaInterfacceRouterOs(pd.id, parseInterfacce(" 0 R name=ether1 type=ether mtu=1500 mac-address=02:00:A0:10:07:01"));
    assert.equal(alias(), null, "RouterOS senza commento: alias NULL");
    aggiornaInterfacceRouterOs(pd.id, parseInterfacce(" 0 R comment=verso il core name=ether1 type=ether mtu=1500"));
    assert.equal(alias(), "verso il core");
    aggiornaInterfacceRouterOs(pd.id, parseInterfacce(" 0 R name=ether1 type=ether mtu=1500"));
    assert.equal(alias(), null, "commento tolto sul router: sparisce");
    // SNMP (non autorevole) senza alias non cancella
    upsertDeviceInterface(pd.id, { ifname: "ether1", alias: "uplink" });
    upsertDeviceInterface(pd.id, { ifname: "ether1", status: "up" });
    assert.equal(alias(), "uplink");
  });
});

test("aggiornaInterfacceRouterOs è una transazione sola: se una riga fallisce non resta niente a metà", () => {
  const d = getTenantDb(T);
  withTenant(T, () => {
    const pd = createPhysicalDevice({ vendor: "mikrotik", identity_confidence: 1, identity_anchor: "tx" });
    const righe = parseInterfacce(" 0 R name=a1 type=ether mtu=1500\n 1 R name=a2 type=ether mtu=1500");
    righe[1] = { ...righe[1], nome: null as unknown as string }; // ifname NOT NULL: la seconda riga lancia
    assert.throws(() => aggiornaInterfacceRouterOs(pd.id, righe));
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM device_interfaces WHERE physical_device_id = ?").get(pd.id) as { n: number }).n, 0);
  });
});

test("migrazione fallita ma schema completo (un altro processo ha vinto la corsa): il segno resta done, non errore", () => {
  const completo = new Database(":memory:");
  completo.exec(TENANT_SCHEMA_SQL);
  migrateSchedaMikrotik(completo);
  completo.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_SCHEDA_MK);
  chiudiMigrazioneSchedaMkFallita(completo, "X", new Error("duplicate column name: mtu"));
  assert.match(String(leggiSegno(completo, SEGNO_SCHEDA_MK)), /^done:.*:v2$/);
  const incompleto = vecchio();
  chiudiMigrazioneSchedaMkFallita(incompleto, "X", new Error("disco pieno"));
  assert.match(String(leggiSegno(incompleto, SEGNO_SCHEDA_MK)), /^errore:disco pieno/);
});

// ── Task 8: livello 2, le tabelle di bridge, porte e bond ──────────────────

/** Un tenant al livello 1 (dopo il rilascio del Task 3): le cinque colonne, il segno v1, niente tabelle della scheda. */
function livello1(): Database.Database {
  const db = vecchio();
  for (const [t, c, ddl] of COLONNE_SCHEDA_MK_V1) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`);
  db.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, 'done:2026-10-21:v1')").run(SEGNO_SCHEDA_MK);
  for (const [n] of DDL_SCHEDA_MK_V2) assert.equal(tabella(db, n), false, `${n} non deve esserci prima`);
  return db;
}

test("v2 su un DB al livello 1: tre tabelle, segno v2, seconda volta niente, integrità ok", () => {
  const db = livello1();
  assert.equal(livelloSchemaSchedaMk(db), 1);
  assert.deepEqual([...migrateSchedaMikrotik(db)].sort(), ["mikrotik_bond", "mikrotik_bridge", "mikrotik_bridge_port"]);
  assert.equal(livelloSchemaSchedaMk(db), 2);
  assert.match(String(leggiSegno(db, SEGNO_SCHEDA_MK)), /^done:\d{4}-\d{2}-\d{2}:v2$/);
  assert.deepEqual(migrateSchedaMikrotik(db), []);
  assert.deepEqual(colonne(db, "mikrotik_bridge_port").slice(0, 3), ["device_id", "interface", "bridge"]);
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("v2 in transazione: se una tabella non si crea, niente a metà e il segno resta v1", () => {
  const db = livello1();
  // Una vista col nome della terza tabella: la sua CREATE TABLE fallisce dopo le prime due.
  db.exec("CREATE VIEW mikrotik_bond AS SELECT 1 AS x");
  assert.throws(() => migrateSchedaMikrotik(db));
  assert.equal(tabella(db, "mikrotik_bridge"), false);
  assert.equal(tabella(db, "mikrotik_bridge_port"), false);
  assert.equal(String(leggiSegno(db, SEGNO_SCHEDA_MK)), "done:2026-10-21:v1");
  assert.equal(livelloSchemaSchedaMk(db), 1, "le colonne del livello 1 restano scrivibili");
  chiudiMigrazioneSchedaMkFallita(db, "X", new Error("table mikrotik_bond already exists"));
  assert.match(String(leggiSegno(db, SEGNO_SCHEDA_MK)), /^errore:/);
});

const nDi = (d: Database.Database, t: string, id: number): number => (d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ?`).get(id) as { n: number }).n;

test("scriviSchedaMikrotikTopologia: fotografia sostituita per apparato; una parte null resta com'era; altri apparati intatti", () => {
  const d = getTenantDb(T);
  d.exec("INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (93, 'RTR-93', '192.0.2.93', 'router', 'mikrotik', 'ssh', 1), (94, 'RTR-94', '192.0.2.94', 'router', 'mikrotik', 'ssh', 1)");
  const t1 = new Date(Date.UTC(2026, 9, 21, 8, 0));
  const t2 = new Date(Date.UTC(2026, 9, 21, 9, 0));
  const tutto = { bridge: parseBridgeScheda(F("mikrotik-mk3-frontiera.txt")), porte: parsePorteBridgeScheda(F("mikrotik-mk4-testa.txt")), bond: parseBondScheda(F("mikrotik-mk8a-testa.txt")) };
  assert.deepEqual(withTenant(T, () => scriviSchedaMikrotikTopologia(93, tutto, t1)), { bridge: 2, porte: 10, bond: 3 });
  withTenant(T, () => scriviSchedaMikrotikTopologia(94, tutto, t1));
  const bond1 = d.prepare("SELECT slaves, transmit_hash_policy, mlag_id, running, disabled, seen_at FROM mikrotik_bond WHERE device_id = 93 AND name = 'bond1'").get();
  assert.deepEqual(bond1, { slaves: "sfp28-2,sfp28-1", transmit_hash_policy: "layer-3-and-4", mlag_id: null, running: 1, disabled: 0, seen_at: "2026-10-21 08:00:00" });
  const br = d.prepare("SELECT vlan_filtering, ether_type, pvid FROM mikrotik_bridge WHERE device_id = 93 ORDER BY name").all();
  assert.deepEqual(br, [{ vlan_filtering: 1, ether_type: "0x8100", pvid: 1 }, { vlan_filtering: 0, ether_type: null, pvid: null }]);
  assert.equal((d.prepare("SELECT inactive FROM mikrotik_bridge_port WHERE device_id = 93 AND interface = 'sfp-sfpplus5'").get() as { inactive: number }).inactive, 1);

  // Seconda lettura: un bridge solo, porte non lette (null), nessun bond (letto e vuoto).
  const r = withTenant(T, () => scriviSchedaMikrotikTopologia(93, { bridge: parseBridgeScheda(F("mikrotik-mk3-testa.txt")), porte: null, bond: [] }, t2));
  assert.deepEqual(r, { bridge: 1, porte: 0, bond: 0 });
  assert.deepEqual(d.prepare("SELECT name, seen_at FROM mikrotik_bridge WHERE device_id = 93").all(), [{ name: "BR_RP", seen_at: "2026-10-21 09:00:00" }]);
  assert.equal(nDi(d, "mikrotik_bridge_port", 93), 10, "porte non lette: restano quelle dell'ultima lettura buona");
  assert.equal((d.prepare("SELECT DISTINCT seen_at AS s FROM mikrotik_bridge_port WHERE device_id = 93").get() as { s: string }).s, "2026-10-21 08:00:00");
  assert.equal(nDi(d, "mikrotik_bond", 93), 0, "letto e vuoto: nessun bond");
  assert.deepEqual([nDi(d, "mikrotik_bridge", 94), nDi(d, "mikrotik_bridge_port", 94), nDi(d, "mikrotik_bond", 94)], [2, 10, 3], "l'altro apparato non si tocca");
});

test("scriviSchedaMikrotikTopologia: una riga che fallisce non lascia niente a metà (una transazione per le tre tabelle)", () => {
  const d = getTenantDb(T);
  d.exec("INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (95, 'RTR-95', '192.0.2.95', 'router', 'mikrotik', 'ssh', 1)");
  withTenant(T, () => scriviSchedaMikrotikTopologia(95, { bridge: parseBridgeScheda(F("mikrotik-mk3-testa.txt")), porte: null, bond: parseBondScheda(F("mikrotik-mk8a-testa.txt")) }));
  const storta = parseBondScheda(F("mikrotik-mk8a-frontiera.txt"));
  storta[0] = { ...storta[0], name: null as unknown as string }; // name NOT NULL: lancia dopo il bridge già riscritto
  assert.throws(() => withTenant(T, () => scriviSchedaMikrotikTopologia(95, { bridge: [], porte: null, bond: storta })));
  assert.deepEqual([nDi(d, "mikrotik_bridge", 95), nDi(d, "mikrotik_bond", 95)], [1, 3], "ROLLBACK: la fotografia di prima");
});

test("scriviSchedaMikrotikTopologia: schema sotto il livello 2 → null, niente scritto", () => {
  const d = getTenantDb(T);
  d.exec("ALTER TABLE mikrotik_bond RENAME TO mikrotik_bond_via");
  const avvisi = mock.method(console, "warn", () => {});
  try {
    assert.equal(withTenant(T, () => rileggiSchemaSchedaMk()), 1);
    assert.equal(withTenant(T, () => scriviSchedaMikrotikTopologia(93, { bridge: [], porte: null, bond: null })), null);
    assert.equal(withTenant(T, () => scriviSchedaMikrotikTopologia(93, { bridge: [], porte: null, bond: null })), null);
    assert.equal(avvisi.mock.callCount(), 1, "un avviso per connessione, non a ogni scrittura");
    assert.match(String(avvisi.mock.calls[0].arguments[0]), /livello 1/);
  } finally {
    avvisi.mock.restore();
    d.exec("ALTER TABLE mikrotik_bond_via RENAME TO mikrotik_bond");
    assert.equal(withTenant(T, () => rileggiSchemaSchedaMk()), 2);
  }
});

// ── Task 9: lettura per la scheda, conteggio dei bridge, rilievi della revisione del Task 8 ──────────────

test("livello sotto il bersaglio: resta annotato (niente sei query di schema a ogni chiamata), si rimisura solo a richiesta", () => {
  const db = livello1();
  assert.equal(livelloSchemaSchedaMk(db), 1);
  for (const [, ddl] of DDL_SCHEDA_MK_V2) db.exec(ddl); // le tabelle arrivano alle sue spalle (un altro processo, un ripristino)
  assert.equal(livelloSchemaSchedaMk(db), 1, "il livello annotato non si rimisura da solo");
});

test("scriviSchedaMikrotikTopologia: due righe con la stessa chiave → un avviso coi numeri, senza nomi", () => {
  const d = getTenantDb(T);
  d.exec("INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (96, 'RTR-96', '192.0.2.96', 'router', 'mikrotik', 'ssh', 1)");
  const porte = parsePorteBridgeScheda(F("mikrotik-mk4-testa.txt"));
  const avvisi = mock.method(console, "warn", () => {});
  try {
    const r = withTenant(T, () => scriviSchedaMikrotikTopologia(96, { bridge: null, porte: [...porte, porte[0]], bond: null }));
    assert.equal(r?.porte, porte.length, "scritte = righe distinte");
    assert.equal(avvisi.mock.callCount(), 1);
    const testo = avvisi.mock.calls[0].arguments.map(String).join(" ");
    assert.match(testo, new RegExp(`mikrotik_bridge_port.*${porte.length + 1}.*${porte.length}`));
    assert.doesNotMatch(testo, new RegExp(porte[0].interface), "nessun nome nel log");
    avvisi.mock.resetCalls();
    withTenant(T, () => scriviSchedaMikrotikTopologia(96, { bridge: null, porte, bond: null }));
    assert.equal(avvisi.mock.callCount(), 0, "senza doppioni nessun avviso");
  } finally {
    avvisi.mock.restore();
  }
});

test("leggiSchedaMikrotik: fotografia con ruolo STP dall'ultima lettura della topologia; apparato senza righe → vuoto", () => {
  const d = getTenantDb(T);
  d.exec("INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (97, 'RTR-97', '192.0.2.97', 'router', 'mikrotik', 'ssh', 1), (98, 'RTR-98', '192.0.2.98', 'router', 'mikrotik', 'ssh', 1)");
  withTenant(T, () => scriviSchedaMikrotikTopologia(97, {
    bridge: parseBridgeScheda(F("mikrotik-mk3-frontiera.txt")), porte: parsePorteBridgeScheda(F("mikrotik-mk4-testa.txt")), bond: parseBondScheda(F("mikrotik-mk8a-testa.txt")),
  }, new Date(Date.UTC(2026, 9, 21, 8, 0))));
  // Due letture della topologia: vale solo l'ultima (la vecchia diceva «alternate» per sfp-sfpplus1).
  const ins = d.prepare("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, stp_role, stp_state, seen_at) VALUES (97, ?, ?, ?, ?, ?, ?)");
  ins.run("device", "n:sfp-sfpplus1", "sfp-sfpplus1", "root", "forwarding", "2026-10-21 08:00:00");
  ins.run("device", "n:sfp-sfpplus2", "sfp-sfpplus2", "alternate", "discarding", "2026-10-21 07:00:00");
  ins.run("snmp", "n:sfp-sfpplus3", "sfp-sfpplus3", "designated", "forwarding", "2026-10-21 08:00:00");

  const s = withTenant(T, () => leggiSchedaMikrotik(97));
  assert.deepEqual([s.bridge.length, s.porte.length, s.bond.length], [2, 10, 3]);
  assert.equal(s.letto_il, "2026-10-21 08:00:00");
  const p1 = s.porte.find((p) => p.interface === "sfp-sfpplus1");
  assert.deepEqual([p1?.stp_ruolo, p1?.stp_stato, p1?.pvid, p1?.hw, p1?.inactive], ["root", "forwarding", 214, true, false]);
  assert.deepEqual([s.porte.find((p) => p.interface === "sfp-sfpplus2")?.stp_ruolo, s.porte.find((p) => p.interface === "sfp-sfpplus3")?.stp_ruolo], [null, null], "lettura vecchia e altra fonte: niente");
  assert.equal(s.porte.find((p) => p.interface === "sfp-sfpplus5")?.inactive, true);
  const b1 = s.bond.find((b) => b.name === "bond1");
  assert.deepEqual([b1?.slaves, b1?.running, b1?.mlag_id], [["sfp28-2", "sfp28-1"], true, null], "liste e boolean riletti");
  assert.deepEqual(s.bridge.map((b) => [b.vlan_filtering, b.disabled]).sort(), [[false, false], [true, false]]);
  assert.deepEqual([s.vlanBridge, s.vlan, s.dns], [null, null, null], "fino al Task 10");

  assert.deepEqual(withTenant(T, () => leggiSchedaMikrotik(98)), { bridge: [], porte: [], bond: [], letto_il: null, vlanBridge: null, vlan: null, dns: null });
});

test("contaBridgeMikrotik: una COUNT dell'ultima fotografia; zero bridge → 0; schema sotto il livello 2 → null", () => {
  assert.deepEqual(withTenant(T, () => contaBridgeMikrotik(97)), { bridge: 2, letto_il: "2026-10-21 08:00:00" });
  assert.deepEqual(withTenant(T, () => contaBridgeMikrotik(98)), { bridge: 0, letto_il: null });
  const d = getTenantDb(T);
  d.exec("ALTER TABLE mikrotik_bond RENAME TO mikrotik_bond_via");
  try {
    assert.equal(withTenant(T, () => rileggiSchemaSchedaMk()), 1);
    assert.equal(withTenant(T, () => contaBridgeMikrotik(97)), null);
    assert.deepEqual(withTenant(T, () => leggiSchedaMikrotik(97)), { bridge: [], porte: [], bond: [], letto_il: null, vlanBridge: null, vlan: null, dns: null });
  } finally {
    d.exec("ALTER TABLE mikrotik_bond_via RENAME TO mikrotik_bond");
    assert.equal(withTenant(T, () => rileggiSchemaSchedaMk()), 2);
  }
});
