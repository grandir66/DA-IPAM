/**
 * Secondo giro di sicurezza, 16/11/2026. La conferma d'identità sugli utenti ferma dopo 5 password sbagliate, ma il
 * cambio password provava la stessa password senza limite: chi ha una sessione aperta la indovinava da lì.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { provaPasswordCorrente } from "../cambio-password";

test("cinque password sbagliate fermano anche quella giusta, per un po'", async () => {
  const hash = await bcrypt.hash("Quella-Giusta-2026", 4);
  const id = 990_001;
  for (let i = 0; i < 5; i++) assert.equal(await provaPasswordCorrente(id, hash, `sbagliata-${i}`), "sbagliata");
  assert.equal(await provaPasswordCorrente(id, hash, "Quella-Giusta-2026"), "fermo");
});

test("la password giusta passa e azzera il conto", async () => {
  const hash = await bcrypt.hash("Quella-Giusta-2026", 4);
  const id = 990_002;
  for (let i = 0; i < 4; i++) assert.equal(await provaPasswordCorrente(id, hash, "no"), "sbagliata");
  assert.equal(await provaPasswordCorrente(id, hash, "Quella-Giusta-2026"), "giusta");
  for (let i = 0; i < 4; i++) assert.equal(await provaPasswordCorrente(id, hash, "no"), "sbagliata");
  assert.equal(await provaPasswordCorrente(id, hash, "Quella-Giusta-2026"), "giusta");
});
