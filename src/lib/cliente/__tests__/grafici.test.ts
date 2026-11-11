/**
 * I dati dei grafici della casa: la serie degli accesi e le reti con accesi e spenti da poco.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/grafici.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { retiPerGrafico, serieAccesi } from "../grafici";

test("serieAccesi: con meno di due punti non c'è grafico", () => {
  assert.equal(serieAccesi([]), null);
  assert.equal(serieAccesi([{ time: "2026-11-11T10:00:00", online: 5 }]), null);
});

test("serieAccesi: adesso è l'ultimo punto, con minimo e massimo", () => {
  const s = serieAccesi([
    { time: "2026-11-11T08:00:00", online: 120 },
    { time: "2026-11-11T09:00:00", online: 180 },
    { time: "2026-11-11T10:00:00", online: 172 },
  ]);
  assert.ok(s);
  assert.equal(s.adesso, 172);
  assert.equal(s.minimo, 120);
  assert.equal(s.massimo, 180);
  assert.equal(s.punti.length, 3);
});

test("retiPerGrafico: gli assenti non contano, le reti vuote si saltano, la più piena prima", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE networks (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE hosts (id INTEGER PRIMARY KEY, network_id INTEGER, status TEXT, last_seen TEXT);
    INSERT INTO networks VALUES (1, 'Uffici'), (2, 'Server'), (3, 'Vuota');
    INSERT INTO hosts VALUES (1, 1, 'online', datetime('now'));
    INSERT INTO hosts VALUES (2, 1, 'offline', datetime('now', '-1 day'));
    INSERT INTO hosts VALUES (3, 1, 'offline', datetime('now', '-10 days'));
    INSERT INTO hosts VALUES (4, 2, 'online', datetime('now'));
    INSERT INTO hosts VALUES (5, 2, 'online', datetime('now'));
    INSERT INTO hosts VALUES (6, 2, 'online', datetime('now'));
    INSERT INTO hosts VALUES (7, 3, 'offline', NULL);
  `);
  assert.deepEqual(retiPerGrafico(db), [
    { id: 2, nome: "Server", accesi: 3, spenti: 0, totale: 3 },
    { id: 1, nome: "Uffici", accesi: 1, spenti: 1, totale: 2 },
  ]);
});
