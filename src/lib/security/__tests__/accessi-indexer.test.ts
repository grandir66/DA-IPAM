/**
 * Accessi falliti della dashboard dagli istogrammi dell'indexer (Riccardo, 20/10).
 *
 * Prima la dashboard ripartiva ogni gruppo d'allarme sulla sua durata: 24 barre quasi
 * uguali (massimo 13 in un'ora sull'hub), i picchi sparivano per costruzione. L'indexer
 * conta le ore davvero; i suoi bucket sono in UTC, i giorni si sommano in ora italiana.
 *
 * Run: node --import tsx --test src/lib/security/__tests__/accessi-indexer.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessiDaSerie } from "../accessi-indexer";

const ORA = new Date("2026-10-20T10:25:00.000Z"); // 12:25 italiane (ora legale)
const b = (iso: string, n: number, altro = 0) => ({ bucket: iso, auth_failure: n, ransomware: altro });

test("24 punti ora per ora, l'ultimo è l'ora in corso, le ore mancanti valgono 0", () => {
  const r = accessiDaSerie([b("2026-10-20T10:00:00.000Z", 7, 99), b("2026-10-20T08:00:00.000Z", 3)], ORA);
  assert.equal(r.ore.length, 24);
  assert.deepEqual(r.ore[23], { ora: "12", falliti: 7 });
  assert.deepEqual(r.ore[22], { ora: "11", falliti: 0 });
  assert.deepEqual(r.ore[21], { ora: "10", falliti: 3 });
  assert.equal(r.ore[0].ora, "13");
  assert.equal(r.totale24h, 10, "solo auth_failure, non le altre categorie");
});

test("le 24 ore prima: dalla 47ª alla 24ª ora indietro, escluse le altre", () => {
  const r = accessiDaSerie(
    [
      b("2026-10-19T11:00:00.000Z", 5), // 23 ore fa: dentro le ultime 24
      b("2026-10-19T10:00:00.000Z", 4), // 24 ore fa: nelle 24 prima
      b("2026-10-18T11:00:00.000Z", 2), // 47 ore fa: nelle 24 prima
      b("2026-10-18T10:00:00.000Z", 1), // 48 ore fa: fuori
    ],
    ORA,
  );
  assert.equal(r.totale24h, 5);
  assert.equal(r.totale24hPrima, 6);
});

test("tendenza su blocchi di 24 ore piene: l'ora in corso non la fa pendere verso «giù»", () => {
  // 10 all'ora costanti per 49 ore: l'ora in corso (parziale) ne ha solo 2.
  const righe = Array.from({ length: 49 }, (_, k) => b(new Date(Date.parse("2026-10-20T10:00:00.000Z") - (k + 1) * 3_600_000).toISOString(), 10));
  righe.push(b("2026-10-20T10:00:00.000Z", 2));
  assert.equal(accessiDaSerie(righe, ORA).tendenza, "pari");
  righe.push(b("2026-10-19T12:00:00.000Z", 5)); // 22 ore fa: un picco nelle ultime 24 piene
  assert.equal(accessiDaSerie(righe, ORA).tendenza, "su");
});

test("14 giorni in ora italiana: le 23:00 UTC del 19 sono l'1:00 del 20", () => {
  const r = accessiDaSerie([b("2026-10-19T23:00:00.000Z", 8), b("2026-10-19T21:00:00.000Z", 2), b("2026-10-06T22:00:00.000Z", 50)], ORA);
  assert.equal(r.giorni.length, 14);
  assert.deepEqual(r.giorni[13], { giorno: "2026-10-20", falliti: 8 });
  assert.deepEqual(r.giorni[12], { giorno: "2026-10-19", falliti: 2 });
  assert.equal(r.giorni[0].giorno, "2026-10-07");
  assert.equal(r.giorni[0].falliti, 50, "le 22:00 UTC del 6 sono la mezzanotte del 7");
});

test("serie vuota: tutto a zero, nessun errore", () => {
  const r = accessiDaSerie([], ORA);
  assert.equal(r.totale24h, 0);
  assert.equal(r.giorni.every((g) => g.falliti === 0), true);
});
