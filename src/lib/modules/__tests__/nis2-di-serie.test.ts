/**
 * NIS2 spento di serie sulla ridotta (Riccardo, 08/11/2026: «SI» a spegnerlo di serie). La ridotta
 * si riconosce da /etc/da-appliance/versione.json, `"variante": "snella"`, scritto da Deploy-Appliance
 * e rinnovato a ogni aggiornamento. Una scelta fatta in Opzioni vince sempre; fuori da un'immagine e
 * sulla piena NIS2 resta acceso di serie, com'era.
 *
 * Run: node --import tsx --test src/lib/modules/__tests__/nis2-di-serie.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nis2Acceso, varianteImmagine } from "../nis2";

function conf(contenuto: string | null): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nis2-"));
  if (contenuto !== null) fs.writeFileSync(path.join(d, "versione.json"), contenuto);
  return d;
}

test("variante: snella dal file; senza chiave piena; senza file nessuna immagine; illeggibile non è snella", () => {
  assert.equal(varianteImmagine(conf(JSON.stringify({ versione: "2026.11.1", variante: "snella" }))), "snella");
  assert.equal(varianteImmagine(conf(JSON.stringify({ versione: "2026.10.25" }))), "piena");
  assert.equal(varianteImmagine(conf(null)), null);
  assert.equal(varianteImmagine(conf("{rotto")), "illeggibile");
});

test("sulla ridotta, mai toccato in Opzioni: NIS2 spento", () => {
  assert.equal(nis2Acceso(null, "snella"), false);
});

test("sulla piena, fuori da un'immagine o col file illeggibile: acceso di serie, com'era", () => {
  for (const v of ["piena", null, "illeggibile"] as const) assert.equal(nis2Acceso(null, v), true, String(v));
});

test("la scelta fatta in Opzioni vince sulla variante", () => {
  assert.equal(nis2Acceso("1", "snella"), true);
  assert.equal(nis2Acceso("true", "snella"), true);
  assert.equal(nis2Acceso("0", "piena"), false);
  assert.equal(nis2Acceso("0", null), false);
});
