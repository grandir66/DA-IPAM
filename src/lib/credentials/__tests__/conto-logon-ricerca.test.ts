/**
 * Il conto dei logon rifiutati: per password dentro l'utente, e la mappa non cresce (revisione finale, 04/11/2026).
 *
 * Con un conto unico per utente la voce giusta azzerava a ogni host quella sbagliata dello stesso account, e il limite di 3
 * non scattava mai: è il difetto che `legaAccount` risolve nel budget. La pulizia guardava solo l'utente della richiesta:
 * gli utenti che non tornano restavano in memoria per sempre.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/conto-logon-ricerca.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContoLogonRicerca, FINESTRA_LOGON_MS, MAX_LOGON_RIFIUTATI } from "../conto-logon-ricerca";

function rifiuta(conto: ContoLogonRicerca, utente: string, chiave: string): void {
  const p = conto.prenota(utente, chiave);
  assert.ok(p.ok);
  p.rifiutato();
}

describe("rifiuti per password, somma per utente", () => {
  it("due password dello stesso utente sommano sul limite", () => {
    const conto = new ContoLogonRicerca();
    rifiuta(conto, "mario@dom", "mario@dom|a");
    rifiuta(conto, "mario@dom", "mario@dom|a");
    rifiuta(conto, "mario@dom", "mario@dom|b");
    assert.equal(conto.prenota("mario@dom", "mario@dom|c").ok, false);
  });

  it("il successo di una password non azzera i rifiuti dell'altra", () => {
    const conto = new ContoLogonRicerca();
    rifiuta(conto, "mario@dom", "mario@dom|sbagliata");
    rifiuta(conto, "mario@dom", "mario@dom|sbagliata");
    const giusta = conto.prenota("mario@dom", "mario@dom|giusta");
    assert.ok(giusta.ok);
    giusta.riuscito();
    rifiuta(conto, "mario@dom", "mario@dom|sbagliata");
    assert.equal(conto.prenota("mario@dom", "mario@dom|sbagliata").ok, false, "prima il successo azzerava tutto, e il limite non scattava mai");
  });

  it("il successo azzera la sua password", () => {
    const conto = new ContoLogonRicerca();
    rifiuta(conto, "mario@dom", "mario@dom|a");
    rifiuta(conto, "mario@dom", "mario@dom|a");
    const p = conto.prenota("mario@dom", "mario@dom|a");
    assert.ok(p.ok);
    p.riuscito();
    for (let i = 0; i < MAX_LOGON_RIFIUTATI; i++) rifiuta(conto, "mario@dom", "mario@dom|a");
  });

  it("l'attesa è quella del rifiuto che libera un posto, fra tutte le password", () => {
    let ora = 0;
    const conto = new ContoLogonRicerca(() => ora);
    rifiuta(conto, "mario@dom", "mario@dom|b");
    ora = 1000;
    rifiuta(conto, "mario@dom", "mario@dom|a");
    ora = 2000;
    rifiuta(conto, "mario@dom", "mario@dom|b");
    const fermata = conto.prenota("mario@dom", "mario@dom|c");
    assert.equal(fermata.ok, false);
    assert.equal(!fermata.ok && fermata.attesaMs, FINESTRA_LOGON_MS - 2000);
  });
});

describe("la mappa non cresce", () => {
  it("prenota toglie gli utenti scaduti, anche quelli che non tornano", () => {
    let ora = 0;
    const conto = new ContoLogonRicerca(() => ora);
    for (let i = 0; i < 50; i++) rifiuta(conto, `utente-${i}@dom`, `utente-${i}@dom|a`);
    ora = FINESTRA_LOGON_MS + 1;
    rifiuta(conto, "nuovo@dom", "nuovo@dom|a");
    const { utenti } = conto as unknown as { utenti: Map<string, unknown> };
    assert.deepEqual([...utenti.keys()], ["nuovo@dom"]);
  });

  it("un utente con un logon in corso resta, anche senza rifiuti", () => {
    let ora = 0;
    const conto = new ContoLogonRicerca(() => ora);
    const p = conto.prenota("lento@dom", "lento@dom|a");
    assert.ok(p.ok);
    ora = FINESTRA_LOGON_MS + 1;
    rifiuta(conto, "altro@dom", "altro@dom|a");
    const { utenti } = conto as unknown as { utenti: Map<string, unknown> };
    assert.ok(utenti.has("lento@dom"));
    p.rifiutato();
    assert.equal(conto.prenota("lento@dom", "lento@dom|a").ok, true);
  });
});
