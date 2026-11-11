/**
 * La disposizione della casa componibile: valida sempre, anche da un valore salvato rotto.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/casa.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { RIQUADRI_CASA, disposizionePredefinita, leggiDisposizione, normalizza, salvaDisposizione, sposta } from "../casa";

test("normalizza: un valore che non è un elenco dà la disposizione predefinita", () => {
  assert.deepEqual(normalizza(null), disposizionePredefinita());
  assert.deepEqual(normalizza("ciao"), disposizionePredefinita());
});

test("normalizza: scarta sconosciuti e doppi, corregge la misura, aggiunge in coda i mancanti", () => {
  const voci = normalizza([
    { id: "rischio", misura: "intera", visibile: false },
    { id: "inventato", misura: "mezza", visibile: true },
    { id: "rischio", misura: "mezza", visibile: true },
    { id: "reti", misura: "gigante" },
  ]);
  assert.deepEqual(voci.slice(0, 2), [
    { id: "rischio", misura: "intera", visibile: false },
    { id: "reti", misura: "mezza", visibile: true },
  ]);
  assert.equal(voci.length, RIQUADRI_CASA.length);
  assert.deepEqual(voci.map((v) => v.id).sort(), RIQUADRI_CASA.map((r) => r.id).sort());
});

test("sposta: di un posto, e ai bordi non fa niente", () => {
  const base = disposizionePredefinita();
  const primo = base[0]?.id ?? "";
  const secondo = base[1]?.id ?? "";
  assert.deepEqual(sposta(base, primo, "su").map((v) => v.id), base.map((v) => v.id));
  assert.deepEqual(sposta(base, primo, "giu").map((v) => v.id).slice(0, 2), [secondo, primo]);
  assert.deepEqual(sposta(base, "inventato", "giu"), base);
});

test("salva e rileggi: una per cliente, il valore rotto torna predefinito", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE tenant_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  assert.deepEqual(leggiDisposizione(db), disposizionePredefinita());
  const salvata = salvaDisposizione(db, [{ id: "accessi", misura: "mezza", visibile: false }]);
  assert.deepEqual(salvata[0], { id: "accessi", misura: "mezza", visibile: false });
  assert.deepEqual(leggiDisposizione(db), salvata);
  salvaDisposizione(db, [{ id: "reti", misura: "intera", visibile: true }]);
  assert.equal(leggiDisposizione(db)[0]?.id, "reti");
  db.prepare("UPDATE tenant_settings SET value = '{non json' WHERE key = 'cliente.casa'").run();
  assert.deepEqual(leggiDisposizione(db), disposizionePredefinita());
});
