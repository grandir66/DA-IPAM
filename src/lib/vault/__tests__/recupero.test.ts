/**
 * da-vault, passo 10: `scripts/da-vault-recover.ts` (reset-password, export-keyfile, rotate) con la chiave privata
 * Domarc presa da Keeper e passata sullo **stdin**, mai da un argomento né da un file nel repository. Ogni uso chiede
 * un ticket e lascia una riga in `recuperi.jsonl` (senza segreti), per la comunicazione al cliente.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/recupero.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { apriConDomarc, apriConPassphrase, creaArchivio } from "../archivio";
import { LocaleStore } from "../locale";
import { PERCORSO_KEYFILE } from "../keepass";
import { controllaArgomenti, esportaKeyfileDomarc, leggiIdentitaDaStdin, resetPassword, ruotaSlotDomarc } from "../recupero";
import { ErroreVault } from "../tipi";

const PASS = "passphrase-cliente-recupero";
let dir: string;
let identita: string;
let chiave: Buffer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "da-vault-recover-"));
  identita = await generateX25519Identity();
  chiave = (await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: await identityToRecipient(identita), scryptLogN: 10 })).chiave;
});

describe("libreria", () => {
  it("lo stdin dà l'identità sulla prima riga e il resto dopo; senza identità valida rifiuta", () => {
    assert.deepEqual(leggiIdentitaDaStdin(`${identita}\nnuova-passphrase-lunga\n`), { identita, resto: ["nuova-passphrase-lunga"] });
    assert.throws(() => leggiIdentitaDaStdin("niente\n"), ErroreVault);
    assert.throws(() => leggiIdentitaDaStdin(""), ErroreVault);
  });

  it("la chiave negli argomenti è rifiutata, come le opzioni per leggerla da un file", () => {
    assert.throws(() => controllaArgomenti(["reset-password", identita]), /stdin/);
    assert.throws(() => controllaArgomenti(["export-keyfile", "--chiave", "/tmp/k"]), /stdin/);
    assert.throws(() => controllaArgomenti(["rotate", "--identity-file=x"]), /stdin/);
    controllaArgomenti(["rotate", "--destinatario", "age1qqq", "--ticket", "T-1"]);
  });

  it("reset-password: la passphrase nuova apre, la vecchia no, la chiave dei dati è la stessa", async () => {
    await resetPassword(dir, identita, "nuova-passphrase-lunga", 10);
    assert.deepEqual(await apriConPassphrase(dir, "nuova-passphrase-lunga"), chiave);
    await assert.rejects(apriConPassphrase(dir, PASS));
  });

  it("export-keyfile: il key file dell'archivio; senza key file un errore che lo dice", async () => {
    await assert.rejects(esportaKeyfileDomarc(dir, identita), (e: unknown) => e instanceof ErroreVault && e.codice === "non_trovato");
    await new LocaleStore({ dir, chiave: () => chiave }).put(PERCORSO_KEYFILE, { keyfile: Buffer.from("<KeyFile>prova</KeyFile>").toString("base64") });
    assert.equal(Buffer.from(await esportaKeyfileDomarc(dir, identita)).toString("utf8"), "<KeyFile>prova</KeyFile>");
  });

  it("rotate: lo slot Domarc passa alla chiave nuova (cambio di generazione), la vecchia non apre più", async () => {
    const nuova = await generateX25519Identity();
    await ruotaSlotDomarc(dir, identita, await identityToRecipient(nuova));
    assert.deepEqual(await apriConDomarc(dir, nuova), chiave);
    await assert.rejects(apriConDomarc(dir, identita));
  });
});

describe("CLI", () => {
  const cli = (args: string[], stdin: string) =>
    spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "da-vault-recover.ts"), ...args], { input: stdin, encoding: "utf8", cwd: process.cwd() });

  it("reset-password dallo stdin: riesce, non stampa la chiave, scrive il ticket in recuperi.jsonl", async () => {
    const r = cli(["reset-password", "--archivio", dir, "--ticket", "TCK-42"], `${identita}\nnuova-passphrase-da-cli\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(identita) && !r.stderr.includes(identita));
    assert.ok(!r.stdout.includes("nuova-passphrase-da-cli"));
    assert.deepEqual(await apriConPassphrase(dir, "nuova-passphrase-da-cli"), chiave);
    const righe = readFileSync(join(dir, "recuperi.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    // Intento prima, esito dopo (rilievo 12 della revisione del 23/10).
    assert.deepEqual(righe.map((r) => r.stato), ["intento", "ok"]);
    assert.ok(righe.every((r) => r.ticket === "TCK-42" && r.comando === "reset-password"));
    assert.ok(!JSON.stringify(righe).includes(identita));
  });

  it("la chiave come argomento: esce con errore e non tocca l'archivio", async () => {
    const r = cli(["reset-password", "--archivio", dir, "--ticket", "TCK-1", identita], "");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /stdin/);
    assert.ok(!r.stderr.includes(identita), "il messaggio non ripete la chiave");
    assert.deepEqual(await apriConPassphrase(dir, PASS), chiave);
  });

  it("senza ticket rifiuta", () => {
    const r = cli(["rotate", "--archivio", dir, "--destinatario", "age1abc"], `${identita}\n`);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ticket/);
  });

  it("export-keyfile scrive il file 0600 e non sovrascrive", async () => {
    await new LocaleStore({ dir, chiave: () => chiave }).put(PERCORSO_KEYFILE, { keyfile: Buffer.from("<KeyFile>k</KeyFile>").toString("base64") });
    const uscita = join(mkdtempSync(join(tmpdir(), "da-vault-kf-")), "cliente.keyx");
    const r = cli(["export-keyfile", "--archivio", dir, "--ticket", "TCK-7", "--uscita", uscita], `${identita}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(uscita, "utf8"), "<KeyFile>k</KeyFile>");
    assert.equal(statSync(uscita).mode & 0o777, 0o600);
    const di_nuovo = cli(["export-keyfile", "--archivio", dir, "--ticket", "TCK-8", "--uscita", uscita], `${identita}\n`);
    assert.notEqual(di_nuovo.status, 0);
    assert.ok(existsSync(uscita));
  });
});
