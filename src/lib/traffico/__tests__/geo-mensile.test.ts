/**
 * Archivio DB-IP aggiornato da solo ogni mese (Riccardo, 24/11/2026). Nessuna richiesta vera: `fetch` è finta.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/geo-mensile.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { aggiornaGeoSeServe, chiudiGeo, scaricaGeo, statoGeo } from "@/lib/traffico/geo";

const vera = globalThis.fetch;
after(() => { globalThis.fetch = vera; chiudiGeo(); });

const righe = (coda: string): Buffer =>
  gzipSync(Array.from({ length: 10001 }, (_, i) => `11.${i >> 8}.${i & 255}.0,11.${i >> 8}.${i & 255}.255,${coda}`).join("\n"));
const chieste: string[] = [];
let usciti = ["2026-11"];
globalThis.fetch = (async (u: string | URL) => {
  const nome = String(u).split("/").at(-1)!;
  chieste.push(nome);
  if (!usciti.some((m) => nome.includes(m))) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(righe(nome.includes("asn") ? '1234,"Prova"' : "IT")));
}) as typeof fetch;

test("senza archivio non scarica niente; col mese giusto nemmeno; col mese nuovo una volta; non uscito, tiene il vecchio", async () => {
  assert.equal(await aggiornaGeoSeServe(new Date("2026-11-24T05:23:00Z")), null);
  assert.deepEqual(chieste, []);

  // a mano, due volte insieme: uno scaricamento solo
  await Promise.all([scaricaGeo(new Date("2026-11-24T08:00:00Z")), scaricaGeo(new Date("2026-11-24T08:00:00Z"))]);
  assert.equal(statoGeo().mese, "2026-11");
  assert.equal(chieste.length, 2);

  assert.equal(await aggiornaGeoSeServe(new Date("2026-11-30T05:23:00Z")), null);
  assert.equal(chieste.length, 2);

  // dicembre non è ancora uscito: errore, l'archivio di novembre resta e non viene riscaricato
  await assert.rejects(aggiornaGeoSeServe(new Date("2026-12-01T05:23:00Z")));
  assert.equal(statoGeo().mese, "2026-11");
  assert.equal(statoGeo().paesi, 10001);
  assert.deepEqual(chieste.slice(2), ["dbip-country-lite-2026-12.csv.gz"]);

  usciti = ["2026-12"];
  assert.equal((await aggiornaGeoSeServe(new Date("2026-12-02T05:23:00Z")))?.mese, "2026-12");
  assert.equal(await aggiornaGeoSeServe(new Date("2026-12-03T05:23:00Z")), null);
});
