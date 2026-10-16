// Migrazione «unioni a mano» (piano 2026-10-16, Task 2; ADR 0021): due tabelle (`topology_unioni`, `topology_separazioni`) e
// tre indici parziali sulle sole righe attive (`tolto_il IS NULL`). Additiva, idempotente, in UNA transazione (o tutto o
// niente); le tabelle nascono anche dallo schema (stesse CREATE, `DDL_TOPOLOGY_UNIONI`), gli indici solo qui. All'apertura del
// tenant: la riga «topologia unioni, aggiunto …» nel journal (la prova del rilascio), un errore che non impedisce l'apertura, e
// l'annotazione dello schema che le rotte chiedono prima di scrivere. Modello: topology-cavi-migration.test.ts.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  closeTenantDb, deleteTenantDatabase, getRigheScelte, getTenantDb, getTopologyModelInput, migrateTopologyUnioni, schemaUnioniPresente, withTenant,
} from "@/lib/db-tenant";
import { TENANT_INDEXES_SQL, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";

const T_NUOVO = "TESTUNIONIMIGNUOVO";
const T_ERRORE = "TESTUNIONIMIGERRORE";
const T_VERIFICA = "TESTUNIONIMIGVERIFICA";
after(() => {
  for (const t of [T_NUOVO, T_ERRORE, T_VERIFICA]) deleteTenantDatabase(t);
  closeHubDb();
  removeTestHubDb();
});

const TABELLE = ["topology_separazioni", "topology_unioni"];
/** Nell'ordine in cui la migrazione li crea (e li scrive nel journal). */
const INDICI = ["idx_topology_unioni_membro_attivo", "idx_topology_unioni_gruppo", "idx_topology_separazioni_coppia_attiva"];

const schema = (db: Database.Database) => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
const sqlDi = (db: Database.Database, nome: string): string =>
  String((db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(nome) as { sql: string }).sql);
const indiciDelleUnioni = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('topology_unioni', 'topology_separazioni') ORDER BY name").all() as Array<{ name: string }>)
    .map((r) => r.name);

test("su un DB senza le tabelle: due tabelle e tre indici, elencati; la seconda volta niente", () => {
  const db = new Database(":memory:");
  assert.deepEqual([...migrateTopologyUnioni(db)].sort(), [...TABELLE, ...INDICI].sort());
  const prima = schema(db);
  assert.deepEqual(migrateTopologyUnioni(db), []);
  assert.deepEqual(schema(db), prima, "seconda apertura: niente cambia");
  // Gli indici valgono per le sole righe attive: una riga tolta resta (la storia) e non occupa il membro né la coppia.
  for (const i of INDICI) assert.match(sqlDi(db, i), /WHERE tolto_il IS NULL$/, i);
  const unici = (t: string) => (db.prepare(`PRAGMA index_list(${t})`).all() as Array<{ name: string; unique: number }>)
    .filter((x) => INDICI.includes(x.name)).map((x) => [x.name, x.unique]).sort();
  assert.deepEqual(unici("topology_unioni"), [["idx_topology_unioni_gruppo", 0], ["idx_topology_unioni_membro_attivo", 1]]);
  assert.deepEqual(unici("topology_separazioni"), [["idx_topology_separazioni_coppia_attiva", 1]]);
  // Nessuna chiave esterna: i membri sono id della mappa («host:N», «dev:N») e sopravvivono all'oggetto (Caso 2 del piano).
  for (const t of TABELLE) assert.deepEqual(db.prepare(`PRAGMA foreign_key_list(${t})`).all(), [], t);
});

test("con le tabelle dello schema: si aggiungono solo gli indici, e le tabelle dello schema sono quelle della migrazione", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  assert.deepEqual(indiciDelleUnioni(db), [], "gli indici non stanno nello schema");
  const dalloSchema = TABELLE.map((t) => sqlDi(db, t));
  assert.deepEqual(migrateTopologyUnioni(db), INDICI);
  const vuoto = new Database(":memory:");
  migrateTopologyUnioni(vuoto);
  assert.deepEqual(dalloSchema, TABELLE.map((t) => sqlDi(vuoto, t)), "stesse CREATE nello schema e nella migrazione");
  assert.deepEqual(migrateTopologyUnioni(db), []);
});

test("in transazione: se un passo fallisce non resta niente a metà", () => {
  const db = new Database(":memory:");
  // Una topology_separazioni senza `altro`: l'indice della coppia (l'ultimo passo) fallisce dopo la tabella e i due indici
  // delle unioni, che non devono restare.
  db.exec("CREATE TABLE topology_separazioni (id INTEGER PRIMARY KEY AUTOINCREMENT, membro TEXT NOT NULL, tolto_il TEXT)");
  const prima = schema(db);
  assert.throws(() => migrateTopologyUnioni(db), /altro/);
  assert.deepEqual(schema(db), prima, "niente topology_unioni, nessun indice");
});

