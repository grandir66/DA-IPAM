// Migrazione delle esclusioni da LibreNMS (giro del 22/10, punto 2: «Non aggiungere a LibreNMS»): una tabella, additiva,
// idempotente, in UNA transazione; il segno `librenms_esclusione_v21` scritto una volta. Un oggetto omonimo di altro tipo
// fa fallire la migrazione invece di passare muto, e da lì il giro non aggiunge oggetti SNMP.
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/migrazione-librenms-esclusione.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateLibrenmsEsclusione, migrateLibrenmsFonte, schemaEsclusioneLibrenms } from "@/lib/db-tenant";
import { SEGNO_LIBRENMS_ESCLUSIONE, TENANT_INDEXES_SQL, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";

const T = "TESTLIBRENMSESCLMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const schema = (db: Database.Database): string[] =>
  (db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string }>)
    .map((r) => `${r.type} ${r.name}`);

function diOggi(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  migrateLibrenmsFonte(db);
  return db;
}

test("DB di oggi: una tabella e il segno; la seconda volta niente; nient'altro cambia", () => {
  const db = diOggi();
  const prima = schema(db);
  assert.equal(schemaEsclusioneLibrenms(db), false);
  assert.deepEqual(migrateLibrenmsEsclusione(db), ["librenms_esclusione"]);
  assert.equal(schemaEsclusioneLibrenms(db), true);
  assert.deepEqual(schema(db).filter((r) => !prima.includes(r)), ["table librenms_esclusione"]);
  const segno = leggiSegno(db, SEGNO_LIBRENMS_ESCLUSIONE);
  assert.match(segno ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.deepEqual(migrateLibrenmsEsclusione(db), [], "seconda chiamata: niente");
  assert.equal(leggiSegno(db, SEGNO_LIBRENMS_ESCLUSIONE), segno);
});

test("una vista omonima: la migrazione fallisce (ROLLBACK), lo schema resta assente", () => {
  const db = diOggi();
  db.exec("CREATE VIEW librenms_esclusione AS SELECT 1 AS ip");
  assert.throws(() => migrateLibrenmsEsclusione(db));
  assert.equal(schemaEsclusioneLibrenms(db), false);
  assert.equal(leggiSegno(db, SEGNO_LIBRENMS_ESCLUSIONE), null);
});

test("apertura di un tenant nuovo: la tabella c'è", () => {
  const db = getTenantDb(T);
  assert.equal(schemaEsclusioneLibrenms(db), true);
  assert.match(leggiSegno(db, SEGNO_LIBRENMS_ESCLUSIONE) ?? "", /^done:/);
});
