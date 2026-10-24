/**
 * da-vault, passo 10: «Vault bloccato» = banner e scansioni in pausa finché l'archivio non è sbloccato; sblocco
 * all'avvio dallo slot TPM, a mano con la passphrase del cliente. Con gli interruttori spenti niente di tutto questo:
 * i job girano come oggi, niente banner.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/pausa.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { closeTenantDb, createScheduledJob, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { runJob } from "@/lib/cron/jobs";
import { avviaVaultLocale, cartellaVault, motivoPausaVault, sbloccaConPassphrase, statoVault, testoBannerVault } from "../appliance";
import { contenutoSlotTpm, creaArchivio } from "../archivio";
import { chiudiVault, statoVaultProcesso } from "../stato";
import { ErroreVault, type StatoStore } from "../tipi";

const T = "VAULTPAUSA";
const PASS = "passphrase-del-cliente-123";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_OPENBAO;
  delete process.env.DA_VAULT_DIR;
  chiudiVault(null);
  statoVaultProcesso().openbao = null;
});

beforeEach(() => {
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_OPENBAO;
  process.env.DA_VAULT_DIR = mkdtempSync(join(tmpdir(), "da-vault-pausa-"));
  chiudiVault(null);
  statoVaultProcesso().openbao = null;
});

async function archivioConTpm(): Promise<{ chiave: Buffer; credenziali: string }> {
  const destinatario = await identityToRecipient(await generateX25519Identity());
  const { chiave } = await creaArchivio(cartellaVault(), { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: 10 });
  const credenziali = mkdtempSync(join(tmpdir(), "da-vault-cred-"));
  writeFileSync(join(credenziali, "vault-key"), contenutoSlotTpm(cartellaVault(), chiave), { mode: 0o600 });
  return { chiave, credenziali };
}

async function eseguiCleanup() {
  return withTenant(T, async () => {
    const job = createScheduledJob({ network_id: null, job_type: "cleanup", interval_minutes: 60 });
    return runJob(job.id);
  });
}

describe("interruttori spenti", () => {
  it("nessuna pausa, nessun banner, i job girano come oggi", async () => {
    avviaVaultLocale();
    assert.equal(motivoPausaVault(), null);
    assert.equal(testoBannerVault(), null);
    assert.deepEqual(await eseguiCleanup(), { esito: "eseguito" });
    assert.equal(statoVault().locale.acceso, false);
    assert.equal(statoVault().openbao.acceso, false);
  });

  it("spento, anche con l'archivio presente l'avvio non lo apre", async () => {
    await archivioConTpm();
    avviaVaultLocale({ credenziali: undefined });
    assert.equal(statoVaultProcesso().chiaveDati, null);
    assert.equal(motivoPausaVault(), null);
  });
});

describe("vault_locale acceso", () => {
  beforeEach(() => {
    process.env.DA_VAULT_LOCALE = "1";
  });

  it("archivio assente: bloccato, banner, il job è saltato col motivo", async () => {
    avviaVaultLocale();
    assert.match(motivoPausaVault() ?? "", /Vault bloccato/);
    assert.match(testoBannerVault() ?? "", /scansioni sono in pausa/);
    const e = await eseguiCleanup();
    assert.equal(e.esito, "saltato");
    assert.match(e.esito === "saltato" ? e.motivo : "", /Vault bloccato/);
  });

  it("slot TPM presente: all'avvio si sblocca da solo e i job girano", async () => {
    const { chiave, credenziali } = await archivioConTpm();
    avviaVaultLocale({ credenziali });
    assert.deepEqual(statoVaultProcesso().chiaveDati, chiave);
    assert.equal(statoVault().locale.sbloccatoDa, "tpm");
    assert.equal(motivoPausaVault(), null);
    assert.equal(testoBannerVault(), null);
    assert.deepEqual(await eseguiCleanup(), { esito: "eseguito" });
  });

  it("senza TPM resta bloccato; la passphrase sbagliata non sblocca, quella giusta sì e le scansioni riprendono", async () => {
    const { chiave } = await archivioConTpm();
    avviaVaultLocale({ credenziali: undefined });
    assert.match(motivoPausaVault() ?? "", /Vault bloccato/);
    await assert.rejects(sbloccaConPassphrase("passphrase-sbagliata-000"), (e: unknown) => e instanceof ErroreVault && e.codice === "slot_errato");
    assert.equal(statoVaultProcesso().chiaveDati, null);
    await sbloccaConPassphrase(PASS);
    assert.deepEqual(statoVaultProcesso().chiaveDati, chiave);
    assert.equal(statoVault().locale.sbloccatoDa, "passphrase");
    assert.equal(motivoPausaVault(), null);
    assert.deepEqual(await eseguiCleanup(), { esito: "eseguito" });
  });

  it("lo stato pubblico non contiene la chiave", async () => {
    const { chiave, credenziali } = await archivioConTpm();
    avviaVaultLocale({ credenziali });
    const testo = JSON.stringify(statoVault());
    assert.ok(!testo.includes(chiave.toString("hex")));
    assert.ok(!testo.includes(chiave.toString("base64")));
    assert.deepEqual(statoVault().locale.archivio, { presente: true, slot: { cliente: true, domarc: true, tpm: false } });
  });
});

describe("vault_openbao acceso", () => {
  beforeEach(() => {
    process.env.DA_VAULT_OPENBAO = "1";
  });

  it("senza store OpenBao configurato: pausa dichiarata", async () => {
    assert.match(motivoPausaVault() ?? "", /OpenBao/);
    const e = await eseguiCleanup();
    assert.equal(e.esito, "saltato");
  });

  it("cache scaduta: pausa col motivo dello store; cache buona: nessuna pausa", async () => {
    let stato: StatoStore = { pronto: false, motivo: "OpenBao non risponde da 31 minuti: la cache dei segreti (30 minuti) è scaduta" };
    statoVaultProcesso().openbao = {
      leggiSync: () => { throw new Error("non usato"); },
      get: async () => { throw new Error("non usato"); },
      delete: async () => { throw new Error("non usato"); },
      getSync: () => { throw new Error("non usato"); },
      putSync: () => { throw new Error("non usato"); },
      stato: () => stato,
    };
    assert.match(motivoPausaVault() ?? "", /OpenBao non risponde da 31 minuti/);
    stato = { pronto: true, aggiornatoAlle: Date.now() };
    assert.equal(motivoPausaVault(), null);
    assert.deepEqual(await eseguiCleanup(), { esito: "eseguito" });
  });
});
