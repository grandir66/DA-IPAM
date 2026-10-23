/**
 * da-vault, passo 10: `scripts/da-vault.ts`, la riga di comando dell'appliance (crea, stato, ricifra). La passphrase
 * passa sullo stdin, mai come argomento; la ricifra è a vuoto senza `--applica`.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/da-vault-cli.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";

const PASS = "passphrase-cliente-cli-0123";
let dati: string;
let destinatario: string;

const cli = (args: string[], stdin: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "da-vault.ts"), ...args], {
    input: stdin,
    encoding: "utf8",
    cwd: process.cwd(),
    // Niente che arrivi dalla macchina: interruttore e credenziali di systemd li decide la prova.
    env: { ...process.env, DA_INVENT_DATA_DIR: dati, ENCRYPTION_KEY: "chiave-installazione-cli", DA_VAULT_LOCALE: "", CREDENTIALS_DIRECTORY: "", DA_VAULT_DIR: "", ...env },
  });

before(async () => {
  dati = mkdtempSync(join(tmpdir(), "da-vault-cli-"));
  destinatario = await identityToRecipient(await generateX25519Identity());
});

describe("scripts/da-vault.ts", () => {
  it("la passphrase come argomento è rifiutata", () => {
    const r = cli(["crea", PASS], "", { DA_VAULT_CHIAVE_DOMARC: destinatario });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /stdin/);
    assert.ok(!r.stderr.includes(PASS));
    assert.equal(existsSync(join(dati, "vault", "archivio.json")), false);
  });

  it("crea dallo stdin, con la chiave Domarc dalla configurazione; non stampa la passphrase", () => {
    const r = cli(["crea"], `${PASS}\n`, { DA_VAULT_CHIAVE_DOMARC: destinatario });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(PASS));
    const a = JSON.parse(readFileSync(join(dati, "vault", "archivio.json"), "utf8")) as { slot: Record<string, boolean> };
    assert.deepEqual(a.slot, { cliente: true, domarc: true, tpm: false });
  });

  it("stato non mostra segreti", () => {
    const r = cli(["stato"], "");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /slot cliente: sì/);
    assert.ok(!r.stdout.includes(PASS));
  });

  it("ricifra senza --applica è a vuoto e lo dice; senza DA_VAULT_LOCALE=1 rifiuta", () => {
    const spento = cli(["ricifra"], `${PASS}\n`);
    assert.notEqual(spento.status, 0);
    assert.match(spento.stderr, /DA_VAULT_LOCALE/);
    const r = cli(["ricifra"], `${PASS}\n`, { DA_VAULT_LOCALE: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /prova a vuoto/i);
  });
});
