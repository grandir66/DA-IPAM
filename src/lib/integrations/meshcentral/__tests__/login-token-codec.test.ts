process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-codec";

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { encodeCookie } from "@/lib/integrations/meshcentral/login-token";

// 160-hex (80-byte) pinned key like MeshCentral LoginCookieEncryptionKey.
const HEX_KEY =
  "00112233445566778899aabbccddeeff" +
  "0123456789abcdef0123456789abcdef" +
  "fedcba9876543210fedcba9876543210" +
  "00112233445566778899aabbccddeeff" +
  "0123456789abcdef0123456789abcdef";

function urlSafeToB64(s: string): string {
  return s.replace(/@/g, "+").replace(/\$/g, "/");
}

test("encodeCookie: layout iv[12]|authTag[16]|ciphertext, AES-256-GCM, key.slice(0,32), round-trips", () => {
  const key = Buffer.from(HEX_KEY, "hex");
  assert.equal(key.length, 80); // 160 hex chars

  const ONCE_UUID = "550e8400-e29b-41d4-a716-446655440000";
  const payload = { u: "user/mesh/svc-daipam", a: 3, time: 1719600000, expire: 3, once: ONCE_UUID };
  const token = encodeCookie(payload, key);

  // URL-safe alphabet only: no '+' and no '/' in output.
  assert.equal(/[+/]/.test(token), false, "token must be URL-safe (@/$)");

  // Reverse the URL-safe substitution and decode the raw bytes.
  const raw = Buffer.from(urlSafeToB64(token), "base64");
  assert.ok(raw.length > 12 + 16, "raw must contain iv + tag + at least 1 ciphertext byte");

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);

  // Decrypt with the SAME contract: AES-256-GCM, key = first 32 bytes.
  const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt) as typeof payload;

  assert.equal(parsed.u, "user/mesh/svc-daipam");
  assert.equal(parsed.a, 3);
  assert.equal(parsed.time, 1719600000);
  assert.equal(parsed.expire, 3);
  assert.equal(typeof parsed.once, "string", "once must be a string (UUID dedup key)");
  assert.equal(parsed.once, ONCE_UUID);
});

test("encodeCookie: tampering the authTag breaks decryption (GCM integrity)", () => {
  const key = Buffer.from(HEX_KEY, "hex");
  const token = encodeCookie({ u: "user/mesh/svc", a: 3, time: 1, expire: 3 }, key);
  const raw = Buffer.from(urlSafeToB64(token), "base64");
  raw[12] ^= 0xff; // flip a byte inside the authTag region [12..28)
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  decipher.setAuthTag(tag);
  assert.throws(() => Buffer.concat([decipher.update(ct), decipher.final()]));
});

// ── Task 21: @/$ URL-safe substitution + hex-key load assertions ──

test("encodeCookie: output never contains '+' or '/', and @/$ map back to +//", () => {
  const key = Buffer.from(HEX_KEY, "hex");
  // Run many encodings; random IVs make raw base64 hit '+' and '/' with high probability.
  let sawAt = false;
  let sawDollar = false;
  for (let i = 0; i < 200; i++) {
    const token = encodeCookie({ u: "user/mesh/svc", a: 3, time: i, expire: 3, once: "dedup-key" }, key);
    assert.equal(token.includes("+"), false, "token must not contain '+'");
    assert.equal(token.includes("/"), false, "token must not contain '/'");
    if (token.includes("@")) sawAt = true;
    if (token.includes("$")) sawDollar = true;
  }
  assert.ok(sawAt, "expected at least one '@' substitution across 200 encodings");
  assert.ok(sawDollar, "expected at least one '$' substitution across 200 encodings");
});

test("encodeCookie: '=' base64 padding is preserved (not stripped)", () => {
  const key = Buffer.from(HEX_KEY, "hex");
  // Some payload lengths produce '=' padding; assert it survives intact.
  let sawPadding = false;
  for (let i = 0; i < 50; i++) {
    const token = encodeCookie({ u: "user/mesh/svc-" + i, a: 3, time: i, expire: 3 }, key);
    const raw = Buffer.from(token.replace(/@/g, "+").replace(/\$/g, "/"), "base64");
    // Re-encode and compare to confirm round-trip integrity of the alphabet.
    const reEncoded = raw.toString("base64").replace(/\+/g, "@").replace(/\//g, "$");
    assert.equal(reEncoded, token, "url-safe encoding must be a faithful, reversible mapping");
    if (token.endsWith("=")) sawPadding = true;
  }
  assert.ok(sawPadding, "expected at least one '=' padded token");
});

test("encodeCookie: key MUST be loaded from hex (Buffer.from(hex)), base64-loaded key fails decrypt", () => {
  const hexKey = Buffer.from(HEX_KEY, "hex"); // correct: 80 bytes
  // Wrong load: interpreting the same 160-char string as base64 yields different bytes.
  const wrongKey = Buffer.from(HEX_KEY, "base64");
  assert.notEqual(wrongKey.length, hexKey.length, "base64 misload must differ from hex load");

  const token = encodeCookie({ u: "user/mesh/svc", a: 3, time: 7, expire: 3, once: "dedup-key" }, hexKey);
  const raw = Buffer.from(token.replace(/@/g, "+").replace(/\$/g, "/"), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);

  // Decrypting with the wrong (base64-loaded) key MUST fail the GCM tag.
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    // pad/truncate to 32 so createDecipheriv accepts it, proving it's the WRONG bytes
    Buffer.concat([wrongKey, Buffer.alloc(32)]).subarray(0, 32),
    iv,
  );
  decipher.setAuthTag(tag);
  assert.throws(() => Buffer.concat([decipher.update(ct), decipher.final()]));
});

test("encodeCookie: tampering key bytes 33+ does NOT change output (only first 32 used)", () => {
  const key = Buffer.from(HEX_KEY, "hex");
  // Build a key identical in the first 32 bytes but different from byte 33 onward.
  const tamperedKey = Buffer.from(key);
  for (let i = 32; i < tamperedKey.length; i++) tamperedKey[i] ^= 0xff;

  const payload = { u: "user/mesh/svc", a: 3, time: 42, expire: 3 };
  // Same key.slice(0,32) → both tokens must decrypt with the same AES key.
  const token = encodeCookie(payload, tamperedKey);
  const raw = Buffer.from(token.replace(/@/g, "+").replace(/\$/g, "/"), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt) as typeof payload;
  assert.equal(parsed.u, "user/mesh/svc");
  assert.equal(parsed.time, 42);
});

test("encodeCookie: rejects keys shorter than 32 bytes", () => {
  assert.throws(() => encodeCookie({ u: "x", a: 3, time: 1, expire: 3 }, Buffer.alloc(16)));
});
