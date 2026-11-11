/**
 * La disposizione della casa componibile: valida sempre, anche da un valore salvato rotto o
 * dalla prima versione («mezza» / «intera», un solo riquadro «accessi»).
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/casa.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ALTEZZA_MAX, ALTEZZA_MIN, RIQUADRI_CASA, allarga, alza, disposizionePredefinita, leggiDisposizione,
  normalizza, salvaDisposizione, sposta, spostaPrima,
} from "../casa";

test("normalizza: un valore che non è un elenco dà la disposizione predefinita", () => {
  assert.deepEqual(normalizza(null), disposizionePredefinita());
  assert.deepEqual(normalizza("ciao"), disposizionePredefinita());
});

test("normalizza: scarta sconosciuti e doppi, corregge le misure, aggiunge in coda i mancanti", () => {
  const voci = normalizza([
    { id: "rischio", l: 12, a: 3, visibile: false },
    { id: "inventato", l: 6, a: 4, visibile: true },
    { id: "rischio", l: 3, a: 4, visibile: true },
    { id: "reti", l: 5, a: 99 },
  ]);
  assert.deepEqual(voci.slice(0, 2), [
    { id: "rischio", l: 12, a: 3, visibile: false },
    { id: "reti", l: 6, a: 4, visibile: true },
  ]);
  assert.equal(voci.length, RIQUADRI_CASA.length);
  assert.deepEqual(voci.map((v) => v.id).sort(), RIQUADRI_CASA.map((r) => r.id).sort());
});

test("normalizza: legge la prima versione, mezza e intera, e il vecchio riquadro unico degli accessi", () => {
  const voci = normalizza([
    { id: "accessi", misura: "mezza", visibile: false },
    { id: "reti", misura: "intera", visibile: true },
  ]);
  assert.deepEqual(voci[0], { id: "accessi-andamento", l: 6, a: 4, visibile: false });
  assert.deepEqual(voci[1], { id: "reti", l: 12, a: 4, visibile: true });
});

test("sposta e spostaPrima: cambiano solo l'ordine", () => {
  const base = disposizionePredefinita();
  const ids = base.map((v) => v.id);
  assert.deepEqual(sposta(base, ids[0] ?? "", "prima").map((v) => v.id), ids);
  assert.deepEqual(sposta(base, ids[0] ?? "", "dopo").map((v) => v.id).slice(0, 2), [ids[1], ids[0]]);
  assert.deepEqual(spostaPrima(base, ids[3] ?? "", ids[0] ?? "").map((v) => v.id).slice(0, 2), [ids[3], ids[0]]);
  assert.deepEqual(spostaPrima(base, "inventato", ids[0] ?? ""), base);
  assert.deepEqual(spostaPrima(base, ids[1] ?? "", ids[1] ?? ""), base);
});

test("allarga e alza: a scatti, e agli estremi restano dove sono", () => {
  const base = [{ id: "reti", l: 6, a: 4, visibile: true }];
  assert.equal(allarga(base, "reti", 1)[0]?.l, 8);
  assert.equal(allarga(base, "reti", -1)[0]?.l, 4);
  assert.equal(allarga([{ id: "reti", l: 12, a: 4, visibile: true }], "reti", 1)[0]?.l, 12);
  assert.equal(allarga([{ id: "reti", l: 3, a: 4, visibile: true }], "reti", -1)[0]?.l, 3);
  assert.equal(alza(base, "reti", 1)[0]?.a, 5);
  assert.equal(alza([{ id: "reti", l: 6, a: ALTEZZA_MAX, visibile: true }], "reti", 1)[0]?.a, ALTEZZA_MAX);
  assert.equal(alza([{ id: "reti", l: 6, a: ALTEZZA_MIN, visibile: true }], "reti", -1)[0]?.a, ALTEZZA_MIN);
});

test("salva e rileggi: una per cliente, il valore rotto torna predefinito", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE tenant_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  assert.deepEqual(leggiDisposizione(db), disposizionePredefinita());
  const salvata = salvaDisposizione(db, [{ id: "reti", l: 9, a: 6, visibile: false }]);
  assert.deepEqual(salvata[0], { id: "reti", l: 9, a: 6, visibile: false });
  assert.deepEqual(leggiDisposizione(db), salvata);
  db.prepare("UPDATE tenant_settings SET value = '{non json' WHERE key = 'cliente.casa'").run();
  assert.deepEqual(leggiDisposizione(db), disposizionePredefinita());
});
