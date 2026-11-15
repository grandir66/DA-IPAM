/**
 * Codice di primo avvio (piano di sicurezza 14/11, P0-2 tappa D). Finché non esiste un utente, `POST /api/setup`
 * creava il primo superadmin a chiunque raggiungesse l'appliance. Se l'installatore ha lasciato il file del codice,
 * il primo avvio lo chiede; creato l'utente il file sparisce. Senza file resta com'era (installazioni fatte a mano).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "primo-avvio-"));
const FILE = path.join(DIR, "primo-avvio.codice");
process.env.DA_INVENT_PRIMO_AVVIO_FILE = FILE;

test("senza file il codice non è richiesto e ogni valore passa", async () => {
  const P = await import("../primo-avvio");
  assert.equal(P.codicePrimoAvvioRichiesto(), false);
  assert.equal(P.verificaCodicePrimoAvvio(undefined), true);
});

test("col file il codice è richiesto: quello giusto passa, sbagliato o assente no; consumato, il file sparisce", async () => {
  const P = await import("../primo-avvio");
  fs.writeFileSync(FILE, "K7QM-2XRA-9FHT\n", { mode: 0o600 });
  assert.equal(P.codicePrimoAvvioRichiesto(), true);
  assert.equal(P.verificaCodicePrimoAvvio(undefined), false);
  assert.equal(P.verificaCodicePrimoAvvio(""), false);
  assert.equal(P.verificaCodicePrimoAvvio("K7QM-2XRA-9FHX"), false);
  assert.equal(P.verificaCodicePrimoAvvio(" k7qm-2xra-9fht "), true, "come lo scrive una persona");
  P.consumaCodicePrimoAvvio();
  assert.equal(fs.existsSync(FILE), false);
  assert.equal(P.codicePrimoAvvioRichiesto(), false);
});

test("un file vuoto non apre il primo avvio a tutti: il codice resta richiesto e nessun valore passa", async () => {
  const P = await import("../primo-avvio");
  fs.writeFileSync(FILE, "\n");
  assert.equal(P.codicePrimoAvvioRichiesto(), true);
  assert.equal(P.verificaCodicePrimoAvvio(""), false);
  assert.equal(P.verificaCodicePrimoAvvio("qualcosa"), false);
  fs.rmSync(FILE);
});
