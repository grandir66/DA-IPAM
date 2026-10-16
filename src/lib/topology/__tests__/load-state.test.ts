import { test } from "node:test";
import assert from "node:assert/strict";
import { afterLoadFailure, oraItaliana, reloadOnReturn, RETURN_DEDUPE_MS } from "@/lib/topology/load-state";

test("il primo caricamento fallito è un errore pieno (niente mappa da mostrare)", () => {
  assert.deepEqual(afterLoadFailure(false, "Server non raggiungibile", 0), { kind: "error", message: "Server non raggiungibile" });
});

test("un aggiornamento fallito con la mappa già a schermo la tiene e lo dice con l'ora", () => {
  const at = Date.parse("2026-10-13T17:05:00Z");
  assert.deepEqual(afterLoadFailure(true, "Errore del server (HTTP 500)", at), {
    kind: "refresh",
    message: "Errore del server (HTTP 500)",
    at,
  });
});

test("l'ora dell'avviso è italiana, non quella della macchina (estate +2, inverno +1)", () => {
  assert.equal(oraItaliana(Date.parse("2026-10-13T17:05:00Z")), "19:05");
  assert.equal(oraItaliana(Date.parse("2026-12-01T08:30:00Z")), "09:30");
});

/*
 * Difetto 2026-10-15 (v0.3.285, Riccardo): «l'elenco degli oggetti non si aggiorna da solo». La pagina si
 * rileggeva al montaggio, dopo le proprie scritture e ogni 30 s: tornando sulla scheda (o sulla finestra)
 * dopo aver lavorato altrove, elenco e mappa restavano quelli di prima fino al giro successivo (25,9 s
 * misurati). Ora il ritorno rilegge subito.
 */
test("tornando sulla pagina visibile si rilegge subito", () => {
  assert.equal(reloadOnReturn(true, null, 1_000_000), true);
  assert.equal(reloadOnReturn(true, 1_000_000 - 60_000, 1_000_000), true);
});

test("una pagina nascosta non rilegge al ritorno (lo fa quando torna visibile)", () => {
  assert.equal(reloadOnReturn(false, null, 1_000_000), false);
});

test("scheda di nuovo visibile e finestra a fuoco arrivano insieme: una lettura sola", () => {
  const t = 1_000_000;
  assert.equal(reloadOnReturn(true, t, t + 50), false);
  assert.equal(reloadOnReturn(true, t, t + RETURN_DEDUPE_MS - 1), false);
  assert.equal(reloadOnReturn(true, t, t + RETURN_DEDUPE_MS), true);
});
