process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-golden";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { encodeCookie, decodeCookie } from "@/lib/integrations/meshcentral/login-token";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "login-token.golden.json");

// C2: while this placeholder is present, NO live server has emitted a token,
// so the real interop assertion is SKIPPED (it would be a tautology — we both
// encode and decode). Replace it with a server-emitted token during Phase 0
// provisioning to turn this into a genuine interop guarantee (see fixtures/README.md).
const PLACEHOLDER = "__REGENERATE_AGAINST_LIVE_SERVER_PHASE0__";

interface Golden {
  key: string;
  token: string;
  expectedPayload: { u: string; a: number };
}

function loadGolden(): Golden {
  let raw: string;
  try {
    raw = readFileSync(fixturePath, "utf8");
  } catch (e) {
    throw new Error("golden fixture missing: " + (e as Error).message);
  }
  let parsed: Golden;
  try {
    parsed = JSON.parse(raw) as Golden;
  } catch (e) {
    throw new Error("golden fixture not valid JSON: " + (e as Error).message);
  }
  return parsed;
}

const usingPlaceholder = loadGolden().token === PLACEHOLDER;

test("golden: fixture key is the pinned 80-byte (160-hex) LoginCookieEncryptionKey", () => {
  const g = loadGolden();
  const key = Buffer.from(g.key, "hex");
  assert.equal(key.length, 80, "pinned LoginCookieEncryptionKey must be 80 bytes (160 hex)");
});

// Always green: exercises the decrypt MECHANISM (iv/tag/ct split, key.slice(0,32),
// @/$ reversal) against a self-seeded token. This is NOT a server-interop claim.
test("golden: codec self-seeds and decrypts a token to the exact payload (mechanism only)", () => {
  const g = loadGolden();
  const key = Buffer.from(g.key, "hex");
  if (usingPlaceholder) {
    // eslint-disable-next-line no-console
    console.log(
      "[golden] TODO Phase0: no live MeshCentral token committed — exercising decrypt MECHANISM only " +
        "(self-seeded, not a server-interop guarantee). Regenerate per fixtures/README.md.",
    );
  }
  const token = usingPlaceholder
    ? encodeCookie({ ...g.expectedPayload, time: 1719600000, expire: 3, once: 1 }, key)
    : g.token;

  let payload: Record<string, unknown>;
  try {
    payload = decodeCookie(token, key);
  } catch (e) {
    throw new Error("decrypted golden payload is not JSON (codec drift?): " + (e as Error).message);
  }

  assert.equal(payload.u, g.expectedPayload.u, "u must match the requested mesh user");
  assert.equal(payload.a, g.expectedPayload.a, "a must be 3 (login token action)");
  assert.equal(typeof payload.time, "number", "time must decode to a number (unix seconds)");
  assert.equal(typeof payload.expire, "number", "expire must decode to a number (minutes)");
});

// REAL interop guarantee: only runs once a server-emitted token replaces the
// placeholder. SKIPPED in Phase 0 so we never present a tautology as a guarantee.
test(
  "golden: OUR codec DECRYPTS a SERVER-emitted login token to the exact payload (real interop)",
  { skip: usingPlaceholder ? "Phase0: no live-server token committed yet (placeholder present)" : false },
  () => {
    const g = loadGolden();
    const key = Buffer.from(g.key, "hex");
    const payload = decodeCookie(g.token, key);
    assert.equal(payload.u, g.expectedPayload.u, "u must match the requested mesh user");
    assert.equal(payload.a, g.expectedPayload.a, "a must be 3 (login token action)");
    assert.equal(typeof payload.time, "number", "time must decode to a number (unix seconds)");
    assert.equal(typeof payload.expire, "number", "expire must decode to a number (minutes)");
  },
);
