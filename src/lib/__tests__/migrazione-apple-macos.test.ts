/**
 * Tappa 1b credenziali (15/10): `apple`/`macos` accettati da network_devices.
 *
 * Rischio: le ricostruzioni vecchie della tabella riscrivono un elenco fisso di
 * colonne e perdono le altre (topologia, snmp_version…). Questa parte dalla
 * definizione attuale: qui un tenant vero, con tutte le migrazioni di
 * getTenantDb, riportato alla definizione senza apple/macos, con righe e
 * binding collegati → dopo la migrazione stesse colonne, stesse righe, binding
 * ancora lì, foreign_key_check vuoto, un Mac si inserisce; seconda volta niente.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/migrazione-apple-macos.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { migraAppleMacos, definizioneConAppleMacos } from "@/lib/devices/migra-apple-macos";

const T = "TESTMIGRAAPPLE";

/** Impalcatura della prova: riporta network_devices alla definizione senza apple/macos. */
function tornaAllaDefinizioneVecchia(db: Database.Database): void {
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='network_devices'").get() as { sql: string }).sql;
  if (!sql.includes("'apple'") && !sql.includes("'macos'")) return;
  const vecchia = sql
    .replace(/,\s*'apple'/, "")
    .replace(/,\s*'macos'/, "")
    .replace(/^CREATE TABLE\s+"?network_devices"?\s*\(/, "CREATE TABLE nd_vecchia (");
  const indici = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='network_devices' AND type='index' AND sql IS NOT NULL").all() as Array<{ sql: string }>;
  db.pragma("foreign_keys = OFF");
  db.exec(vecchia);
  db.exec("INSERT INTO nd_vecchia SELECT * FROM network_devices");
  db.exec("DROP TABLE network_devices");
  db.exec("ALTER TABLE nd_vecchia RENAME TO network_devices");
  for (const i of indici) db.exec(i.sql);
  db.pragma("foreign_keys = ON");
}

function colonne(db: Database.Database) {
  return db.prepare("PRAGMA table_info(network_devices)").all();
}

function indici(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE tbl_name='network_devices' AND type='index' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
}

describe("migraAppleMacos", () => {
  let db: Database.Database;
  before(() => {
    db = withTenant(T, () => getTenantDb(T));
    tornaAllaDefinizioneVecchia(db);
    db.prepare("INSERT INTO credentials (id, name, credential_type) VALUES (1, 'ssh', 'ssh')").run();
    const ins = db.prepare(
      `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, port, classification, snmp_version, snmp_version_fissata, credential_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    ins.run(1, "sw1", "10.60.0.2", "switch", "mikrotik", "snmp_v2", 161, "switch", "1", 1, null);
    ins.run(2, "srv", "10.60.0.3", "server", "linux", "ssh", 22, "server", null, 0, 1);
    db.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (2, 1, 'ssh', 22, 0)").run();
  });
  after(() => deleteTenantDatabase(T));

  it("precondizione: la definizione vecchia rifiuta un Mac", () => {
    assert.throws(() =>
      db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('mac', '10.60.0.9', 'server', 'apple', 'ssh')").run()
    );
  });

  it("ricostruisce senza perdere colonne, righe, indici e binding; un Mac poi si inserisce", () => {
    const colonnePrima = colonne(db);
    const righePrima = db.prepare("SELECT * FROM network_devices ORDER BY id").all();
    const indiciPrima = indici(db);
    assert.ok((colonnePrima as Array<{ name: string }>).some((c) => c.name === "snmp_version_fissata"), "il tenant di prova ha le colonne aggiunte dopo");

    const esito = migraAppleMacos(db);
    assert.deepEqual(esito, { eseguita: true, righe: 2 });
    assert.deepEqual(colonne(db), colonnePrima);
    assert.deepEqual(db.prepare("SELECT * FROM network_devices ORDER BY id").all(), righePrima);
    assert.deepEqual(indici(db), indiciPrima);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const b = db.prepare("SELECT device_id, credential_id FROM device_credential_bindings").all();
    assert.deepEqual(b, [{ device_id: 2, credential_id: 1 }]);

    db.prepare(
      "INSERT INTO network_devices (name, host, device_type, vendor, protocol, scan_target) VALUES ('mac', '10.60.0.9', 'server', 'apple', 'ssh', 'macos')"
    ).run();
    // Il CHECK resta un CHECK: un valore fuori elenco è ancora rifiutato.
    assert.throws(() =>
      db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('x', '10.60.0.10', 'server', 'dell', 'ssh')").run()
    );
  });

  it("seconda esecuzione senza effetti", () => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='network_devices'").get();
    assert.deepEqual(migraAppleMacos(db), { eseguita: false, righe: 0 });
    assert.deepEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name='network_devices'").get(), sql);
  });

  it("definizione non riconosciuta → errore, niente ricostruzione alla cieca", () => {
    assert.throws(() => definizioneConAppleMacos("CREATE TABLE network_devices (id INTEGER, vendor TEXT)", "x"), /CHECK di vendor non riconosciuto/);
  });
});
