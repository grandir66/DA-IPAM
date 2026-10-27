/**
 * Correzioni della revisione del 23/10, rilievi 8 e 9 dalla riga di comando, su dati veri (popolati con le funzioni
 * dell'app): `ricifra --applica` elenca i backup rimasti con la chiave vecchia e propone `--purga-backup` (a vuoto di
 * default, cancella solo con `--applica`); `ricifra --inversa` riporta i valori alla chiave d'installazione.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/da-vault-cli-ricifra.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { chiaveInstallazione } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { chiudiVault } from "../stato";
import { popola, valoriDellaChiave, type DatiProva } from "./support/dati-ricifra";

const PASS = "passphrase-cliente-cli-0123";
const T = "CLIRICIFRA";
const RADICE = mkdtempSync(join(tmpdir(), "da-vault-cli-radice-"));
let dati: DatiProva;
let backup: string;
let campiIniziali = "";

const cli = (args: string[], stdin: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "da-vault.ts"), ...args], {
    input: stdin,
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, DA_INVENT_DATA_DIR: TEST_DATA_DIR, DA_INVENT_BACKUP_ROOT: RADICE, DA_VAULT_LOCALE: "1", CREDENTIALS_DIRECTORY: "", DA_VAULT_DIR: "", ...env },
  });

const tenantDb = () => join(TEST_DATA_DIR, "tenants", `${T}.db`);
const campiOra = () => withTenant(T, () => JSON.stringify(dati.idVoci.map((id) => campiVoceDb(getTenantDb(T), id))));
const conChiave = (k: Buffer) => [join(TEST_DATA_DIR, "hub.db"), tenantDb()].reduce((n, f) => n + valoriDellaChiave(f, k, [dati.totpCifrato]).length, 0);

before(async () => {
  delete process.env.DA_VAULT_LOCALE;
  dati = popola(T);
  campiIniziali = campiOra();
  closeTenantDb(T);
  closeHubDb();
  // Un backup notturno di prima, con i valori sulla chiave d'installazione.
  backup = join(tenantDb(), "..", `${T}.db.bak-20261020-101010`);
  const db = new Database(tenantDb(), { readonly: true });
  try {
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  mkdirSync(RADICE, { recursive: true });
  const dest = await identityToRecipient(await generateX25519Identity());
  const r = cli(["crea"], `${PASS}\n`, { DA_VAULT_CHIAVE_DOMARC: dest, DA_VAULT_LOCALE: "" });
  assert.equal(r.status, 0, r.stderr);
});

after(() => {
  chiudiVault(null);
  closeTenantDb(T);
  closeHubDb();
});

describe("ricifra dal CLI, backup e inversa", () => {
  it("--applica elenca il backup rimasto con la chiave vecchia e propone --purga-backup, senza cancellarlo", () => {
    const r = cli(["ricifra", "--applica"], `${PASS}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Ricifra APPLICATA/);
    assert.ok(r.stdout.includes(backup), r.stdout);
    assert.match(r.stdout, /--purga-backup/);
    assert.match(r.stdout, /fuori sede|Proxmox/i, "deve ricordare le copie fuori da qui");
    assert.equal(existsSync(backup), true, "il backup è stato cancellato senza --purga-backup");
    assert.equal(conChiave(chiaveInstallazione()), 0);
    // Col vault spento, in questo processo, i valori della chiave degli slot non si leggono (è il motivo della inversa).
    assert.notEqual(campiOra(), campiIniziali);
  });

  it("--purga-backup senza --applica è a vuoto: elenca e non cancella", () => {
    const r = cli(["ricifra", "--purga-backup"], `${PASS}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(backup));
    assert.match(r.stdout, /a vuoto/i);
    assert.equal(existsSync(backup), true);
  });

  it("--applica --purga-backup cancella i backup elencati e solo quelli", () => {
    const r = cli(["ricifra", "--applica", "--purga-backup"], `${PASS}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Backup cancellati: 1/);
    assert.equal(existsSync(backup), false);
    assert.equal(existsSync(tenantDb()), true);
  });

  it("--inversa a vuoto: non scrive niente e lo dice", () => {
    const k = conChiave(chiaveInstallazione());
    const r = cli(["ricifra", "--inversa"], `${PASS}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /INVERSA/);
    assert.match(r.stdout, /prova a vuoto/i);
    assert.equal(conChiave(chiaveInstallazione()), k);
  });

  it("--inversa --applica: i valori tornano alla chiave d'installazione e si dice come spegnere l'interruttore", () => {
    const r = cli(["ricifra", "--inversa", "--applica"], `${PASS}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Ricifra APPLICATA/);
    assert.match(r.stdout, /togli DA_VAULT_LOCALE/);
    assert.ok(conChiave(chiaveInstallazione()) >= 3);
    // A interruttore spento (questo processo) i campi si leggono con la sola ENCRYPTION_KEY, come prima della ricifra.
    assert.equal(campiOra(), campiIniziali);
  });
});
