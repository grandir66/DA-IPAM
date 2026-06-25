// src/lib/transfer/__tests__/roundtrip.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import { rekeyColumns } from "../schema-introspect";
import { tableSpec } from "../table-registry";

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

test("network_devices cross-key: community_string + api_token + encrypted_password ri-cifrati con chiave B", async () => {
  // --- Installazione SORGENTE, chiave A ---
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant: exportA } = await import("../export");
  const cryptoA = await import("@/lib/crypto");

  const srcTenant = freshTenant();
  const srcHub = freshHub();
  srcTenant.prepare(
    `INSERT INTO network_devices
      (name, host, device_type, vendor, protocol, community_string, api_token, encrypted_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-core", "10.0.0.1", "switch", "hp", "snmp_v2",
    cryptoA.encrypt("public-snmp"),
    cryptoA.encrypt("tok-123"),
    cryptoA.encrypt("devpass"),
  );

  const bundle = exportA({
    tenantDb: srcTenant, hubDb: srcHub,
    options: {
      tenantCode: "DEFAULT", tiers: [], includeVault: false,
      passphrase: "x-key-test", exportedAt: "2026-06-26T00:00:00.000Z", appVersion: "test",
    },
  });

  // --- Installazione DESTINAZIONE, chiave B ---
  process.env.ENCRYPTION_KEY = "B".repeat(64);
  const { importTenant: importB } = await import("../import");
  const cryptoB = await import("@/lib/crypto");

  const dstTenant = freshTenant();
  dstTenant.pragma("foreign_keys = ON");
  const dstHub = freshHub();

  const res = importB({
    bundle, tenantDb: dstTenant, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "x-key-test", wipe: false },
  });

  // deve aver ri-cifrato i 3 campi secret della riga
  assert.equal(res.tables.network_devices, 1, "riga importata");
  assert.ok(res.rekeyedSecrets >= 3, `rekeyedSecrets deve essere >= 3, got ${res.rekeyedSecrets}`);

  const row = dstTenant.prepare(
    "SELECT community_string, api_token, encrypted_password FROM network_devices",
  ).get() as { community_string: string; api_token: string; encrypted_password: string };

  assert.equal(cryptoB.decrypt(row.community_string), "public-snmp", "community_string decifrabile con chiave B");
  assert.equal(cryptoB.decrypt(row.api_token), "tok-123", "api_token decifrabile con chiave B");
  assert.equal(cryptoB.decrypt(row.encrypted_password), "devpass", "encrypted_password decifrabile con chiave B");

  assert.equal(dstTenant.pragma("integrity_check", { simple: true }), "ok");
});

test("guard: ogni colonna cifrata nota è nel rekey-set effettivo (heuristic ∪ secretColumns)", () => {
  // Le colonne cifrate complete del progetto: (table, column)
  const knownSecrets: Array<{ table: string; col: string; hub?: boolean }> = [
    { table: "credentials", col: "encrypted_username" },
    { table: "credentials", col: "encrypted_password" },
    { table: "network_devices", col: "encrypted_password" },
    { table: "network_devices", col: "community_string" },   // miss heuristic → secretColumns
    { table: "network_devices", col: "api_token" },           // miss heuristic → secretColumns
    { table: "device_credential_bindings", col: "inline_encrypted_password" },
    { table: "ad_integrations", col: "encrypted_username" },
    { table: "ad_integrations", col: "encrypted_password" },
    { table: "vuln_scanners", col: "token_encrypted" },
    { table: "system_credentials", col: "password_enc", hub: true },
    { table: "system_credentials", col: "api_token_enc", hub: true },
    { table: "system_credentials", col: "extra_json_enc", hub: true },
    { table: "tenants", col: "agent_token_encrypted", hub: true },
  ];

  const tenantDb = freshTenant();
  const hubDb = freshHub();

  for (const { table, col, hub } of knownSecrets) {
    const db = hub ? hubDb : tenantDb;
    const spec = tableSpec(table);
    const effective = new Set([
      ...rekeyColumns(db, table),
      ...((spec?.secretColumns ?? []).filter(() => true)),
    ]);
    assert.ok(
      effective.has(col),
      `REKEY MISS: ${table}.${col} non è nel rekey-set effettivo — aggiungere a secretColumns o rinominare la colonna`,
    );
  }
});

