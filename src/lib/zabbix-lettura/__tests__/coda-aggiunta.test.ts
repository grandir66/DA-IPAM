/**
 * La coda dell'aggiunta in massa (26/11/2026): tetto di 100 al giorno, ripresa il giorno dopo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTO_SCRITTURA } from "../scrittura";
import { durata, eTettoDelGiorno, giorniPer, leggiCoda, tolto } from "../coda-aggiunta";

const OGGI = new Date("2026-11-26T10:00:00Z");
const DOMANI = new Date("2026-11-27T00:05:00Z");

test("la coda salvata: il rotto è vuoto, le chiavi strane spariscono, il giorno nuovo azzera il contatore e tiene la coda", () => {
  assert.deepEqual(leggiCoda("{rotto", OGGI), { chiavi: [], giorno: "2026-11-26", aggiuntiOggi: 0 });
  const salvata = JSON.stringify({ chiavi: ["i:5", "z:9", "i:5", 7, "i:6"], giorno: "2026-11-26", aggiuntiOggi: 40 });
  assert.deepEqual(leggiCoda(salvata, OGGI), { chiavi: ["i:5", "i:6"], giorno: "2026-11-26", aggiuntiOggi: 40 });
  assert.deepEqual(leggiCoda(salvata, DOMANI), { chiavi: ["i:5", "i:6"], giorno: "2026-11-27", aggiuntiOggi: 0 });
});

test("chi esce dalla coda conta nel tetto solo se è entrato in Zabbix", () => {
  let c = leggiCoda(JSON.stringify({ chiavi: ["i:1", "i:2"], giorno: "2026-11-26", aggiuntiOggi: 99 }), OGGI);
  c = tolto(c, "i:1", true, OGGI);
  assert.deepEqual(c, { chiavi: ["i:2"], giorno: "2026-11-26", aggiuntiOggi: 100 });
  assert.deepEqual(tolto(c, "i:2", false, DOMANI), { chiavi: [], giorno: "2026-11-27", aggiuntiOggi: 0 });
});

test("il tetto del giorno si riconosce dal testo che la rotta dà davvero", () => {
  assert.equal(eTettoDelGiorno(TESTO_SCRITTURA.tetto_giornaliero), true);
  assert.equal(eTettoDelGiorno(TESTO_SCRITTURA.troppe_richieste), false);
});

test("stime: 474 apparati sono cinque giorni, e la durata si dice a parole", () => {
  assert.equal(giorniPer(474, 0), 5);
  assert.equal(giorniPer(60, 50), 2);
  assert.equal(giorniPer(50, 50), 1);
  assert.equal(durata(5), "meno di un minuto");
  assert.equal(durata(100), "circa 10 minuti");
});
