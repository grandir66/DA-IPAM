/**
 * `intervalToCron` con l'ora facoltativa (piano 2026-10-22 scansione automatica, Task 2): il giornaliero di
 * `apparati_scelti` gira all'ora scelta in `config.ora`; senza ora, gli altri tipi restano come prima.
 *
 * Run: node --import tsx --test src/lib/cron/__tests__/interval-to-cron-ora.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToCron } from "@/lib/cron/scheduler";

test("giornaliero con l'ora: «M H * * *»", () => {
  assert.equal(intervalToCron(1440, "apparati_scelti", { h: 2, m: 0 }), "0 2 * * *");
  assert.equal(intervalToCron(1440, "apparati_scelti", { h: 23, m: 45 }), "45 23 * * *");
});

test("senza ora i giornalieri restano alle ore del tipo", () => {
  assert.equal(intervalToCron(1440, "hypervisor_sync"), "0 3 * * *");
  assert.equal(intervalToCron(1440, "pulizia_host"), "0 4 * * *");
  assert.equal(intervalToCron(1440), "0 3 * * *");
});

test("ogni ora e ogni 4 ore: l'ora non conta", () => {
  assert.equal(intervalToCron(60, "apparati_scelti"), "0 */1 * * *");
  assert.equal(intervalToCron(240, "apparati_scelti"), "0 */4 * * *");
  assert.equal(intervalToCron(240, "apparati_scelti", { h: 2, m: 0 }), "0 */4 * * *");
});
