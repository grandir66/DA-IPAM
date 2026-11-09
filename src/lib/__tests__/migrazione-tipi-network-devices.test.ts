/**
 * Tipi e marche nuovi in `network_devices` (Riccardo, 09/11/2026): stampante, UPS, VoIP, telecamera e IoT ripiegavano su
 * `switch` (e il giro ne leggeva porte e MAC), FortiGate & c. finivano `other`. Zona gialla: si ricostruisce la tabella
 * degli apparati nei DB dei clienti, perché un CHECK di SQLite non si altera, e da `network_devices` dipendono porte,
 * MAC, binding delle credenziali e altro (chiavi esterne con ON DELETE CASCADE).
 *
 * Si parte dallo schema di PRIMA, scritto qui a mano e congelato com'è sui tenant di oggi (0.9.1034), con le due colonne
 * che arrivano per ALTER (`host_id`, `campi_da_rivedere`), una figlia con CASCADE, un indice e una vista. Il percorso è
 * quello vero: `migraCredenzialiWmi`, che chiamano `getTenantDb` e il path legacy di `getDb`.
 *
 * Run: node --import tsx --test src/lib/__tests__/migrazione-tipi-network-devices.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { definizioneNetworkDevicesTipiNuovi, migraCheckNetworkDevices, migraCredenzialiWmi } from "@/lib/db-tenant-schema";

void TEST_DATA_DIR;

const TIPI_PRIMA = "'router', 'switch', 'firewall', 'hypervisor', 'access_point', 'nas', 'server'";
const MARCHE_PRIMA = "'mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other', 'apple'";

/** `network_devices` come sui tenant di oggi (CREATE base + le due colonne per ALTER), col CHECK che si passa. */
function tenantPrima(tipi = TIPI_PRIMA, marche = MARCHE_PRIMA): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT);
    CREATE TABLE credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE network_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK(device_type IN (${tipi})),
      vendor TEXT NOT NULL CHECK(vendor IN (${marche})),
      vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
      protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
      credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      classification TEXT,
      product_profile TEXT,
      scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux', 'macos')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL;
    ALTER TABLE network_devices ADD COLUMN campi_da_rivedere TEXT;
    CREATE INDEX idx_network_devices_host ON network_devices(host);
    CREATE TABLE switch_ports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      port_index INTEGER
    );
    CREATE VIEW v_apparati AS SELECT id, name FROM network_devices;
    INSERT INTO hosts (id, ip) VALUES (1, '10.0.0.10');
    INSERT INTO credentials (id, name) VALUES (1, 'snmp ro');
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, credential_id, classification, product_profile, host_id, campi_da_rivedere)
      VALUES (3, 'sw-core', '10.0.0.3', 'switch', 'hp', 'snmp_v2', 1, 'switch', 'hp_switch_procurve', 1, 'firmware,model');
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, classification, product_profile)
      VALUES (12, 'ups-sala', '10.0.0.12', 'switch', 'other', 'snmp_v2', 'ups', 'generic_ups');
    INSERT INTO switch_ports (device_id, port_index) VALUES (3, 1), (3, 2), (12, 1);
  `);
  return db;
}

const sqlTabella = (db: Database.Database): string =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'network_devices'").get() as { sql: string }).sql;

describe("migrazione tipi e marche di network_devices", () => {
  after(() => closeHubDb());

  it("dalla CREATE di oggi: accetta ups/stampante/voip/telecamera/iot e le marche firewall, senza perdere righe né figlie", () => {
    const db = tenantPrima();
    // Prima: il CHECK rifiuta (è questo che la migrazione deve cambiare).
    assert.throws(() => db.prepare("UPDATE network_devices SET device_type = 'ups' WHERE id = 12").run(), /CHECK constraint failed/);

    migraCredenzialiWmi(db, "[prova]");

    db.prepare("UPDATE network_devices SET device_type = 'ups' WHERE id = 12").run();
    for (const t of ["stampante", "voip", "telecamera", "iot"]) {
      db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES (?, '10.0.0.99', ?, 'other', 'snmp_v2')").run(t, t);
    }
    for (const v of ["fortinet", "paloalto", "checkpoint", "watchguard", "sonicwall"]) {
      db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES (?, '10.0.1.1', 'firewall', ?, 'snmp_v2')").run(v, v);
    }
    // I valori di prima restano ammessi.
    db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, scan_target) VALUES ('mac', '10.0.2.1', 'server', 'apple', 'ssh', 'macos')").run();
    // Un valore inventato resta rifiutato.
    assert.throws(() => db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('x', 'h', 'tostapane', 'other', 'ssh')").run(), /CHECK constraint failed/);

    // Righe e colonne venute per ALTER intatte, figlie ancora agganciate.
    const sw = db.prepare("SELECT name, host_id, campi_da_rivedere, credential_id FROM network_devices WHERE id = 3").get();
    assert.deepEqual(sw, { name: "sw-core", host_id: 1, campi_da_rivedere: "firmware,model", credential_id: 1 });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM switch_ports").get() as { n: number }).n, 3);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    // La CASCADE punta ancora alla tabella ricostruita.
    db.prepare("DELETE FROM network_devices WHERE id = 3").run();
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM switch_ports").get() as { n: number }).n, 1);

    // Indice e vista ricreati; il contatore AUTOINCREMENT non torna indietro.
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_network_devices_host'").get());
    assert.ok(db.prepare("SELECT 1 FROM v_apparati WHERE id = 12").get());
    const nuovo = db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('n', 'h', 'switch', 'hp', 'ssh')").run();
    assert.ok(Number(nuovo.lastInsertRowid) > 12 + 5 + 4 + 1);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'network_devices__tipi_new'").get());
  });

  it("è ripetibile: la seconda volta non ricostruisce", () => {
    const db = tenantPrima();
    assert.equal(migraCheckNetworkDevices(db), true);
    const dopo = sqlTabella(db);
    assert.equal(migraCheckNetworkDevices(db), false);
    assert.equal(sqlTabella(db), dopo);
  });

  it("un CHECK più vecchio (path legacy) si estende senza perdere i valori che aveva", () => {
    const db = tenantPrima("'router', 'switch', 'firewall', 'hypervisor'", "'mikrotik', 'hp', 'other', 'apple'");
    assert.equal(migraCheckNetworkDevices(db), true);
    const sql = sqlTabella(db);
    for (const v of ["'hypervisor'", "'access_point'", "'ups'", "'iot'", "'apple'", "'sonicwall'", "'qnap'"]) assert.ok(sql.includes(v), v);
  });

  it("una definizione che non si riconosce ferma la ricostruzione e lascia la tabella com'era", () => {
    assert.throws(() => definizioneNetworkDevicesTipiNuovi("CREATE TABLE network_devices (id INTEGER, device_type TEXT)", "x"), /CHECK di device_type non riconosciuto/);
    const db = new Database(":memory:");
    db.exec("CREATE TABLE network_devices (id INTEGER PRIMARY KEY, device_type TEXT, vendor TEXT); INSERT INTO network_devices VALUES (1, 'switch', 'hp');");
    const prima = sqlTabella(db);
    assert.throws(() => migraCheckNetworkDevices(db), /non riconosciuto/);
    assert.equal(sqlTabella(db), prima);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n, 1);
  });

  it("un tenant nuovo (schema di getTenantDb) nasce già coi tipi e le marche nuovi", () => {
    const T = "TESTTIPINUOVI";
    try {
      withTenant(T, () => {
        const db = getTenantDb(T);
        db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('ups', '10.9.0.1', 'ups', 'other', 'snmp_v2')").run();
        db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('fg', '10.9.0.2', 'firewall', 'fortinet', 'snmp_v2')").run();
        assert.equal(migraCheckNetworkDevices(db), false);
      });
    } finally {
      deleteTenantDatabase(T);
    }
  });
});
