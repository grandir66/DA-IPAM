/**
 * Gettone del terminale SSH (piano di sicurezza 14/11, P0-2 tappa C). Senza la chiave delle sessioni la firma
 * usava la chiave dei dati, e senza nessuna delle due una chiave vuota: un gettone firmato col vuoto lo
 * fabbrica chiunque. Ora senza chiave non si firma e non si accetta niente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signSshToken, verifySshToken } from "../token";

const P = { hostId: 7, tenantCode: "DEFAULT", userId: 1 };

function conAmbiente(env: Record<string, string | undefined>, f: () => void) {
  const prima = { a: process.env.AUTH_SECRET, n: process.env.NEXTAUTH_SECRET, e: process.env.ENCRYPTION_KEY };
  for (const k of ["AUTH_SECRET", "NEXTAUTH_SECRET", "ENCRYPTION_KEY"]) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try { f(); } finally {
    for (const [k, v] of [["AUTH_SECRET", prima.a], ["NEXTAUTH_SECRET", prima.n], ["ENCRYPTION_KEY", prima.e]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test("con la chiave delle sessioni il gettone si firma e si verifica", () => {
  conAmbiente({ AUTH_SECRET: "s".repeat(64) }, () => {
    assert.deepEqual({ ...verifySshToken(signSshToken(P)), exp: 0 }, { ...P, exp: 0 });
  });
});

test("senza chiave delle sessioni non si firma, e un gettone firmato col vuoto è rifiutato", () => {
  conAmbiente({}, () => {
    assert.throws(() => signSshToken(P));
    const body = Buffer.from(JSON.stringify({ ...P, exp: Date.now() + 60_000 })).toString("base64url");
    const falso = `${body}.${createHmac("sha256", "").update(body).digest("base64url")}`;
    assert.equal(verifySshToken(falso), null);
  });
});

test("la chiave dei dati non firma i gettoni: chi ha solo quella non ne fabbrica", () => {
  conAmbiente({ ENCRYPTION_KEY: "k".repeat(64) }, () => {
    assert.throws(() => signSshToken(P));
    const body = Buffer.from(JSON.stringify({ ...P, exp: Date.now() + 60_000 })).toString("base64url");
    const falso = `${body}.${createHmac("sha256", "k".repeat(64)).update(body).digest("base64url")}`;
    assert.equal(verifySshToken(falso), null);
  });
});
