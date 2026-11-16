/** Aggancio delle macchine ESET agli host (17/11/2026): MAC, poi seriale, poi nome; mai a caso fra due. */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { assicuraSchemaEset } from "../eset-dalink";
import { abbina, abbinaAMano, indiciHost, nomeCorto, riabbinaEset, serialeUtile, togliAbbinamentoAMano } from "../eset-abbina";

const HOSTS = [
  { id: 1, mac: "AA:BB:CC:00:00:01", nome: "PC-UNO.dominio.lan", nome2: null, seriale: "SER-0001" },
  { id: 2, mac: "aa:bb:cc:00:00:02", nome: "pc-due", nome2: null, seriale: "To be filled by O.E.M." },
  { id: 3, mac: null, nome: "doppio", nome2: null, seriale: null },
  { id: 4, mac: null, nome: "192.168.1.9", nome2: "DOPPIO", seriale: "To be filled by O.E.M." },
];
const m = (x: Partial<{ nome: string; hostname: string | null; mac: string[]; seriale: string | null }>) => ({ uuid: "u", nome: "x-sconosciuto", hostname: null, mac: [], seriale: null, ...x });

test("il MAC vince sul nome, poi il seriale, poi il nome senza dominio", () => {
  const i = indiciHost(HOSTS);
  assert.deepEqual(abbina(m({ nome: "pc-due", mac: ["aa-bb-cc-00-00-01"] }), i), { host_id: 1, per: "mac" });
  assert.deepEqual(abbina(m({ seriale: "ser-0001" }), i), { host_id: 1, per: "seriale" });
  assert.deepEqual(abbina(m({ nome: "PC-DUE" }), i), { host_id: 2, per: "nome" });
  assert.deepEqual(abbina(m({ hostname: "pc-uno.altro.dominio" }), i), { host_id: 1, per: "nome" });
  assert.deepEqual(abbina(m({ nome: "mai-visto" }), i), { host_id: null, per: "nessuno" });
});

test("due candidati non si scelgono a caso; i seriali segnaposto e gli IP non agganciano", () => {
  const i = indiciHost(HOSTS);
  assert.deepEqual(abbina(m({ nome: "doppio" }), i), { host_id: null, per: "ambiguo" });
  assert.deepEqual(abbina(m({ seriale: "To be filled by O.E.M." }), i), { host_id: null, per: "nessuno" });
  assert.deepEqual(abbina(m({ nome: "192.168.1.9" }), i), { host_id: null, per: "nessuno" });
  assert.equal(serialeUtile("0000"), null);
  assert.equal(nomeCorto("10.0.0.1"), null);
});

test("il MAC noto dall'agente Wazuh aggancia anche se l'host non ha MAC", () => {
  const i = indiciHost(HOSTS, [{ host_id: 3, mac: "aa:bb:cc:00:00:33" }]);
  assert.deepEqual(abbina(m({ mac: ["aa:bb:cc:00:00:33"] }), i), { host_id: 3, per: "mac" });
});

function banco(): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE hosts (id INTEGER PRIMARY KEY, mac TEXT, hostname TEXT, custom_name TEXT, serial_number TEXT)");
  assicuraSchemaEset(db);
  const h = db.prepare("INSERT INTO hosts (id, mac, hostname, custom_name, serial_number) VALUES (?,?,?,?,?)");
  for (const x of HOSTS) h.run(x.id, x.mac, x.nome, x.nome2, x.seriale);
  const e = db.prepare("INSERT INTO eset_macchina (uuid, nome, mac, seriale, letto_il) VALUES (?,?,?,?, 'x')");
  e.run("e1", "altro-nome", JSON.stringify(["aa:bb:cc:00:00:01"]), null);
  e.run("e2", "pc-due", "[]", null);
  e.run("e3", "doppio", "[]", null);
  e.run("e4", "fantasma", "non json", null);
  return db;
}
const agganci = (db: Database.Database) =>
  Object.fromEntries((db.prepare("SELECT macchina_uuid, host_id, per, a_mano FROM eset_abbinamento").all() as Array<{ macchina_uuid: string; host_id: number | null; per: string; a_mano: number }>).map((r) => [r.macchina_uuid, [r.host_id, r.per, r.a_mano]]));

test("il ricalcolo scrive gli agganci e non tocca quelli fatti a mano", () => {
  const db = banco();
  const c = riabbinaEset(db);
  assert.deepEqual(agganci(db), { e1: [1, "mac", 0], e2: [2, "nome", 0], e3: [null, "ambiguo", 0], e4: [null, "nessuno", 0] });
  assert.equal(c.agganciate, 2);
  assert.equal(c.da_abbinare, 2);
  assert.ok(abbinaAMano(db, "e3", 4));
  assert.ok(abbinaAMano(db, "e2", null)); // «non è fra gli host», anche se il nome coincide
  assert.equal(abbinaAMano(db, "e1", 999), false);
  assert.equal(abbinaAMano(db, "non-esiste", 1), false);
  riabbinaEset(db);
  assert.deepEqual(agganci(db), { e1: [1, "mac", 0], e2: [null, "mano", 1], e3: [4, "mano", 1], e4: [null, "nessuno", 0] });
  // host dell'aggancio a mano cancellato: la macchina torna all'automatico
  db.prepare("DELETE FROM hosts WHERE id = 4").run();
  riabbinaEset(db);
  assert.deepEqual(agganci(db).e3, [3, "nome", 0]);
  togliAbbinamentoAMano(db, "e2");
  assert.deepEqual(agganci(db).e2, [2, "nome", 0]);
});
