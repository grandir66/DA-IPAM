process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-mint";

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import type { MeshCreds } from "@/lib/integrations/meshcentral/config";
import {
  mintLoginToken,
  loginTokenSelfCheck,
} from "@/lib/integrations/meshcentral/login-token";

const HEX_KEY =
  "00112233445566778899aabbccddeeff" +
  "0123456789abcdef0123456789abcdef" +
  "fedcba9876543210fedcba9876543210" +
  "00112233445566778899aabbccddeeff" +
  "0123456789abcdef0123456789abcdef";

// DI seam: node:test mock.method cannot patch the getter-only, non-configurable
// ESM namespace export under tsx, so creds are injected directly (the function's
// optional loadCreds parameter). Production callers omit it and use getMeshCreds.
function credsStub(): MeshCreds {
  return {
    serverUrl: "mesh.appliance.local",
    domain: "mesh",
    meshId: "mesh//ABCDEF",
    serviceUser: "svc-daipam",
    loginTokenKey: Buffer.from(HEX_KEY, "hex"),
    adminUser: "admin",
    adminPass: "x",
  };
}

function decode(token: string, key: Buffer): Record<string, unknown> {
  const wire = Buffer.from(token.replace(/@/g, "+").replace(/\$/g, "/"), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), wire.subarray(0, 12));
  decipher.setAuthTag(wire.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(wire.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(pt) as Record<string, unknown>;
}

test("mintLoginToken: fields a:3, once, expire in minutes, time in unix seconds", () => {
  const before = Math.floor(Date.now() / 1000);
  const token = mintLoginToken(
    { meshUser: "user/mesh/svc-daipam", expireMinutes: 3, once: true },
    credsStub,
  );
  const after = Math.floor(Date.now() / 1000);

  const key = Buffer.from(HEX_KEY, "hex");
  const p = decode(token, key) as {
    u: string;
    a: number;
    time: number;
    expire: number;
    once?: number;
  };
  assert.equal(p.u, "user/mesh/svc-daipam");
  assert.equal(p.a, 3);
  assert.equal(p.expire, 3, "expire is in MINUTES");
  assert.equal(p.once, 1, "once must serialize as 1");
  assert.ok(p.time >= before && p.time <= after, "time must be unix SECONDS at mint time");
});

test("mintLoginToken: once omitted -> no 'once' field", () => {
  const token = mintLoginToken({ meshUser: "user/mesh/svc-daipam", expireMinutes: 10 }, credsStub);
  const p = decode(token, Buffer.from(HEX_KEY, "hex"));
  assert.equal("once" in p, false, "once must be absent when not requested");
});

test("mintLoginToken: throws loudly when config/creds absent (no silent empty token)", () => {
  assert.throws(
    () => mintLoginToken({ meshUser: "user/mesh/svc", expireMinutes: 3, once: true }, () => null),
    /meshcentral.*config|creds/i,
  );
});

test("mintLoginToken: rejects malformed meshUser (must start with 'user/')", () => {
  assert.throws(
    () => mintLoginToken({ meshUser: "svc-daipam", expireMinutes: 3 }, credsStub),
    /meshUser/i,
  );
});

test("mintLoginToken: rejects non-positive expireMinutes", () => {
  assert.throws(
    () => mintLoginToken({ meshUser: "user/mesh/svc", expireMinutes: 0 }, credsStub),
    /expireMinutes/i,
  );
});

// ── loginTokenSelfCheck branching logic (runtime HTTP probe is E2E-only, spec §14) ──

test("loginTokenSelfCheck: returns false (no throw) when creds absent", async () => {
  const ok = await loginTokenSelfCheck(() => null);
  assert.equal(ok, false, "must fail loud-but-safe (false) when no config present");
});

test("loginTokenSelfCheck: returns false when mint fails (bad service user)", async () => {
  // serviceUser empty + domain empty → meshUser 'user//' still starts with 'user/',
  // so force a mint failure another way: creds with a key shorter than 32 bytes.
  const bad: MeshCreds = { ...credsStub(), loginTokenKey: Buffer.alloc(16) };
  const ok = await loginTokenSelfCheck(() => bad);
  assert.equal(ok, false, "must return false (not throw) when token minting fails");
});
