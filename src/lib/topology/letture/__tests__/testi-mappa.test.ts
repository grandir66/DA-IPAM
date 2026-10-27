// I testi di «Mappa nuova (una linea per cavo)» (spec §13.11.4, T3.7): lo stato in parole con l'ora italiana (estate
// +2, inverno +1), il dialogo alla lettera, uno per l'accensione e uno per lo spegnimento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TITOLO_MAPPA, testoDialogoMappa, testoStatoMappa } from "@/lib/topology/letture/testi-mappa";

test("lo stato: spenta, e accesa con il giorno e l'ora italiana (estate +2, inverno +1)", () => {
  assert.equal(TITOLO_MAPPA, "Mappa nuova (una linea per cavo)");
  assert.equal(testoStatoMappa({ acceso: false, da: null, il: null }), "Spenta: si vede la mappa di prima.");
  assert.equal(testoStatoMappa({ acceso: true, da: "Mario", il: "2026-10-16 08:00:00" }), "Accesa dal 16/10 alle 10:00 da Mario.");
  assert.equal(testoStatoMappa({ acceso: true, da: "Mario", il: "2026-10-27T08:00:00Z" }), "Accesa dal 27/10 alle 09:00 da Mario.");
  assert.equal(testoStatoMappa({ acceso: true, da: null, il: null }), "Accesa dal — da utente non noto.");
});

test("il dialogo: accendere e spegnere, alla lettera", () => {
  assert.equal(testoDialogoMappa(true),
    "Con la mappa nuova ogni cavo è una linea sua, con la sua parola (bloccato, instradato, giù, fascio, tunnel, ponte radio); un segmento non gestito è un oggetto; l'albero segue lo spanning tree. Vale solo per questo cliente. Prima di accendere, ogni differenza di «Cosa cambierebbe con la mappa nuova» dovrebbe essere spiegata. Si spegne da Opzioni: torna la mappa di prima, nessun dato si perde.");
  assert.equal(testoDialogoMappa(false), "Torna la mappa di prima (una linea per coppia). Le correzioni fatte con la mappa nuova restano salvate.");
});
