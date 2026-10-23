/**
 * da-vault, passo 10 (piano 2026-10-23): l'archivio locale delle appliance, una chiave dei dati casuale che esiste solo
 * dentro gli slot age. Prove obbligatorie del piano: slot con password giusta e sbagliata, slot copiato su un altro
 * archivio, slot cancellato; più lo slot Domarc (X25519), lo slot TPM (systemd-creds) e la passphrase troppo corta.
 *
 * Le prove non dipendono dalla macchina: cartelle temporanee nuove, scrypt a fattore basso, nessun TPM vero (lo slot
 * TPM si prova come lo vede l'app: il file `vault-key` che systemd mette in $CREDENTIALS_DIRECTORY).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/archivio.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import {
  apriConDomarc,
  apriConPassphrase,
  apriConTpm,
  contenutoSlotTpm,
  creaArchivio,
  leggiArchivio,
  scriviSlotCliente,
  scriviSlotDomarc,
  scriviSlotTpm,
  togliSlot,
  PASSPHRASE_MINIMA,
} from "../archivio";
import { ErroreVault } from "../tipi";

const PASS = "cavallo-batteria-graffetta-42";
const LOGN = 10;

function cartella(): string {
  return mkdtempSync(join(tmpdir(), "da-vault-archivio-"));
}

async function codiceDi(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    assert.ok(e instanceof ErroreVault, `atteso ErroreVault, arrivato ${String(e)}`);
    return e.codice;
  }
  return "nessun errore";
}

let identita: string;
let destinatario: string;

beforeEach(async () => {
  identita = await generateX25519Identity();
  destinatario = await identityToRecipient(identita);
});

describe("creazione", () => {
  it("crea archivio.json e gli slot cliente e domarc, file 0600, chiave di 32 byte", async () => {
    const dir = cartella();
    const { id, chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    assert.equal(chiave.length, 32);
    const info = leggiArchivio(dir);
    assert.equal(info.id, id);
    assert.deepEqual(info.slot, { cliente: true, domarc: true, tpm: false });
    for (const f of ["archivio.json", "slot-cliente.age", "slot-domarc.age"]) {
      assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
    }
    // La chiave non sta in chiaro da nessuna parte nella cartella.
    for (const f of ["archivio.json", "slot-cliente.age", "slot-domarc.age"]) {
      const b = readFileSync(join(dir, f));
      assert.ok(!b.includes(chiave), `${f} contiene la chiave grezza`);
      assert.ok(!b.includes(Buffer.from(chiave.toString("base64"))), `${f} contiene la chiave in base64`);
      assert.ok(!b.includes(Buffer.from(PASS)), `${f} contiene la passphrase`);
    }
  });

  it("rifiuta una passphrase più corta di 14 caratteri", async () => {
    assert.equal(PASSPHRASE_MINIMA, 14);
    const dir = cartella();
    assert.equal(await codiceDi(creaArchivio(dir, { passphrase: "corta-13-car.", chiaveDomarc: destinatario, scryptLogN: LOGN })), "configurazione");
    assert.equal(existsSync(join(dir, "archivio.json")), false);
  });

  it("senza chiave Domarc rifiuta, a meno dell'esclusione scritta (D5)", async () => {
    const dir = cartella();
    assert.equal(await codiceDi(creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, scryptLogN: LOGN })), "configurazione");
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, scryptLogN: LOGN });
    assert.deepEqual(leggiArchivio(dir).slot, { cliente: true, domarc: false, tpm: false });
    assert.deepEqual(await apriConPassphrase(dir, PASS), chiave);
  });

  it("non sovrascrive un archivio che c'è già", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    assert.equal(await codiceDi(creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN })), "archivio_esistente");
  });

  it("una chiave Domarc che non è un destinatario age è un errore di configurazione", async () => {
    const dir = cartella();
    assert.equal(await codiceDi(creaArchivio(dir, { passphrase: PASS, chiaveDomarc: "ssh-ed25519 AAAA", scryptLogN: LOGN })), "configurazione");
  });
});

describe("slot cliente: passphrase giusta e sbagliata", () => {
  it("la passphrase giusta dà la chiave dei dati", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    assert.deepEqual(await apriConPassphrase(dir, PASS), chiave);
  });

  it("la passphrase sbagliata è «slot_errato», senza la passphrase nel messaggio", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    try {
      await apriConPassphrase(dir, "una-passphrase-sbagliata");
      assert.fail("doveva rifiutare");
    } catch (e) {
      assert.ok(e instanceof ErroreVault);
      assert.equal(e.codice, "slot_errato");
      assert.ok(!e.message.includes("una-passphrase-sbagliata"));
    }
  });

  it("cambiare la passphrase lascia la stessa chiave e la vecchia non apre più", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    await scriviSlotCliente(dir, chiave, "nuova-passphrase-lunga-abbastanza", LOGN);
    assert.deepEqual(await apriConPassphrase(dir, "nuova-passphrase-lunga-abbastanza"), chiave);
    assert.equal(await codiceDi(apriConPassphrase(dir, PASS)), "slot_errato");
  });

  it("riscrivere uno slot con una chiave che non è quella dell'archivio è rifiutato", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    assert.equal(await codiceDi(scriviSlotCliente(dir, Buffer.alloc(32, 7), "altra-passphrase-lunghissima", LOGN)), "slot_estraneo");
    assert.equal(await codiceDi(scriviSlotDomarc(dir, Buffer.alloc(32, 7), destinatario)), "slot_estraneo");
  });
});

describe("slot Domarc", () => {
  it("la chiave privata Domarc apre; un'altra identità no", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    assert.deepEqual(await apriConDomarc(dir, identita), chiave);
    const altra = await generateX25519Identity();
    assert.equal(await codiceDi(apriConDomarc(dir, altra)), "slot_errato");
  });

  it("il cambio di generazione riscrive lo slot verso la chiave nuova senza cambiare la chiave dei dati", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    const nuova = await generateX25519Identity();
    await scriviSlotDomarc(dir, chiave, await identityToRecipient(nuova));
    assert.deepEqual(await apriConDomarc(dir, nuova), chiave);
    assert.equal(await codiceDi(apriConDomarc(dir, identita)), "slot_errato");
  });
});

describe("slot copiato su un altro archivio", () => {
  it("uno slot cliente di A messo in B non apre B, anche con la passphrase giusta di A", async () => {
    const a = cartella();
    const b = cartella();
    await creaArchivio(a, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    const { chiave: chiaveB } = await creaArchivio(b, { passphrase: "passphrase-di-b-lunga", chiaveDomarc: destinatario, scryptLogN: LOGN });
    copyFileSync(join(a, "slot-cliente.age"), join(b, "slot-cliente.age"));
    assert.equal(await codiceDi(apriConPassphrase(b, PASS)), "slot_estraneo");
    // B si apre ancora dal suo slot Domarc.
    assert.deepEqual(await apriConDomarc(b, identita), chiaveB);
  });

  it("uno slot Domarc di A messo in B non apre B", async () => {
    const a = cartella();
    const b = cartella();
    await creaArchivio(a, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    await creaArchivio(b, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    copyFileSync(join(a, "slot-domarc.age"), join(b, "slot-domarc.age"));
    assert.equal(await codiceDi(apriConDomarc(b, identita)), "slot_estraneo");
  });

  it("uno slot TPM di A messo in B non apre B", async () => {
    const a = cartella();
    const b = cartella();
    const { chiave: chiaveA } = await creaArchivio(a, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    await creaArchivio(b, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    const cred = mkdtempSync(join(tmpdir(), "da-vault-cred-"));
    writeFileSync(join(cred, "vault-key"), contenutoSlotTpm(a, chiaveA), { mode: 0o600 });
    assert.equal(await codiceDi(() => apriConTpm(b, cred)), "slot_estraneo");
  });

  it("lo slot cliente rinominato in slot Domarc non apre (il nome dello slot è dentro lo slot)", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    const cred = mkdtempSync(join(tmpdir(), "da-vault-cred-"));
    // Il contenuto TPM di questo archivio, ma con il nome di un altro slot: rifiutato.
    const finto = JSON.parse(contenutoSlotTpm(dir, chiave).toString("utf8")) as Record<string, unknown>;
    writeFileSync(join(cred, "vault-key"), JSON.stringify({ ...finto, slot: "cliente" }), { mode: 0o600 });
    assert.equal(await codiceDi(() => apriConTpm(dir, cred)), "slot_estraneo");
  });
});

describe("slot cancellato", () => {
  it("senza slot-cliente.age la passphrase non apre (slot_assente) ma Domarc sì", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    rmSync(join(dir, "slot-cliente.age"));
    assert.equal(await codiceDi(apriConPassphrase(dir, PASS)), "slot_assente");
    assert.deepEqual(await apriConDomarc(dir, identita), chiave);
  });

  it("togliSlot('domarc') toglie file e voce; lo slot cliente apre ancora", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    togliSlot(dir, "domarc");
    assert.equal(existsSync(join(dir, "slot-domarc.age")), false);
    assert.equal(leggiArchivio(dir).slot.domarc, false);
    assert.equal(await codiceDi(apriConDomarc(dir, identita)), "slot_assente");
    assert.deepEqual(await apriConPassphrase(dir, PASS), chiave);
  });

  it("l'ultimo slot non si toglie: l'archivio resterebbe chiuso per sempre", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, scryptLogN: LOGN });
    assert.equal(await codiceDi(() => togliSlot(dir, "cliente")), "configurazione");
    assert.equal(existsSync(join(dir, "slot-cliente.age")), true);
  });

  it("senza archivio.json: archivio_assente", async () => {
    const dir = cartella();
    assert.equal(await codiceDi(apriConPassphrase(dir, PASS)), "archivio_assente");
    assert.equal(await codiceDi(() => leggiArchivio(dir)), "archivio_assente");
  });

  it("archivio.json rovinato: archivio_rotto", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    writeFileSync(join(dir, "archivio.json"), "{non è json");
    assert.equal(await codiceDi(apriConPassphrase(dir, PASS)), "archivio_rotto");
  });
});

describe("slot TPM (systemd-creds)", () => {
  it("apre dal file vault-key di $CREDENTIALS_DIRECTORY", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    const cred = mkdtempSync(join(tmpdir(), "da-vault-cred-"));
    writeFileSync(join(cred, "vault-key"), contenutoSlotTpm(dir, chiave), { mode: 0o600 });
    assert.deepEqual(apriConTpm(dir, cred), chiave);
  });

  it("senza $CREDENTIALS_DIRECTORY o senza vault-key: slot_assente", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    assert.equal(await codiceDi(() => apriConTpm(dir, undefined)), "slot_assente");
    const vuota = mkdtempSync(join(tmpdir(), "da-vault-cred-"));
    assert.equal(await codiceDi(() => apriConTpm(dir, vuota)), "slot_assente");
  });

  it("scriviSlotTpm passa il contenuto a systemd-creds sullo stdin, mai sulla riga di comando, e segna lo slot", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: LOGN });
    const chiamate: Array<{ comando: string; argomenti: string[]; stdin: Buffer }> = [];
    await scriviSlotTpm(dir, chiave, async (comando, argomenti, stdin) => {
      chiamate.push({ comando, argomenti, stdin });
      mkdirSync(dir, { recursive: true });
      writeFileSync(argomenti[argomenti.length - 1], "cifrato-dal-tpm");
    });
    assert.equal(chiamate.length, 1);
    assert.equal(chiamate[0].comando, "systemd-creds");
    assert.ok(chiamate[0].argomenti.includes("--with-key=tpm2+host"));
    assert.ok(chiamate[0].argomenti.includes("--name=vault-key"));
    const riga = chiamate[0].argomenti.join(" ");
    assert.ok(!riga.includes(chiave.toString("base64")), "la chiave non va sulla riga di comando");
    assert.deepEqual(chiamate[0].stdin, contenutoSlotTpm(dir, chiave));
    assert.equal(leggiArchivio(dir).slot.tpm, true);
  });
});
