/**
 * da-vault, passo 10: il controllo della chiave (`encryption-key-health`, avvio e /api/health) col vault acceso.
 * All'avvio gira prima dello sblocco: con `DA_VAULT_LOCALE=1` non deve gridare «CRITICAL … ENCRYPTION_KEY» per
 * valori che sono (giustamente) della chiave degli slot; col vault bloccato /api/health dice «vault bloccato», non
 * «chiave sbagliata». Interruttore spento: com'era.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/salute-chiave.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { logEncryptionKeyHealthAtBoot, probeEncryptionKeyHealth } from "@/lib/encryption-key-health";
import { chiudiVault, impostaChiaveDati } from "../stato";

const T = "VAULTSALUTE";
const K = randomBytes(32);

function errori(fn: () => void): string[] {
  const righe: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return righe;
}

before(() => {
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "tpm");
  withTenant(T, () => {
    creaCredenzialeDb(getTenantDb(T), { name: "fw", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("pw-salute") });
  });
  closeTenantDb(T);
});

beforeEach(() => {
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "tpm");
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  try { deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

describe("controllo della chiave col vault", () => {
  it("vault aperto: le credenziali della chiave degli slot contano come leggibili", () => {
    const p = probeEncryptionKeyHealth();
    assert.equal(p.ok, true);
    assert.equal(p.decryptOkCount, p.credentialCount);
  });

  it("vault bloccato: non ok, e il motivo è il vault, non ENCRYPTION_KEY", () => {
    chiudiVault("niente TPM");
    const p = probeEncryptionKeyHealth();
    assert.equal(p.ok, false);
    assert.match(p.detail ?? "", /[Vv]ault bloccato/);
    assert.doesNotMatch(p.detail ?? "", /ENCRYPTION_KEY attuale/);
  });

  it("all'avvio (prima dello sblocco) col vault acceso: nessun CRITICAL sulla chiave", () => {
    chiudiVault(null);
    const righe = errori(() => logEncryptionKeyHealthAtBoot());
    assert.deepEqual(righe.filter((r) => r.includes("CRITICAL [encryption-key]") && r.includes("NON decifrabili")), []);
  });

  it("interruttore spento: i valori della chiave degli slot risultano non decifrabili, come prima (CRITICAL)", () => {
    delete process.env.DA_VAULT_LOCALE;
    const righe = errori(() => logEncryptionKeyHealthAtBoot());
    assert.ok(righe.some((r) => r.includes("CRITICAL [encryption-key]")));
  });
});