test("all'apertura di un tenant nuovo: una riga nel journal con ciò che si è aggiunto, lo schema annotato presente; riaperto, nessuna riga", () => {
  const info = mock.method(console, "info", () => undefined);
  try {
    getTenantDb(T_NUOVO);
  } finally {
    info.mock.restore();
  }
  const righe = info.mock.calls.map((c) => String(c.arguments[0])).filter((r) => r.includes("topologia unioni"));
  assert.deepEqual(righe, [`[db-tenant] ${T_NUOVO}: topologia unioni, aggiunto ${INDICI.join(", ")}`]);
  assert.equal(withTenant(T_NUOVO, () => schemaUnioniPresente()), true);
  closeTenantDb(T_NUOVO);
  const info2 = mock.method(console, "info", () => undefined);
  try {
    getTenantDb(T_NUOVO);
  } finally {
    info2.mock.restore();
  }
  assert.deepEqual(info2.mock.calls.map((c) => String(c.arguments[0])).filter((r) => r.includes("topologia unioni")), []);
  assert.equal(withTenant(T_NUOVO, () => schemaUnioniPresente()), true);
});

// Vincolo del piano: un errore della migrazione non impedisce l'apertura del tenant. Si fa fallire per finta l'ultimo passo
// (l'indice della coppia), così si vede anche che i due indici creati prima non restano.
test("se la migrazione fallisce all'apertura: il tenant si apre, una riga nel journal, unioni non disponibili e la mappa di oggi; si riprova alla prossima apertura", () => {
  const proto = Database.prototype as unknown as { exec: (this: Database.Database, sql: string) => Database.Database };
  const originale = proto.exec;
  proto.exec = function (this: Database.Database, sql: string) {
    if (sql.startsWith("CREATE UNIQUE INDEX idx_topology_separazioni_coppia_attiva")) throw new Error("indice della coppia rifiutato per finta");
    return originale.call(this, sql);
  };
  const errore = mock.method(console, "error", () => undefined);
  try {
    assert.doesNotThrow(() => getTenantDb(T_ERRORE));
  } finally {
    proto.exec = originale;
    errore.mock.restore();
  }
  const righe = errore.mock.calls.filter((c) => String(c.arguments[0]).includes("topologia unioni"));
  assert.equal(righe.length, 1);
  assert.equal(String(righe[0].arguments[0]), `[db-tenant] ${T_ERRORE}: migrazione topologia unioni fallita, le unioni non sono disponibili:`);
  assert.match(String(righe[0].arguments[1]), /rifiutato per finta/);
  assert.deepEqual(indiciDelleUnioni(getTenantDb(T_ERRORE)), [], "nessun indice a metà");
  assert.equal(withTenant(T_ERRORE, () => schemaUnioniPresente()), false);
  assert.deepEqual(withTenant(T_ERRORE, () => getRigheScelte()), { unioni: [], separazioni: [] });
  const input = withTenant(T_ERRORE, () => getTopologyModelInput(2));
  assert.deepEqual(["unioni" in input, "separazioni" in input], [false, false]);
  closeTenantDb(T_ERRORE);
  getTenantDb(T_ERRORE);
  assert.equal(withTenant(T_ERRORE, () => schemaUnioniPresente()), true, "alla prossima apertura la migrazione riesce");
});

// Come per lo schema dei cavi (revisione del Task 1 di T2): anche la verifica dello schema all'apertura non deve impedire
// l'apertura. Senza annotazione, schemaUnioniPresente() rifà la verifica alla prima domanda. Si intercetta la sua sola query
// (unica nel codice: «SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name IN (…)»).
test("se la verifica dello schema fallisce all'apertura: il tenant si apre lo stesso, e la verifica si rifà dopo", () => {
  const proto = Database.prototype as unknown as { prepare: (this: Database.Database, sql: string) => unknown };
  const originale = proto.prepare;
  proto.prepare = function (this: Database.Database, sql: string) {
    if (sql.startsWith("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name IN (")) {
      throw new Error("verifica dello schema delle unioni fallita per finta");
    }
    return originale.call(this, sql);
  };
  const errore = mock.method(console, "error", () => undefined);
  try {
    assert.doesNotThrow(() => getTenantDb(T_VERIFICA));
  } finally {
    proto.prepare = originale;
    errore.mock.restore();
  }
  assert.ok(errore.mock.calls.some((c) => String(c.arguments[0]).startsWith(`[db-tenant] ${T_VERIFICA}: verifica dello schema delle unioni fallita`)), "detto nel journal");
  assert.equal(withTenant(T_VERIFICA, () => schemaUnioniPresente()), true, "senza annotazione la verifica si rifà");
});
