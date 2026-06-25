// src/lib/transfer/__tests__/roundtrip.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";

function freshTenant(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function freshHub(): Database.Database {
  const d = new Database(":memory:");
  d.exec(HUB_SCHEMA_SQL);
  return d;
}

test("export con chiave A → import con chiave B: secret decifrabili, conteggi coerenti", async () => {
  // --- Installazione SORGENTE, chiave A ---
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  // import dinamico DOPO aver settato la env (i moduli leggono process.env al volo)
  const { exportTenant } = await import("../export");
  const cryptoA = await import("@/lib/crypto");

  const srcTenant = freshTenant();
  const srcHub = freshHub();
  srcTenant.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  srcTenant.prepare(
    "INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?,?,?,?)",
  ).run("ssh-root", "ssh", cryptoA.encrypt("root"), cryptoA.encrypt("p@ss"));

  const bundle = exportTenant({
    tenantDb: srcTenant, hubDb: srcHub,
    options: {
      tenantCode: "DEFAULT", tiers: ["asset", "mirror"], includeVault: false,
      passphrase: "trasporto-123", exportedAt: "2026-06-25T10:00:00.000Z", appVersion: "test",
    },
  });
  assert.ok(bundle.length > 0);

  // --- Installazione DESTINAZIONE, chiave B (diversa) ---
  process.env.ENCRYPTION_KEY = "B".repeat(64);
  const { importTenant } = await import("../import");
  const cryptoB = await import("@/lib/crypto");

  const dstTenant = freshTenant();
  // FK enforcement ON prima dell'import: verifica che importTenant gestisca il toggle FK fuori dalla transazione
  dstTenant.pragma("foreign_keys = ON");
  const dstHub = freshHub();
  const res = importTenant({
    bundle, tenantDb: dstTenant, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "trasporto-123", wipe: false },
  });

  // conteggi
  assert.equal(res.tables.networks, 1);
  assert.equal(res.tables.credentials, 1);
  assert.equal(res.rekeyedSecrets, 2);

  // il secret è ora cifrato con la chiave B e decifrabile con essa
  const cred = dstTenant.prepare("SELECT encrypted_username, encrypted_password FROM credentials").get() as {
    encrypted_username: string; encrypted_password: string;
  };
  assert.equal(cryptoB.decrypt(cred.encrypted_username), "root");
  assert.equal(cryptoB.decrypt(cred.encrypted_password), "p@ss");

  // integrità
  assert.equal(dstTenant.pragma("integrity_check", { simple: true }), "ok");
});

test("passphrase errata → import fallisce", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const src = freshTenant(); const srcHub = freshHub();
  src.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  const bundle = exportTenant({
    tenantDb: src, hubDb: srcHub,
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "giusta", exportedAt: "2026-06-25T10:00:00.000Z", appVersion: "test" },
  });
  const dst = freshTenant(); const dstHub = freshHub();
  assert.throws(() => importTenant({
    bundle, tenantDb: dst, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "SBAGLIATA", wipe: false },
  }), /Passphrase errata/);
});
