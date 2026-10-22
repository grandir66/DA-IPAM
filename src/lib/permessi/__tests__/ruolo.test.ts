/**
 * Analisi del 19/10, F07: Discovery mostrava «Terminale SSH» al viewer; il clic
 * apriva un terminale che finiva in «Richiesti privilegi di amministratore».
 * Le azioni riservate si offrono solo a chi le può usare.
 *
 * Run: node --import tsx --test src/lib/permessi/__tests__/ruolo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eAdmin } from "../ruolo";

test("admin e superadmin sì; viewer, ruolo assente o sconosciuto no", () => {
  assert.equal(eAdmin("admin"), true);
  assert.equal(eAdmin("superadmin"), true);
  assert.equal(eAdmin("viewer"), false);
  assert.equal(eAdmin(undefined), false);
  assert.equal(eAdmin(null), false);
  assert.equal(eAdmin("Admin"), false);
});
