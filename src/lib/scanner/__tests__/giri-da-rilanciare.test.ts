/**
 * Il 10/11/2026 quattro Discovery lanciate a mano sono morte col riavvio di un aggiornamento.
 * Ripartono da capo, ma un riavvio non deve diventare un motivo per bussare agli host all'infinito:
 * una volta sola, entro due ore, senza prove invasive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { corpoPerRilancio, daRilanciare, eRilanciabile, leggiSalvati, type GiroSalvato } from "../giri-da-rilanciare";

const ADESSO = Date.parse("2026-11-10T20:00:00Z");
const voce = (minutiFa: number, rilanci: number): GiroSalvato => ({
  id: `g-${minutiFa}-${rilanci}`,
  corpo: { tipo: "discovery", profilo: "standard", network_ids: [1, 3] },
  lanciato_il: new Date(ADESSO - minutiFa * 60_000).toISOString(),
  rilanci,
});

test("riparte solo chi non è mai ripartito ed è più giovane di due ore", () => {
  const scelti = daRilanciare([voce(6, 0), voce(6, 1), voce(119, 0), voce(121, 0), voce(-5, 0)], ADESSO);
  assert.deepEqual(scelti.map((v) => v.id), ["g-6-0", "g-119-0"]);
});

test("il rilancio toglie le prove invasive e lascia il resto", () => {
  assert.deepEqual(
    corpoPerRilancio({ tipo: "controlli", profilo: "standard", network_ids: [4], prove_fabbrica: true, con_credenziali: true }),
    { tipo: "controlli", profilo: "standard", network_ids: [4], con_credenziali: true },
  );
});

test("solo Discovery e Solo controlli; un salvataggio rotto non è un giro", () => {
  assert.equal(eRilanciabile("discovery"), true);
  assert.equal(eRilanciabile("controlli"), true);
  assert.equal(eRilanciabile("segmentazione"), false);
  assert.equal(eRilanciabile("sonda_l2"), false);
  assert.deepEqual(leggiSalvati("non json"), []);
  assert.deepEqual(leggiSalvati('[{"id":"x"},{"id":"y","corpo":{},"lanciato_il":"2026-11-10T19:00:00Z","rilanci":0}]').map((v) => v.id), ["y"]);
});
