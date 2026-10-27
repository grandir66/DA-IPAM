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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { logEncryptionKeyHealthAtBoot, probeEncryptionKeyHealth } from "@/lib/encryption-key-health";
import { GET as healthGet } from "@/app/api/health/route";
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
  it("rilievo 8: vault SPENTO con l'archivio presente e valori della chiave degli slot: lo dice a schermo e indica la ricifra inversa", () => {
    delete process.env.DA_VAULT_LOCALE;
    const cartella = mkdtempSync(join(tmpdir(), "da-vault-salute-"));
    writeFileSync(join(cartella, "archivio.json"), "{}");
    process.env.DA_VAULT_DIR = cartella;
    try {
      const p = probeEncryptionKeyHealth();
      assert.equal(p.ok, false);
      assert.match(p.detail ?? "", /DA_VAULT_LOCALE/);
      assert.match(p.detail ?? "", /ricifra --inversa/);
      const righe = errori(() => logEncryptionKeyHealthAtBoot());
      assert.ok(righe.some((r) => r.includes("CRITICAL [encryption-key]") && r.includes("ricifra --inversa")), righe.join("\n"));
    } finally {
      delete process.env.DA_VAULT_DIR;
    }
  });

  it("vault spento senza archivio: il messaggio di sempre (ENCRYPTION_KEY), niente suggerimento sul vault", () => {
    delete process.env.DA_VAULT_LOCALE;
    delete process.env.DA_VAULT_DIR;
    const p = probeEncryptionKeyHealth();
    assert.equal(p.ok, false);
    assert.match(p.detail ?? "", /ENCRYPTION_KEY attuale/);
    assert.doesNotMatch(p.detail ?? "", /ricifra --inversa/);
  });

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

/**
 * Rilievo 1 della revisione (23/10): `update.sh`/`auto-update.sh` aspettano un 200 da /api/health dopo il riavvio e
 * altrimenti tornano alla build di prima, che non legge i valori ricifrati. Col vault acceso e bloccato (niente TPM
 * al riavvio) la risposta deve restare 200 «degraded»; il 503 resta per la chiave davvero sbagliata e per `?strict=1`.
 */
describe("/api/health col vault", () => {
  async function chiama(query = ""): Promise<{ codice: number; corpo: Record<string, unknown> }> {
    const res = await healthGet(new Request(`http://localhost/api/health${query}`));
    return { codice: res.status, corpo: (await res.json()) as Record<string, unknown> };
  }

  it("vault aperto: 200 ok", async () => {
    const { codice, corpo } = await chiama();
    assert.equal(codice, 200);
    assert.equal(corpo.status !== "error", true);
  });

  it("vault bloccato: 200 con status degraded e «vault bloccato» (il rollback di update.sh non scatta)", async () => {
    chiudiVault("niente TPM");
    const { codice, corpo } = await chiama();
    assert.equal(codice, 200);
    assert.equal(corpo.status, "degraded");
    assert.match(JSON.stringify(corpo), /[Vv]ault bloccato/);
  });

  it("vault bloccato con ?strict=1: 503 (monitoraggio)", async () => {
    chiudiVault("niente TPM");
    const { codice } = await chiama("?strict=1");
    assert.equal(codice, 503);
  });

  it("chiave sbagliata a interruttore spento: resta 503 (il vault bloccato non maschera il guasto vero)", async () => {
    delete process.env.DA_VAULT_LOCALE;
    const { codice } = await chiama();
    assert.equal(codice, 503);
  });
});
