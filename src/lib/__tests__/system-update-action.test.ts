/**
 * POST /api/system/update: l'azione arriva nell'indirizzo O nel corpo JSON.
 *
 * Perché (revisione 2026-10-12): Impostazioni → Aggiornamenti («Aggiorna ora»)
 * manda `{ "action": "apply" }` nel corpo, il banner degli aggiornamenti manda
 * `?action=apply` nell'indirizzo. La rotta leggeva solo l'indirizzo, e il
 * pulsante di Impostazioni riceveva 400 «Azione non supportata».
 *
 * Run: node --import tsx --test src/lib/__tests__/system-update-action.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { readUpdateAction } from "../system-update-action";

test("azione nell'indirizzo, corpo vuoto (banner: ?action=apply)", () => {
  assert.deepEqual(readUpdateAction("apply", ""), { ok: true, action: "apply" });
  assert.deepEqual(readUpdateAction("restart", ""), { ok: true, action: "restart" });
});

test("azione nel corpo JSON (Impostazioni → Aggiornamenti)", () => {
  assert.deepEqual(readUpdateAction(null, JSON.stringify({ action: "apply" })), {
    ok: true,
    action: "apply",
  });
  assert.deepEqual(readUpdateAction(null, '{"action":"check"}'), { ok: true, action: "check" });
});

test("la stessa azione in tutti e due i posti va bene", () => {
  assert.deepEqual(readUpdateAction("apply", '{"action":"apply"}'), { ok: true, action: "apply" });
});

test("due azioni diverse: errore, non se ne sceglie una in silenzio", () => {
  const esito = readUpdateAction("restart", '{"action":"apply"}');
  assert.equal(esito.ok, false);
  assert.match(esito.ok ? "" : esito.error, /restart.*apply/);
});

test("azione mancante, sconosciuta o corpo non valido: errore in italiano", () => {
  const mancante = readUpdateAction(null, "");
  assert.equal(mancante.ok, false);
  assert.match(mancante.ok ? "" : mancante.error, /Azione mancante/);

  const ignota = readUpdateAction("rm", "");
  assert.equal(ignota.ok, false);
  assert.match(ignota.ok ? "" : ignota.error, /Azione non supportata/);

  const ignotaNelCorpo = readUpdateAction(null, '{"action":"rm"}');
  assert.equal(ignotaNelCorpo.ok, false);

  const nonJson = readUpdateAction(null, "action=apply");
  assert.equal(nonJson.ok, false);
  assert.match(nonJson.ok ? "" : nonJson.error, /JSON/);

  const tipoSbagliato = readUpdateAction(null, '{"action":1}');
  assert.equal(tipoSbagliato.ok, false);

  const nonOggetto = readUpdateAction(null, '["apply"]');
  assert.equal(nonOggetto.ok, false);
});
