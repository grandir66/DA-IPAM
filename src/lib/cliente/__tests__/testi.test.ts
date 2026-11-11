/**
 * Frasi di tempo e pulizia del sistema operativo nella vista cliente.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/testi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { daQuanto, sistemaPulito } from "../testi";

const ADESSO = new Date("2026-11-11T12:00:00.000Z");

test("daQuanto: ore, giorni, poi la data", () => {
  assert.equal(daQuanto(new Date("2026-11-11T11:30:00.000Z"), ADESSO), "da meno di un'ora");
  assert.equal(daQuanto(new Date("2026-11-11T11:00:00.000Z"), ADESSO), "da 1 ora");
  assert.equal(daQuanto(new Date("2026-11-11T09:00:00.000Z"), ADESSO), "da 3 ore");
  assert.equal(daQuanto(new Date("2026-11-10T12:00:00.000Z"), ADESSO), "da 1 giorno");
  assert.equal(daQuanto(new Date("2026-11-06T12:00:00.000Z"), ADESSO), "da 5 giorni");
  assert.equal(daQuanto(new Date("2026-11-04T12:00:00.000Z"), ADESSO), "da 7 giorni");
  assert.equal(daQuanto(new Date("2026-10-26T10:00:00.000Z"), ADESSO), "dal 26/10/2026");
  assert.equal(daQuanto(new Date(Number.NaN), ADESSO), "da tempo");
});

test("sistemaPulito scarta l'insegna generica e il banner di una porta", () => {
  assert.equal(sistemaPulito(null), null);
  assert.equal(sistemaPulito("  "), null);
  assert.equal(sistemaPulito("Linux/Unix/embedded"), null);
  assert.equal(sistemaPulito("21/MikroTik router ftpd 7.22"), null);
  assert.equal(sistemaPulito("Windows 11 Pro"), "Windows 11 Pro");
});
