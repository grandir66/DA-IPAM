/**
 * Il motore notturno col vault acceso (Riccardo, 15/11/2026): la cartella del giorno non lascia database in chiaro,
 * e da quella cartella si ripristina con la passphrase del cliente. Col vault bloccato e la chiave mai generata il
 * backup resta in chiaro e il manifesto lo dice come errore: niente ripiego muto.
 * Le variabili d'ambiente le mette e le toglie la prova.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { generateX25519Identity, identityToRecipient } from "age-encryption";

const PASS = "passphrase-del-cliente-lunga";
const d = fs.mkdtempSync(path.join(os.tmpdir(), "bk-motore-"));
const NOMI = ["DA_INVENT_DATA_DIR", "DA_INVENT_BACKUP_ROOT", "DA_VAULT_LOCALE", "DA_VAULT_DIR", "DA_INVENT_SECRETS_FILE"] as const;
const prima = Object.fromEntries(NOMI.map((n) => [n, process.env[n]]));
after(() => {
  for (const n of NOMI) {
    if (prima[n] === undefined) delete process.env[n];
    else process.env[n] = prima[n];
  }
});

test("vault acceso: prima bloccato (in chiaro, errore), poi aperto (cifrato e ripristinabile)", async () => {
  const dati = path.join(d, "data");
  fs.mkdirSync(path.join(dati, "tenants"), { recursive: true });
  const hub = new Database(path.join(dati, "hub.db"));
  hub.exec("CREATE TABLE t (v TEXT)");
  hub.prepare("INSERT INTO t VALUES (?)").run("riga-solo-qui");
  hub.close();
  new Database(path.join(dati, "tenants", "C001.db")).exec("CREATE TABLE h (ip TEXT)");
  fs.writeFileSync(path.join(d, ".env.local"), "ENCRYPTION_KEY=finta\n");
  process.env.DA_INVENT_DATA_DIR = dati;
  process.env.DA_INVENT_BACKUP_ROOT = path.join(d, "backup");
  process.env.DA_VAULT_LOCALE = "1";
  process.env.DA_VAULT_DIR = path.join(d, "vault");
  process.env.DA_INVENT_SECRETS_FILE = path.join(d, ".env.local");

  const { creaArchivio, apriConPassphrase } = await import("@/lib/vault/archivio");
  const { impostaChiaveDati, chiudiVault } = await import("@/lib/vault/stato");
  const { runHubBackup } = await import("@/lib/backup/engine");
  const { ripristinaBackupDelGiorno } = await import("../col-vault");
  const { chiave } = await creaArchivio(process.env.DA_VAULT_DIR, { passphrase: PASS, chiaveDomarc: await identityToRecipient(await generateX25519Identity()), scryptLogN: 10 });

  chiudiVault("prova");
  const bloccato = await runHubBackup(["C001"]);
  assert.equal(bloccato.cifrato, null);
  assert.ok(bloccato.errors.some((e) => /NON cifrato/.test(e)), "il manifesto dice che è rimasto in chiaro");

  impostaChiaveDati(chiave, "passphrase");
  const m = await runHubBackup(["C001"]);
  assert.deepEqual(m.errors, []);
  assert.match(m.cifrato ?? "", /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  const giorno = path.join(d, "backup", new Date().toISOString().slice(0, 10));
  assert.deepEqual(fs.readdirSync(giorno).sort(), ["installazione.dainv", "manifest.json", "vault"]);

  chiudiVault("prova");
  const dove = path.join(d, "ripristino");
  const r = await ripristinaBackupDelGiorno({ cartella: giorno, apri: (dir) => apriConPassphrase(dir, PASS), destinazione: dove });
  assert.deepEqual(r.contenuto.sort(), [".env.local", "hub.db", "tenants/C001.db"]);
  const h2 = new Database(path.join(dove, "hub.db"), { readonly: true });
  assert.deepEqual(h2.prepare("SELECT v FROM t").all(), [{ v: "riga-solo-qui" }]);
  h2.close();
});
