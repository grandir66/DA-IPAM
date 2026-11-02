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
import { avviaVault } from "../avvio";

const T = "VAULTPAUSA";
const PASS = "passphrase-del-cliente-123";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_OPENBAO;
  delete process.env.DA_VAULT_DALINK;
  delete process.env.DA_VAULT_DIR;
  chiudiVault(null);
  statoVaultProcesso().remoto = null;
  statoVaultProcesso().remotoNonAvviato = null;
});

beforeEach(() => {
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_OPENBAO;
  delete process.env.DA_VAULT_DALINK;
  process.env.DA_VAULT_DIR = mkdtempSync(join(tmpdir(), "da-vault-pausa-"));
  chiudiVault(null);
  statoVaultProcesso().remoto = null;
  statoVaultProcesso().remotoNonAvviato = null;
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
    assert.equal(statoVault().remoto.acceso, false);
    // spento tutto: la pagina dice «DA-Link» (OpenBao tolto il 02/11), non «Vault remoto»
    assert.equal(statoVault().remoto.nome, "DA-Link");
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

describe("DA_VAULT_OPENBAO=1 rimasto nel file (OpenBao tolto il 02/11)", () => {
  beforeEach(() => {
    process.env.DA_VAULT_OPENBAO = "1";
  });

  it("configurazione rifiutata: pausa col motivo che dice di usare DA_VAULT_DALINK=1, job saltati", async () => {
    const orig = console.error;
    console.error = () => undefined;
    try {
      avviaVault({ DA_VAULT_OPENBAO: "1" });
    } finally {
      console.error = orig;
    }
    assert.equal(statoVaultProcesso().remoto, null);
    assert.match(motivoPausaVault() ?? "", /OpenBao è stato tolto il 02\/11, usa DA_VAULT_DALINK=1/);
    const e = await eseguiCleanup();
    assert.equal(e.esito, "saltato");
    assert.equal(statoVault().remoto.nome, "Vault remoto");
  });
});

describe("cache del vault remoto", () => {
  it("cache scaduta: pausa col motivo dello store; cache buona: nessuna pausa", async () => {
    process.env.DA_VAULT_DALINK = "1";
    let stato: StatoStore = { pronto: false, motivo: "DA-Link non risponde da 25 ore: la cache dei segreti (24 ore) è scaduta" };
    statoVaultProcesso().remoto = {
      backend: "dalink",
      leggiSync: () => { throw new Error("non usato"); },
      get: async () => { throw new Error("non usato"); },
      delete: async () => { throw new Error("non usato"); },
      stato: () => stato,
    };
    assert.match(motivoPausaVault() ?? "", /DA-Link non risponde da 25 ore/);
    stato = { pronto: true, aggiornatoAlle: Date.now() };
    assert.equal(motivoPausaVault(), null);
    assert.deepEqual(await eseguiCleanup(), { esito: "eseguito" });
  });
});

describe("vault_dalink acceso: banner e pausa nominano DA-Link, non OpenBao", () => {
  const GETTONE = "dlv_" + "AbC-_9".repeat(7) + "x";
  const BUONA = { DALINK_VAULT_URL: "https://192.168.4.44:8443", DALINK_VAULT_GETTONE: GETTONE, DALINK_VAULT_IMPRONTA: `sha256//${Buffer.alloc(32, 7).toString("base64")}` };
  /** console.error/warn/info silenziati durante `fn` (l'avvio scrive nel log). */
  const zitto = (fn: () => void) => {
    const orig = { info: console.info, warn: console.warn, error: console.error };
    console.info = console.warn = console.error = () => undefined;
    try { fn(); } finally { Object.assign(console, orig); }
  };

  it("senza avvio (nessun motivo salvato): dice DA-Link e le sue variabili, mai OpenBao", () => {
    process.env.DA_VAULT_DALINK = "1";
    const m = motivoPausaVault() ?? "";
    assert.match(m, /DA-Link/);
    assert.match(m, /DALINK_VAULT_URL/);
    assert.doesNotMatch(m, /OpenBao|AppRole/);
    assert.doesNotMatch(testoBannerVault() ?? "", /OpenBao/);
  });

  it("con DA_VAULT_OPENBAO=1 ancora nel file (rifiutato dall'avvio): il banner dice di toglierlo", async () => {
    process.env.DA_VAULT_DALINK = "1";
    process.env.DA_VAULT_OPENBAO = "1";
    zitto(() => avviaVault({ ...BUONA, DA_VAULT_DALINK: "1", DA_VAULT_OPENBAO: "1" }));
    assert.equal(statoVaultProcesso().remoto, null, "nessuno store, nemmeno DA-Link");
    const m = motivoPausaVault() ?? "";
    assert.match(m, /OpenBao è stato tolto il 02\/11, usa DA_VAULT_DALINK=1/);
    assert.equal((await eseguiCleanup()).esito, "saltato");
    assert.match(statoVault().pausa ?? "", /OpenBao è stato tolto/);
  });

  it("configurazione di DA-Link rifiutata: il banner porta il motivo dell'avvio (i nomi, mai i valori)", () => {
    process.env.DA_VAULT_DALINK = "1";
    zitto(() => avviaVault({ ...BUONA, DA_VAULT_DALINK: "1", DALINK_VAULT_IMPRONTA: undefined }));
    const m = motivoPausaVault() ?? "";
    assert.match(m, /DALINK_VAULT_IMPRONTA/);
    assert.doesNotMatch(m, /OpenBao/);
    assert.ok(!(testoBannerVault() ?? "").includes(GETTONE));
  });

  it("lo stato pubblico nomina DA-Link; un nome neutro solo con la configurazione rifiutata", () => {
    process.env.DA_VAULT_DALINK = "1";
    const fisso = { leggiSync: () => { throw new Error("non usato"); }, get: async () => { throw new Error("non usato"); }, delete: async () => undefined, stato: (): StatoStore => ({ pronto: true, aggiornatoAlle: null }) };
    statoVaultProcesso().remoto = { ...fisso, backend: "dalink" };
    assert.equal(statoVault().remoto.nome, "DA-Link");
    statoVaultProcesso().remoto = null;
    assert.equal(statoVault().remoto.nome, "DA-Link");
    process.env.DA_VAULT_OPENBAO = "1";
    assert.equal(statoVault().remoto.nome, "Vault remoto"); // DA_VAULT_OPENBAO=1 rimasto: nome neutro
    delete process.env.DA_VAULT_DALINK;
    delete process.env.DA_VAULT_OPENBAO;
    assert.equal(statoVault().remoto.nome, "DA-Link"); // spento tutto
  });
});
