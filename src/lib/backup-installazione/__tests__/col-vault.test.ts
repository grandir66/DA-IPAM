/**
 * Backup unificato (Riccardo, 15/11/2026: una passphrase sola). La chiave che apre i backup sta dentro il vault:
 * il cliente ci arriva con la sua passphrase, Domarc con la chiave di recupero, e non esiste una busta a parte.
 * Giro vero: archivio del vault, database SQLite, cartella del backup del giorno, ripristino in una cartella pulita.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { apriConDomarc, apriConPassphrase, creaArchivio } from "@/lib/vault/archivio";
import { copiaArchivioVault } from "@/lib/vault/backup";
import { chiavePubblicaBackup, cifraCartellaBackup, ripristinaBackupDelGiorno } from "../col-vault";

const PASS = "passphrase-del-cliente-lunga";

async function impianto() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bk-vault-"));
  const vault = path.join(d, "vault");
  const identita = await generateX25519Identity();
  const { chiave } = await creaArchivio(vault, { passphrase: PASS, chiaveDomarc: await identityToRecipient(identita), scryptLogN: 10 });
  // La cartella del giorno come la lascia il motore notturno: database compressi e copia dell'archivio.
  const giorno = path.join(d, "2026-11-15");
  fs.mkdirSync(path.join(giorno, "tenants"), { recursive: true });
  for (const [nome, riga] of [["hub.db", "utente-solo-qui"], ["tenants/C001.db", "host-solo-qui"]] as const) {
    const f = path.join(d, "tmp.db");
    const db = new Database(f);
    db.exec("CREATE TABLE t (v TEXT)");
    db.prepare("INSERT INTO t VALUES (?)").run(riga);
    db.close();
    fs.writeFileSync(path.join(giorno, `${nome}.gz`), zlib.gzipSync(fs.readFileSync(f)));
    fs.rmSync(f);
  }
  const chiavi = path.join(d, ".env.local");
  fs.writeFileSync(chiavi, "ENCRYPTION_KEY=finta-di-prova\n");
  return { d, vault, giorno, chiavi, chiave, identita };
}

test("la chiave dei backup nasce col vault aperto, resta la stessa, e la pubblica si legge anche a vault bloccato", async () => {
  const { vault, chiave } = await impianto();
  assert.equal(await chiavePubblicaBackup(vault, () => null), null, "vault bloccato e mai generata: niente chiave");
  const pub = await chiavePubblicaBackup(vault, () => chiave);
  assert.match(pub ?? "", /^DAINV-PUB1:/);
  assert.equal(await chiavePubblicaBackup(vault, () => chiave), pub);
  assert.equal(await chiavePubblicaBackup(vault, () => null), pub);
  // La privata non è leggibile nell'archivio: sta cifrata con la chiave degli slot.
  assert.equal(fs.readFileSync(path.join(vault, "segreti.json"), "utf8").includes("DAINV-RK1"), false);
});

test("giro intero: cartella cifrata, ripristino con la passphrase del cliente e con la chiave Domarc", async () => {
  const { d, vault, giorno, chiavi, chiave, identita } = await impianto();
  const pub = await chiavePubblicaBackup(vault, () => chiave);
  assert.ok(pub);
  copiaArchivioVault(vault, giorno);
  const e = await cifraCartellaBackup({ cartella: giorno, pubblica: pub, fileChiavi: chiavi });
  assert.deepEqual(e.dentro.sort(), [".env.local", "hub.db.gz", "tenants/C001.db.gz"]);
  // In chiaro nella cartella restano solo il file cifrato e l'archivio del vault (cifrato dagli slot).
  assert.deepEqual(fs.readdirSync(giorno).sort(), ["installazione.dainv", "vault"]);
  const grezzo = fs.readFileSync(path.join(giorno, "installazione.dainv"));
  assert.equal(grezzo.includes(Buffer.from("finta-di-prova")), false);

  for (const [nome, apri] of [
    ["cliente", (dir: string) => apriConPassphrase(dir, PASS)],
    ["domarc", (dir: string) => apriConDomarc(dir, identita)],
  ] as const) {
    const dove = path.join(d, `ripristino-${nome}`);
    const r = await ripristinaBackupDelGiorno({ cartella: giorno, apri, destinazione: dove });
    assert.deepEqual(r.contenuto.sort(), [".env.local", "hub.db", "tenants/C001.db"], nome);
    assert.equal(fs.readFileSync(path.join(dove, ".env.local"), "utf8"), "ENCRYPTION_KEY=finta-di-prova\n");
    const hub = new Database(path.join(dove, "hub.db"), { readonly: true });
    assert.deepEqual(hub.prepare("SELECT v FROM t").all(), [{ v: "utente-solo-qui" }]);
    hub.close();
    // L'archivio del vault torna con i dati: senza, le password nei database non si aprirebbero.
    assert.ok(fs.existsSync(path.join(dove, "vault", "archivio.json")));
    assert.ok(fs.existsSync(path.join(dove, "vault", "slot-cliente.age")));
  }
});

test("passphrase sbagliata: niente ripristino e niente cartella a metà", async () => {
  const { d, vault, giorno, chiavi, chiave } = await impianto();
  const pub = await chiavePubblicaBackup(vault, () => chiave);
  copiaArchivioVault(vault, giorno);
  await cifraCartellaBackup({ cartella: giorno, pubblica: pub!, fileChiavi: chiavi });
  const dove = path.join(d, "ripristino");
  await assert.rejects(ripristinaBackupDelGiorno({ cartella: giorno, apri: (dir) => apriConPassphrase(dir, "passphrase-sbagliata-lunga"), destinazione: dove }), /Passphrase errata/);
  assert.equal(fs.existsSync(dove), false);
});
