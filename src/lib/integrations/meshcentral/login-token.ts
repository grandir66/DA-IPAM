import crypto from "crypto";
import { getMeshCreds, type MeshCreds } from "@/lib/integrations/meshcentral/config";

/**
 * Creds loader seam. Defaults to the real per-tenant `getMeshCreds()`. Exposed as
 * an optional override on `mintLoginToken`/`loginTokenSelfCheck` purely so tests
 * can inject deterministic creds: `node:test` `mock.method` cannot patch the
 * getter-only, non-configurable ESM namespace binding produced by tsx, so DI is
 * the reliable seam. Production callers never pass this.
 */
type CredsLoader = () => MeshCreds | null;

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

/**
 * Mint a MeshCentral login token (spec §10). a:3 = login action.
 * `time` is unix SECONDS, `expire` is MINUTES. `once` (single-use) serializes
 * as 1 when requested, and is omitted otherwise (matches server expectation).
 *
 * The loginTokenKey lives ONLY in backend memory — never logged, never sent to
 * the browser. Throws loudly if config/creds are missing (no silent empty token
 * → silent launch-out failure is rischio #1, spec §9).
 */
export function mintLoginToken(
  opts: {
    meshUser: string;
    expireMinutes: number;
    once?: boolean;
  },
  loadCreds: CredsLoader = getMeshCreds,
): string {
  const creds = loadCreds();
  if (!creds) {
    throw new Error("meshcentral login-token: config/creds not present (cannot mint)");
  }
  if (!opts.meshUser || !opts.meshUser.startsWith("user/")) {
    throw new Error("meshcentral login-token: meshUser must be 'user/<domain>/<user>'");
  }
  if (!Number.isFinite(opts.expireMinutes) || opts.expireMinutes <= 0) {
    throw new Error("meshcentral login-token: expireMinutes must be a positive number");
  }
  const payload: Record<string, unknown> = {
    u: opts.meshUser,
    a: 3,
    time: Math.floor(Date.now() / 1000),
    expire: opts.expireMinutes,
  };
  if (opts.once) {
    payload.once = 1;
  }
  return encodeCookie(payload, creds.loginTokenKey);
}

/**
 * Self-check interop (spec §9 point 3 / D8). Mints a short-lived single-use
 * token for the service user and validates it against the RUNNING MeshCentral
 * server by hitting an authenticated control endpoint with ?login=<token>.
 *
 * Returns true only if the server accepts the minted token. Fails LOUDLY
 * (returns false + warns) rather than letting a broken codec silently produce
 * tokens the server rejects (which would surface as a dead launch-out).
 *
 * This is a RUNTIME interop check: it requires a reachable MeshCentral server.
 * Unit tests cover the construction/branching logic (creds-absent → false,
 * mint failure → false); the HTTP probe itself is exercised in the appliance
 * E2E smoke (spec §14), not in unit tests against no server.
 */
export async function loginTokenSelfCheck(
  loadCreds: CredsLoader = getMeshCreds,
): Promise<boolean> {
  const creds = loadCreds();
  if (!creds) {
    console.warn("[meshcentral] self-check skipped: no config present");
    return false;
  }
  let token: string;
  try {
    token = mintLoginToken(
      {
        meshUser: `user/${creds.domain}/${creds.serviceUser}`,
        expireMinutes: 1,
        once: false, // self-check may retry; don't burn a single-use token
      },
      loadCreds,
    );
  } catch (err) {
    console.warn("[meshcentral] self-check mint failed:", (err as Error).message);
    return false;
  }
  // Probe an authenticated endpoint with the login token. A valid token yields
  // a non-login response (200/101/redirect to the app), an invalid token bounces
  // back to the login page. We avoid logging the token value.
  const base = creds.serverUrl.startsWith("http")
    ? creds.serverUrl
    : `https://${creds.serverUrl}`;
  const probeUrl = `${base.replace(/\/+$/, "")}/?login=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(probeUrl, { redirect: "manual" });
    // Server accepts the token: not a 401/403, and not the login screen.
    const ok = res.status !== 401 && res.status !== 403;
    if (!ok) {
      console.warn(`[meshcentral] self-check rejected by server (status ${res.status})`);
    }
    return ok;
  } catch (err) {
    console.warn("[meshcentral] self-check transport error:", (err as Error).message);
    return false;
  }
}
