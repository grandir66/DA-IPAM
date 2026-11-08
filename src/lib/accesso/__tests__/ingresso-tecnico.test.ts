/**
 * Ingresso sull'installazione «tecnico» senza `DEFAULT` (ADR 0037, piano 2026-11-08, Task 4).
 *
 * Misura dell'08/11: un superadmin con più tenant entra sulla vista `__ALL__`, dove ogni rotta
 * tenant risponde 409; una sessione senza tenant ricade in silenzio su `DEFAULT`. Sul PC del
 * tecnico il superadmin è l'unico utente e lavora su un profilo alla volta: entra sull'ultimo
 * profilo usato, altrimenti sul primo; una sessione senza profilo riceve «Scegli un profilo»,
 * mai i dati di `DEFAULT`. Sulle installazioni dai clienti le risposte restano quelle di oggi:
 * ogni caso qui sotto è provato con i due profili.
 *
 * Run: node --import tsx --test src/lib/accesso/__tests__/ingresso-tecnico.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { istanzaIniziale } from "@/lib/accesso/sessione";
import { modoTenant, resolveSessionTenant } from "@/lib/api-tenant";

const DUE = [
  { code: "70001", name: "Primo", role: "superadmin" },
  { code: "70002", name: "Secondo", role: "superadmin" },
];

test("superadmin con due profili, mai scelto: tecnico → primo profilo; installazione → __ALL__ come oggi", () => {
  assert.equal(istanzaIniziale({ role: "superadmin", ultima_istanza: null }, DUE, true), "70001");
  assert.equal(istanzaIniziale({ role: "superadmin", ultima_istanza: null }, DUE, false), "__ALL__");
});

test("ultima istanza ancora ammessa: la stessa con i due profili", () => {
  for (const tecnico of [true, false]) {
    assert.equal(istanzaIniziale({ role: "superadmin", ultima_istanza: "70002" }, DUE, tecnico), "70002");
    assert.equal(istanzaIniziale({ role: "superadmin", ultima_istanza: "__ALL__" }, DUE, tecnico), "__ALL__", "scelta dal tecnico");
  }
});

test("ultima istanza sparita: tecnico → primo profilo; installazione → __ALL__", () => {
  assert.equal(istanzaIniziale({ role: "superadmin", ultima_istanza: "79999" }, DUE, true), "70001");
  assert.equal(istanzaIniziale({ role: "superadmin", ultima_istanza: "79999" }, DUE, false), "__ALL__");
});

test("nessun profilo: null con i due profili (niente da aprire)", () => {
  assert.equal(istanzaIniziale({ role: "superadmin" }, [], true), null);
  assert.equal(istanzaIniziale({ role: "superadmin" }, [], false), "__ALL__");
});

test("non superadmin con più profili: deve scegliere, con i due profili", () => {
  for (const tecnico of [true, false]) {
    assert.equal(istanzaIniziale({ role: "admin", ultima_istanza: null }, DUE, tecnico), null);
  }
});

test("sessione senza profilo: tecnico → errore «nessuna»; installazione → DEFAULT come oggi", () => {
  for (const vuoto of [null, undefined, ""]) {
    assert.deepEqual(resolveSessionTenant(vuoto, true), { ok: false, motivo: "nessuna" });
    assert.deepEqual(resolveSessionTenant(vuoto, false), { ok: true, tenant: "DEFAULT" });
  }
});

test("vista aggregata e profilo esplicito: uguali con i due profili", () => {
  for (const tecnico of [true, false]) {
    assert.deepEqual(resolveSessionTenant("__ALL__", tecnico), { ok: false });
    assert.deepEqual(resolveSessionTenant("70001", tecnico), { ok: true, tenant: "70001" });
  }
});

test("modo delle liste (getTenantMode): tecnico senza profilo → aggregato; installazione → DEFAULT come oggi", () => {
  for (const vuoto of [null, undefined, ""]) {
    assert.deepEqual(modoTenant(vuoto, "superadmin", true), { mode: "all" });
    assert.deepEqual(modoTenant(vuoto, "superadmin", false), { mode: "single", tenantCode: "DEFAULT" });
  }
  for (const tecnico of [true, false]) {
    assert.deepEqual(modoTenant("__ALL__", "superadmin", tecnico), { mode: "all" });
    assert.deepEqual(modoTenant("70001", "admin", tecnico), { mode: "single", tenantCode: "70001" });
  }
});
