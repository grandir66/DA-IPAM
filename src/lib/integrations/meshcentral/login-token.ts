import crypto from "crypto";

/**
 * Port of MeshCentral `obj.encodeCookie` for login tokens (spec §9, rischio #1).
 *
 * Wire layout: iv[12] | authTag[16] | ciphertext, base64-encoded, then made
 * URL-safe with '+' -> '@' and '/' -> '$'. AES-256-GCM, key = key.slice(0,32).
 *
 * `key` MUST be the raw bytes of the MeshCentral LoginCookieEncryptionKey,
 * loaded as Buffer.from(<160-hex>, "hex") (80 bytes; NOT base64 — bug #2932).
 *
 * MVP cut (C9): this implements ONLY the default base64+`@$` encoding path that
 * matches `settings.CookieEncoding` = base64 (spec §4). The `CookieEncoding=hex`
 * branch and the `node meshcentral.js --logintoken` subprocess fallback (D8,
 * spec §9 points 4–5) are DEFERRED: a version/encoding drift that breaks this
 * codec is caught at runtime by `loginTokenSelfCheck()` failing loud (the server
 * rejects the token) rather than silently producing a dead launch-out.
 *
 * Exported (not just internal) so the codec tests can assert on the raw bytes
 * without depending on tenant config.
 */
export function encodeCookie(payload: Record<string, unknown>, key: Buffer): string {
  if (!Buffer.isBuffer(key) || key.length < 32) {
    throw new Error("meshcentral login-token: key must be a Buffer of >= 32 bytes");
  }
  const aesKey = key.subarray(0, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes
  const wire = Buffer.concat([iv, authTag, ciphertext]); // iv[12] | tag[16] | ct
  // URL-safe base64 the MeshCentral way: keep '=' padding, swap +/ -> @$.
  return wire.toString("base64").replace(/\+/g, "@").replace(/\//g, "$");
}

/**
 * Inverse of `encodeCookie`: decrypt a URL-safe login token back to its payload.
 *
 * Reverses the `@`->`+` / `$`->`/` substitution, splits iv[12]|authTag[16]|ct,
 * and AES-256-GCM-decrypts with key.slice(0,32). The GCM auth tag is verified,
 * so a tampered token (or wrong key) throws. Used by the codec round-trip tests
 * and available for future server-token validation.
 */
export function decodeCookie(token: string, key: Buffer): Record<string, unknown> {
  if (!Buffer.isBuffer(key) || key.length < 32) {
    throw new Error("meshcentral login-token: key must be a Buffer of >= 32 bytes");
  }
  const wire = Buffer.from(token.replace(/@/g, "+").replace(/\$/g, "/"), "base64");
  if (wire.length <= 12 + 16) {
    throw new Error("meshcentral login-token: token too short (missing iv/tag/ciphertext)");
  }
  const iv = wire.subarray(0, 12);
  const authTag = wire.subarray(12, 28);
  const ciphertext = wire.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as Record<string, unknown>;
}
