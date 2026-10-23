/**
 * Correzioni della revisione del 23/10, rilievo 8: la ricifra INVERSA (dalla chiave degli slot a `ENCRYPTION_KEY`).
 * Senza, spegnere `DA_VAULT_LOCALE` dopo una ricifra lasciava i valori illeggibili. A vuoto di serie; stesse garanzie
 * della ricifra (tutto o niente per database, verifica col lettore unico, VACUUM); i segreti TOTP restano com'erano.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/ricifra-inversa.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chiaveInstallazione } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { getCredentialSecrets } from "@/lib/credentials-vault";
import { fileDaRicifrare, ricifra } from "../ricifra";
import { chiudiVault, impostaChiaveDati } from "../stato";
import { popola, SEGRETI_PROVA, valoriDellaChiave, type DatiProva } from "./support/dati-ricifra";

const T = "RICIFRAINV";
let K: Buffer;
let dati: DatiProva;

function chiudiTutto(): void {
  closeTenantDb(T);
  closeHubDb();
}

/** Quanti valori (escluso il TOTP) si aprono con la chiave, in tutti i database. */
function conChiave(chiave: Buffer): number {
  return fileDaRicifrare(TEST_DATA_DIR).reduce((n, f) => n + valoriDellaChiave(f, chiave, [dati.totpCifrato]).length, 0);
}

function campiOra(): string {
  return withTenant(T, () => JSON.stringify(dati.idVoci.map((id) => campiVoceDb(getTenantDb(T), id))));
}

function byteDi(file: string): Buffer {
  return Buffer.from(readFileSync(file));
}

before(() => {
  delete process.env.DA_VAULT_LOCALE;
  dati = popola(T);
  K = randomBytes(32);
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "passphrase");
  chiudiTutto();
  // Lo stato di un'appliance già ricifrata.
  ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true });
  chiudiTutto();
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  chiudiTutto();
});

describe("ricifra inversa", () => {
  it("la premessa: dopo la ricifra i valori sono della chiave degli slot e nessuno della chiave d'installazione", () => {
    assert.ok(conChiave(K) >= 4);
    assert.equal(conChiave(chiaveInstallazione()), 0);
  });

  it("a vuoto (di serie): conta i valori e non scrive niente", () => {
    const prima = fileDaRicifrare(TEST_DATA_DIR).map((f) => byteDi(f));
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, inversa: true });
    assert.equal(e.applicata, false);
    assert.ok(e.totale >= 4, `attesi almeno 4 valori, trovati ${e.totale}`);
    assert.deepEqual(fileDaRicifrare(TEST_DATA_DIR).map((f) => byteDi(f)), prima);
    assert.ok(conChiave(K) >= 4);
  });

  it("rifiuta con l'interruttore spento o con una chiave che non è quella aperta", () => {
    assert.throws(() => ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: randomBytes(32), inversa: true }), /non è quella aperta/);
    delete process.env.DA_VAULT_LOCALE;
    try {
      assert.throws(() => ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, inversa: true }), /DA_VAULT_LOCALE/);
    } finally {
      process.env.DA_VAULT_LOCALE = "1";
    }
  });

  it("--applica: i valori tornano alla chiave d'installazione, gli stessi campi, VACUUM, TOTP intatto", () => {
    const prima = campiOra();
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, inversa: true, applica: true });
    assert.equal(e.applicata, true);
    assert.ok(e.file.every((f) => f.vacuum));
    assert.equal(conChiave(K), 0, "restano valori della chiave degli slot");
    assert.ok(conChiave(chiaveInstallazione()) >= 4);
    assert.equal(campiOra(), prima);
    // Nel file non resta nessun valore della chiave degli slot (VACUUM): lo cerchiamo prima, nei dati di prima.
    chiudiTutto();
    for (const f of fileDaRicifrare(TEST_DATA_DIR)) {
      for (const g of [f, `${f}-wal`]) if (existsSync(g)) assert.ok(!byteDi(g).includes(Buffer.from(SEGRETI_PROVA.ssh)), `${g}: segreto in chiaro`);
    }
  });

  it("con l'interruttore SPENTO l'app legge tutto con la sola ENCRYPTION_KEY (lo scopo della inversa)", () => {
    delete process.env.DA_VAULT_LOCALE;
    chiudiVault(null);
    try {
      const campi = withTenant(T, () => dati.idVoci.map((id) => campiVoceDb(getTenantDb(T), id)));
      assert.ok(campi.every((c) => c.ok), "una voce non si legge a vault spento");
      assert.equal(getCredentialSecrets(1)?.password, SEGRETI_PROVA.sistema);
    } finally {
      process.env.DA_VAULT_LOCALE = "1";
      impostaChiaveDati(K, "passphrase");
    }
  });

  it("si può ripetere (niente da fare) e si può riandare avanti: ricifra, poi inversa, poi ricifra", () => {
    assert.equal(ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, inversa: true, applica: true }).totale, 0);
    const prima = campiOra();
    assert.ok(ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true }).totale >= 4);
    assert.equal(campiOra(), prima);
    assert.equal(conChiave(chiaveInstallazione()), 0);
  });
});
