// Migrazione «assegnatari da AD» (piano 2026-10-23-assegnatari-da-ad, passo 1): colonne nuove su asset_assignees, ad_users e
// inventory_assets, la tabella host_accessi_utente e tre indici. Additiva, idempotente, in UNA transazione; il segno
// `assegnatari_ad_v21` dice che lo schema c'è (`done:<data>:v1`), scritto una volta sola.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateAssegnatariAd, schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { COLONNE_ASSEGNATARI_AD, DDL_ASSEGNATARI_AD, INDICI_ASSEGNATARI_AD, SEGNO_ASSEGNATARI_AD, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";

const T = "TESTASSEGNATARIADMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const colonne = (db: Database.Database, t: string): string[] =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
const oggetto = (db: Database.Database, tipo: string, n: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(tipo, n);

const ATTESI = [
  ...COLONNE_ASSEGNATARI_AD.map(([t, c]) => `${t}.${c}`),
  ...DDL_ASSEGNATARI_AD.map(([n]) => n),
  ...INDICI_ASSEGNATARI_AD.map(([n]) => n),
].sort();

/** Un tenant com'era prima: lo schema di base, con un assegnatario e un asset già scritti. */
function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare("INSERT INTO asset_assignees (id, name, email) VALUES (1, 'Anna Bianchi', 'a.bianchi@example.test')").run();
  assert.equal(colonne(db, "asset_assignees").includes("origine"), false, "la colonna non deve esserci prima");
  assert.equal(oggetto(db, "table", "host_accessi_utente"), false);
  return db;
}

test("DB di prima: colonne, tabella, indici e segno; la seconda volta niente; le righe di prima restano 'manuale'", () => {
  const db = vecchio();
  assert.deepEqual([...migrateAssegnatariAd(db)].sort(), ATTESI);
  assert.equal(schemaAssegnatariAdPresente(db), true);
  assert.match(String(leggiSegno(db, SEGNO_ASSEGNATARI_AD)), /^done:\d{4}-\d{2}-\d{2}:v1$/);
  const segno = db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_ASSEGNATARI_AD);
  assert.deepEqual(migrateAssegnatariAd(db), [], "seconda chiamata: niente");
  assert.deepEqual(db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_ASSEGNATARI_AD), segno, "il segno non si riscrive");
  assert.deepEqual(
    db.prepare("SELECT name, email, origine, ad_object_guid FROM asset_assignees").all(),
    [{ name: "Anna Bianchi", email: "a.bianchi@example.test", origine: "manuale", ad_object_guid: null }],
  );
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("il legame con AD è unico per integrazione e guid; gli assegnatari a mano (guid NULL) non si scontrano", () => {
  const db = vecchio();
  migrateAssegnatariAd(db);
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc.example.test', 'example.test', 'DC=example,DC=test', 'x', 'x')").run();
  const ins = db.prepare("INSERT INTO asset_assignees (name, ad_integration_id, ad_object_guid, origine) VALUES (?, ?, ?, ?)");
  ins.run("Uno", 1, "guid-1", "ad");
  assert.throws(() => ins.run("Doppio", 1, "guid-1", "ad"), /UNIQUE/);
  ins.run("A mano 1", null, null, "manuale");
  ins.run("A mano 2", null, null, "manuale");
});

test("host_accessi_utente: una riga per host, account, fonte e giorno; la fonte è controllata; via l'host, via le righe", () => {
  const db = vecchio();
  migrateAssegnatariAd(db);
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'rete')").run();
  db.prepare("INSERT INTO hosts (id, network_id, ip) VALUES (7, 1, '192.0.2.7')").run();
  const ins = db.prepare("INSERT INTO host_accessi_utente (host_id, account, fonte, giorno, conteggio) VALUES (7, 's.colombo', ?, '2026-10-22', 3)");
  ins.run("wazuh_tastiera");
  assert.throws(() => ins.run("wazuh_tastiera"), /UNIQUE|PRIMARY/);
  assert.throws(() => ins.run("dc"), /CHECK/);
  db.prepare("DELETE FROM hosts WHERE id = 7").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM host_accessi_utente").get() as { n: number }).n, 0);
});

test("una colonna c'è già: si aggiunge il resto, nient'altro cambia", () => {
  const db = vecchio();
  db.exec("ALTER TABLE asset_assignees ADD COLUMN nome TEXT");
  const added = migrateAssegnatariAd(db);
  assert.equal(added.includes("asset_assignees.nome"), false);
  assert.equal(added.length, ATTESI.length - 1);
});

test("in transazione: se un oggetto non si crea, niente a metà e niente segno", () => {
  const db = vecchio();
  // Una vista col nome della tabella: la sua CREATE TABLE fallisce dopo che le colonne sono già state aggiunte.
  db.exec("CREATE VIEW host_accessi_utente AS SELECT 1 AS x");
  assert.throws(() => migrateAssegnatariAd(db));
  assert.equal(colonne(db, "asset_assignees").includes("origine"), false, "le colonne tornano indietro");
  assert.equal(leggiSegno(db, SEGNO_ASSEGNATARI_AD), null);
  assert.equal(schemaAssegnatariAdPresente(db), false);
});

test("getTenantDb apre un tenant nuovo con lo schema completo", () => {
  const db = getTenantDb(T);
  assert.equal(schemaAssegnatariAdPresente(db), true);
  assert.ok(colonne(db, "inventory_assets").includes("proposta_assegnatario_off"));
  assert.ok(colonne(db, "ad_users").includes("given_name"));
});
