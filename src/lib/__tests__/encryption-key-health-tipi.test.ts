/**
 * Salute di ENCRYPTION_KEY sui tipi d'archivio (tappa 2 credenziali, T12, 16/10).
 *
 * Perché: il campione leggeva solo `encrypted_password`. Dalla 2c una voce
 * `snmp_v3` ha `encrypted_password` NULL (la chiave sta in
 * `encrypted_auth_key`) e l'utente in `encrypted_username`: un tenant con
 * sole voci v3 contava 0 credenziali, cioè «tutto bene» anche con la chiave
 * sbagliata.
 *
 * Run: node --import tsx --test src/lib/__tests__/encryption-key-health-tipi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";
import { probeEncryptionKeyHealth } from "@/lib/encryption-key-health";

const CHIAVE = "1".repeat(64);
const ALTRA = "2".repeat(64);

function datiConUnaV3(chiaveDellaVoce: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ipam-chiave-"));
  mkdirSync(join(dir, "tenants"));
  const db = new Database(join(dir, "tenants", "PROVA.db"));
  db.exec(`CREATE TABLE credentials (id INTEGER PRIMARY KEY, name TEXT, credential_type TEXT NOT NULL,
    encrypted_username TEXT, encrypted_password TEXT, encrypted_auth_key TEXT)`);
  process.env.ENCRYPTION_KEY = chiaveDellaVoce;
  db.prepare(`INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, encrypted_auth_key) VALUES ('v3', 'snmp_v3', ?, NULL, ?)`)
    .run(encrypt("monitor"), encrypt("chiave-auth"));
  db.close();
  return dir;
}

function conDati<T>(dir: string, fn: () => T): T {
  const prima = { dati: process.env.DA_INVENT_DATA_DIR, chiave: process.env.ENCRYPTION_KEY };
  process.env.DA_INVENT_DATA_DIR = dir;
  process.env.ENCRYPTION_KEY = CHIAVE;
  try {
    return fn();
  } finally {
    if (prima.dati === undefined) delete process.env.DA_INVENT_DATA_DIR;
    else process.env.DA_INVENT_DATA_DIR = prima.dati;
    if (prima.chiave === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prima.chiave;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("una voce SNMP v3 entra nel campione e, con la chiave giusta, è leggibile", () => {
  const h = conDati(datiConUnaV3(CHIAVE), () => probeEncryptionKeyHealth());
  assert.ok(h.credentialCount >= 1, `campione vuoto (${h.credentialCount}): la v3 non è stata letta`);
  assert.equal(h.ok, true);
});

test("una voce SNMP v3 cifrata con un'altra chiave fa diventare rossa la salute", () => {
  const h = conDati(datiConUnaV3(ALTRA), () => probeEncryptionKeyHealth());
  assert.equal(h.ok, false, "salute verde con una voce illeggibile");
});
