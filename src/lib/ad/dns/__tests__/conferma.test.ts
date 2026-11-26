/**
 * Conferma legata all'anteprima: vale solo per quei passi, quell'utente, quel dominio, per 5 minuti.
 *
 * Run: node --import tsx --test src/lib/ad/dns/__tests__/conferma.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DURATA_CONFERMA_MS, firmaConferma, verificaConferma, type DatiConferma } from "../conferma";
import type { Correzione } from "../correzioni";

const ADESSO = 1_800_000_000_000;
const C: Correzione = { id: "a_senza_ptr:192.168.4.10#crea:pc-01.esempio.local", chiaveAnomalia: "a_senza_ptr:192.168.4.10", titolo: "Crea il reverse", toglieDati: false,
  passi: [{ azione: "aggiungi", zona: "4.168.192.in-addr.arpa", nome: "10", tipo: "PTR", dato: "pc-01.esempio.local" }] };
const dati = (parziale: Partial<DatiConferma> = {}): DatiConferma => ({ integrazione: 1, utente: "riccardo", scade: ADESSO + DURATA_CONFERMA_MS, correzioni: [C], ...parziale });
const G = firmaConferma(dati(), "segreto");
const motivo = (d: DatiConferma, g = G, adesso = ADESSO) => { const r = verificaConferma(d, g, "segreto", adesso); return r.ok ? "ok" : r.motivo; };

describe("conferma dell'anteprima", () => {
  it("gli stessi dati entro la scadenza passano", () => assert.equal(motivo(dati()), "ok"));
  it("scaduta", () => assert.match(motivo(dati(), G, ADESSO + DURATA_CONFERMA_MS + 1), /scaduta/));
  it("un passo diverso, un utente diverso, un dominio diverso: rifiutata", () => {
    const altro: Correzione = { ...C, passi: [{ ...C.passi[0]!, dato: "altro.esempio.local" }] };
    assert.match(motivo(dati({ correzioni: [altro] })), /cambiati/);
    assert.match(motivo(dati({ correzioni: [C, altro] })), /cambiati/);
    assert.match(motivo(dati({ utente: "altro" })), /cambiati/);
    assert.match(motivo(dati({ integrazione: 2 })), /cambiati/);
  });
  it("scadenza allungata a mano o gettone malformato: rifiutata", () => {
    const lunga = dati({ scade: ADESSO + 3_600_000 });
    assert.equal(verificaConferma(lunga, firmaConferma(lunga, "segreto"), "segreto", ADESSO).ok, false);
    assert.match(motivo(dati(), "zz"), /cambiati/);
    assert.match(motivo(dati(), ""), /cambiati/);
  });
  it("senza segreto del servizio non si firma", () => assert.throws(() => firmaConferma(dati(), ""), /Segreto/));
});
