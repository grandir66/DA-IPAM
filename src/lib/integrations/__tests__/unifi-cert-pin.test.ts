// Rinnovo esplicito dell'impronta del certificato del controller UniFi (tappa
// 2, Task 7): l'azione «Accetta la nuova impronta» della card. Il client fissa
// l'impronta al primo uso e poi rifiuta un certificato diverso; cambiarla è
// una scelta dell'amministratore, che vede le due impronte e conferma.
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, setSetting } from "@/lib/db-hub";
import { acceptUnifiCertPin, unifiCertPinStore } from "../config";

// Impronte nella forma vera di `spkiPinFromDer`: sha256/ + base64 di 32 byte.
const PRIMA = `sha256/${Buffer.alloc(32, 1).toString("base64")}`;
const NUOVA = `sha256/${Buffer.alloc(32, 2).toString("base64")}`;
const TERZA = `sha256/${Buffer.alloc(32, 3).toString("base64")}`;

beforeEach(() => {
  setSetting("integration_unifi_cert_pin", "");
});

after(() => {
  closeHubDb();
  removeTestHubDb();
});

test("accetta l'impronta nuova al posto di quella fissata", () => {
  unifiCertPinStore.set(PRIMA);
  const r = acceptUnifiCertPin(NUOVA, PRIMA);
  assert.deepEqual(r, { ok: true, certPin: NUOVA });
  assert.equal(unifiCertPinStore.get(), NUOVA);
});

test("l'impronta senza prefisso si salva in forma canonica", () => {
  unifiCertPinStore.set(PRIMA);
  const r = acceptUnifiCertPin(NUOVA.slice("sha256/".length), PRIMA);
  assert.equal(r.ok, true);
  assert.equal(unifiCertPinStore.get(), NUOVA);
});

test("se nel frattempo l'impronta fissata è cambiata, si rifiuta (409) e non si sovrascrive", () => {
  unifiCertPinStore.set(TERZA);
  const r = acceptUnifiCertPin(NUOVA, PRIMA);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 409);
    assert.match(r.error, /cambiata nel frattempo/);
  }
  assert.equal(unifiCertPinStore.get(), TERZA);
});

test("«nessuna impronta fissata» vale come attesa: senza pin si accetta con replaces null", () => {
  assert.equal(unifiCertPinStore.get(), null);
  assert.deepEqual(acceptUnifiCertPin(NUOVA, null), { ok: true, certPin: NUOVA });
  // …ma non sopra un'impronta che c'è e che chi chiede non ha visto.
  assert.equal(acceptUnifiCertPin(PRIMA, null).ok, false);
  assert.equal(unifiCertPinStore.get(), NUOVA);
});

test("un'impronta malformata è un 400 e non tocca quella salvata", () => {
  unifiCertPinStore.set(PRIMA);
  for (const bad of ["", "sha256/", "sha256/corta=", "md5/" + NUOVA.slice(7), `${NUOVA}x`, "sha256/" + "!".repeat(43) + "="]) {
    const r = acceptUnifiCertPin(bad, PRIMA);
    assert.equal(r.ok, false, `«${bad}» doveva essere rifiutata`);
    if (!r.ok) assert.equal(r.status, 400);
  }
  assert.equal(unifiCertPinStore.get(), PRIMA);
});
