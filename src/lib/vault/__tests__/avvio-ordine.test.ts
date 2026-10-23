/**
 * Correzioni della revisione del 23/10, rilievo 13: `server.ts` lanciava l'avvio del vault in un `import().then()` senza
 * aspettarlo, e subito dopo partivano le altre inizializzazioni (migrazione dei segreti delle installazioni, scheduler,
 * notificatori) che possono chiamare `encrypt()`: con `DA_VAULT_LOCALE=1` e il vault ancora non sbloccato, un
 * `encrypt()` lancia «vault bloccato» (o peggio, cifra con la chiave sbagliata se arriva dopo lo sblocco a metà).
 *
 * Due cose si provano:
 * 1. `avviaVault()` è SINCRONO nello sblocco dal TPM: quando ritorna la chiave è già aperta, quindi basta aspettare
 *    l'import prima di proseguire (nessun'altra attesa nascosta);
 * 2. in `server.ts`, `initCron` aspetta (`await`) l'import e l'avvio del vault PRIMA di ogni altra inizializzazione.
 *    (Il file non si può importare — lancia Next —, quindi questa metà legge il testo: è la guardia del cablaggio, la
 *    prova che il comportamento c'è è la prima.)
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/avvio-ordine.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { avviaVault } from "../avvio";
import { cartellaVault } from "../appliance";
import { contenutoSlotTpm, creaArchivio } from "../archivio";
import { chiaveDatiAttiva, chiudiVault } from "../stato";
import { encrypt } from "@/lib/crypto";

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_DIR;
  delete process.env.CREDENTIALS_DIRECTORY;
  chiudiVault(null);
});

describe("avvio del vault prima del resto", () => {
  it("avviaVault sblocca dal TPM in modo sincrono: ritornato, encrypt() funziona", async () => {
    process.env.DA_VAULT_DIR = mkdtempSync(join(tmpdir(), "da-vault-ordine-"));
    process.env.DA_VAULT_LOCALE = "1";
    const { chiave } = await creaArchivio(cartellaVault(), { passphrase: "passphrase-del-cliente-123", chiaveDomarc: await identityToRecipient(await generateX25519Identity()), scryptLogN: 10 });
    const cred = mkdtempSync(join(tmpdir(), "da-vault-ordine-cred-"));
    writeFileSync(join(cred, "vault-key"), contenutoSlotTpm(cartellaVault(), chiave));
    process.env.CREDENTIALS_DIRECTORY = cred;
    chiudiVault(null);
    assert.equal(chiaveDatiAttiva(), null);
    assert.throws(() => encrypt("x"), /[Vv]ault bloccato/, "la premessa: prima dell'avvio encrypt() è bloccato");
    avviaVault({ ...process.env });
    assert.ok(chiaveDatiAttiva(), "dopo avviaVault() la chiave deve essere già aperta");
    assert.doesNotThrow(() => encrypt("x"));
  });

  it("server.ts: initCron è async e aspetta il vault prima di ogni altra inizializzazione", () => {
    const src = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const asincrona = src.indexOf("async function initCron()");
    assert.ok(asincrona >= 0, "initCron deve essere `async function initCron()`");
    const corpo = src.slice(asincrona);
    const attesa = corpo.indexOf('await import("./src/lib/vault/avvio")');
    assert.ok(attesa >= 0, "manca `await import(\"./src/lib/vault/avvio\")`");
    const primaAltra = corpo.search(/(?<!await )import\("\.\/src\/lib\/(?!vault\/avvio)/);
    assert.ok(primaAltra > attesa, "un'altra inizializzazione parte prima dell'avvio del vault");
    assert.doesNotMatch(corpo, /import\("\.\/src\/lib\/vault\/avvio"\)\.then/, "l'avvio del vault non va lanciato in un .then senza aspettarlo");
  });
});
