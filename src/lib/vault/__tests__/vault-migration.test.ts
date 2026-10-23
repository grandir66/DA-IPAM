/**
 * da-vault: lo schema del database del cliente. Additivo e idempotente, come le altre migrazioni di db-tenant:
 * - `credentials.credential_ref` (passo 6: il riferimento al segreto in OpenBao, accanto alle colonne cifrate);
 * - `vault_visualizzazioni` (passo 10: chi ha visto o esportato cosa, e quando) col suo indice.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/vault-migration.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { migrateVault, schemaVaultPresente } from "@/lib/db-tenant";

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec("CREATE TABLE IF NOT EXISTS tenant_settings (key TEXT PRIMARY KEY, value TEXT)");
  return d;
}

describe("migrateVault", () => {
  it("aggiunge la colonna e la tabella, poi niente: idempotente", () => {
    const d = db();
    d.prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('x', 'snmp', 'aa:bb:cc')").run();
    assert.deepEqual(migrateVault(d).sort(), ["credentials.credential_ref", "idx_vault_visualizzazioni_data", "vault_visualizzazioni"]);
    assert.deepEqual(migrateVault(d), []);
    assert.equal(schemaVaultPresente(d), true);
    const r = d.prepare("SELECT name, encrypted_password, credential_ref FROM credentials").get();
    assert.deepEqual(r, { name: "x", encrypted_password: "aa:bb:cc", credential_ref: null });
    const colonne = (d.prepare("PRAGMA table_info(vault_visualizzazioni)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.deepEqual(colonne, ["id", "utente_id", "utente", "azione", "credential_id", "credenziale", "created_at"]);
  });

  it("scrive il segno una volta sola", () => {
    const d = db();
    migrateVault(d);
    const segno = (d.prepare("SELECT value FROM tenant_settings WHERE key = 'vault_v21'").get() as { value: string } | undefined)?.value;
    assert.match(segno ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
  });

  it("un database del cliente aperto dall'app ha già lo schema del vault", async () => {
    const { getTenantDb, closeTenantDb, deleteTenantDatabase } = await import("@/lib/db-tenant");
    const d = getTenantDb("VAULTMIG");
    try {
      assert.equal(schemaVaultPresente(d), true);
    } finally {
      closeTenantDb("VAULTMIG");
      deleteTenantDatabase("VAULTMIG");
    }
  });
});
