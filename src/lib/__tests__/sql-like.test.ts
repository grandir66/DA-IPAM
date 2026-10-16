/**
 * Ricerca testuale nella cronologia Patch (blocco 1, 2026-10-12): la ricerca per
 * host era applicata dalla pagina sulle 50 righe caricate, quindi un host fuori
 * dalla prima pagina «non c'era». Ora la fa il server con LIKE: `_` e `%` scritti
 * dall'utente devono valere come caratteri, non come jolly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { LIKE_ESCAPE, likeContains } from "../sql-like";

describe("likeContains", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE h (id INTEGER PRIMARY KEY, name TEXT)");
  const ins = db.prepare("INSERT INTO h (id, name) VALUES (?, ?)");
  ins.run(1, "PC_MARIO");
  ins.run(2, "PCXMARIO");
  ins.run(3, "sala 50% piano");
  ins.run(4, "sala 500");
  ins.run(5, "C:\\dati");
  const find = (q: string) =>
    (db.prepare(`SELECT id FROM h WHERE name LIKE ? ${LIKE_ESCAPE} ORDER BY id`).all(likeContains(q)) as { id: number }[]).map((r) => r.id);

  it("trova per sottostringa, senza distinguere maiuscole", () => {
    assert.deepEqual(find("mario"), [1, 2]);
  });
  it("il trattino basso è un carattere, non un jolly", () => {
    assert.deepEqual(find("PC_"), [1]);
  });
  it("il percento è un carattere, non un jolly", () => {
    assert.deepEqual(find("50%"), [3]);
  });
  it("la barra rovescia è un carattere", () => {
    assert.deepEqual(find("C:\\d"), [5]);
  });
});
