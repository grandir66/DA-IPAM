/**
 * da-vault (ADR 0035, rilievo di revisione): l'esportazione del cliente (livello `config`) leggeva `credentials` con un
 * SELECT diretto. Dopo lo svuotamento delle colonne il pacchetto avrebbe portato voci SENZA segreto e `secretErrors` a 0.
 * Ora i segreti si leggono dal lettore unico (OpenBao col riferimento); la voce del pacchetto ha le colonne piene (cifrate
 * per il trasporto) e NESSUN `credential_ref` (il percorso è del sorgente). OpenBao che non risponde = `secretErrors`.
 *
 * Run: node --import tsx --test src/lib/transfer/__tests__/export-openbao.test.ts
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import { decryptBuffer, decryptFieldWithKey, deriveTransportKey, readContainer } from "../envelope";
import { exportTenant } from "../export";
import { encrypt } from "@/lib/crypto";
import { OpenBaoStore } from "@/lib/vault/openbao";
import { statoVaultProcesso } from "@/lib/vault/stato";
import { creaOpenBaoFinto, type OpenBaoFinto } from "@/lib/vault/__tests__/support/openbao-finto";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-export-openbao";
const MIN = 60_000;
const PASS = "trasporto-123";
let adesso = Date.parse("2026-10-25T10:00:00Z");
let finto: OpenBaoFinto;
let tenant: Database.Database;

function esporta(): { manifest: { secretErrors: number }; righe: Array<{ tbl: string; row: Record<string, unknown> }>; chiave: Buffer } {
  const hub = new Database(":memory:");
  hub.exec(HUB_SCHEMA_SQL);
  const bundle = exportTenant({
    tenantDb: tenant, hubDb: hub,
    options: { tenantCode: "DEFAULT", tiers: ["config"], includeVault: false, passphrase: PASS, exportedAt: "2026-10-25T10:00:00.000Z", appVersion: "test" },
  });
  const { manifest, encryptedPayload } = readContainer(bundle);
  const chiave = deriveTransportKey(PASS, Buffer.from(manifest.encryption.saltHex, "hex"));
  const righe = zlib.gunzipSync(decryptBuffer(encryptedPayload, chiave)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { manifest, righe, chiave };
}

beforeEach(async () => {
  adesso = Date.parse("2026-10-25T10:00:00Z");
  tenant = new Database(":memory:");
  tenant.exec(TENANT_SCHEMA_SQL);
  tenant.exec(TENANT_INDEXES_SQL);
  if (!(tenant.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).some((c) => c.name === "credential_ref")) {
    tenant.exec("ALTER TABLE credentials ADD COLUMN credential_ref TEXT");
  }
  finto = creaOpenBaoFinto({ ora: () => adesso });
  finto.kv.set("clienti/x/da-ipam/fw-1", { username: "admin-bao", password: "pw-export-bao" });
  const store = new OpenBaoStore({
    url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], percorsiExtra: () => ["clienti/x/da-ipam/fw-1"],
    fetch: finto.fetch, fetchSync: finto.fetchSync, ora: () => adesso, durataCacheMs: 30 * MIN,
  });
  await store.aggiorna();
  statoVaultProcesso().openbao = store;
  process.env.DA_VAULT_OPENBAO = "1";
  // una voce SVUOTATA (riferimento, colonne vuote) e una non ancora migrata (colonne piene, doppia lettura)
  tenant.prepare("INSERT INTO credentials (name, credential_type, credential_ref) VALUES ('Firewall', 'ssh', 'clienti/x/da-ipam/fw-1')").run();
  tenant.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('Vecchia', 'ssh', ?, ?)").run(encrypt("root"), encrypt("pw-colonna"));
});

after(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
});

describe("esportazione del livello config con OpenBao acceso", () => {
  it("i segreti di una voce svuotata ci sono nel pacchetto, cifrati per il trasporto, senza riferimento", () => {
    const { manifest, righe, chiave } = esporta();
    assert.equal(manifest.secretErrors, 0);
    const voci = righe.filter((r) => r.tbl === "credentials").map((r) => r.row);
    const fw = voci.find((v) => v.name === "Firewall") as Record<string, string | null>;
    assert.equal(decryptFieldWithKey(String(fw.encrypted_password), chiave), "pw-export-bao");
    assert.equal(decryptFieldWithKey(String(fw.encrypted_username), chiave), "admin-bao");
    assert.equal(fw.credential_ref, null, "il percorso è del sorgente, non va nel pacchetto");
    const vecchia = voci.find((v) => v.name === "Vecchia") as Record<string, string | null>;
    assert.equal(decryptFieldWithKey(String(vecchia.encrypted_password), chiave), "pw-colonna");
  });

  it("OpenBao oltre la cache: la voce parte senza segreto e il pacchetto lo dice (secretErrors), non 0", () => {
    finto.giu = true;
    adesso += 31 * MIN;
    const { manifest, righe } = esporta();
    assert.equal(manifest.secretErrors, 1);
    const fw = righe.find((r) => r.tbl === "credentials" && r.row.name === "Firewall")!.row;
    assert.equal(fw.encrypted_password, null);
  });
});

describe("esportazione con l'interruttore spento", () => {
  it("come prima: le colonne, il riferimento com'è", () => {
    delete process.env.DA_VAULT_OPENBAO;
    const { manifest, righe, chiave } = esporta();
    assert.equal(manifest.secretErrors, 0);
    const voci = righe.filter((r) => r.tbl === "credentials").map((r) => r.row);
    const fw = voci.find((v) => v.name === "Firewall") as Record<string, string | null>;
    assert.equal(fw.encrypted_password, null, "spento il riferimento non conta: la colonna è vuota");
    assert.equal(fw.credential_ref, "clienti/x/da-ipam/fw-1");
    const vecchia = voci.find((v) => v.name === "Vecchia") as Record<string, string | null>;
    assert.equal(decryptFieldWithKey(String(vecchia.encrypted_password), chiave), "pw-colonna");
  });
});
