/**
 * Contratto cifratura segreti integrazioni (WAVE 5 / token-at-rest).
 * Valida che encrypt() produca ciphertext riconoscibile e che il roundtrip torni,
 * così la read tollerante di config.ts (decifra ciphertext, passa il legacy plaintext)
 * è corretta. Non importa config.ts per evitare la catena db-hub in test.
 * Run: node --import tsx --test src/lib/integrations/__tests__/config-secret.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, safeDecrypt } from "../../crypto";

// Stesso pattern usato da config.ts isCiphertext()
const CIPHERTEXT_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

test("encrypt() produce ciphertext riconoscibile (iv:tag:enc)", () => {
  assert.match(encrypt("wazuh-api-token-123"), CIPHERTEXT_RE);
});

test("un token plaintext NON è scambiato per ciphertext", () => {
  assert.equal(CIPHERTEXT_RE.test("wazuh-api-token-123"), false);
  assert.equal(CIPHERTEXT_RE.test("admin"), false);
  assert.equal(CIPHERTEXT_RE.test(""), false);
});

test("roundtrip: safeDecrypt(encrypt(x)) === x", () => {
  const secret = "S3cr3t!Token_xyz-=/";
  assert.equal(safeDecrypt(encrypt(secret)), secret);
});

test("safeDecrypt su ciphertext corrotto → null (read degrada, non lancia)", () => {
  assert.equal(safeDecrypt("deadbeef:cafe:0011"), null);
});
