import { test } from "node:test";
import assert from "node:assert/strict";
import { afterLoadFailure, oraItaliana } from "@/lib/topology/load-state";

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
