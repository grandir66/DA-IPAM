/**
 * Backup cifrato dell'installazione (piano di sicurezza 14/11, P0-4). Le prove eseguono il giro vero: chiavi,
 * cifratura, archivio, ripristino, su file e database SQLite veri in una cartella temporanea.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { cifraFile, decifraFile, generaChiaviRecupero, improntaChiave } from "../cifratura";
import { creaArchivioCifrato, ripristinaArchivio } from "../archivio";

function cartella(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bk-cifrato-"));
}

test("chiavi: la privata è un testo da busta, la pubblica non la contiene, l'impronta è la stessa dalle due", () => {
  const k = generaChiaviRecupero();
  assert.match(k.privata, /^DAINV-RK1(-[A-Z2-7]{4}){14}$/);
  assert.match(k.pubblica, /^DAINV-PUB1:[A-Za-z0-9+/]{43}=$/);
  assert.equal(improntaChiave(k.pubblica), improntaChiave(k.privata));
  assert.notEqual(generaChiaviRecupero().privata, k.privata);
});

test("andata e ritorno: file più grande di un blocco, vuoto, e di un blocco esatto", () => {
  const d = cartella();
  const k = generaChiaviRecupero();
  for (const n of [0, 1, 1024 * 1024, 2 * 1024 * 1024 + 17]) {
    const chiaro = path.join(d, `c-${n}`);
    const dati = Buffer.from(Buffer.alloc(n).map((_, i) => (i * 31) & 255));
    fs.writeFileSync(chiaro, dati);
    cifraFile(chiaro, `${chiaro}.cif`, k.pubblica);
    const cifrato = fs.readFileSync(`${chiaro}.cif`);
    if (n > 64) assert.equal(cifrato.includes(dati.subarray(0, 64)), false, "il cifrato non contiene il chiaro");
    decifraFile(`${chiaro}.cif`, `${chiaro}.out`, k.privata);
    assert.ok(fs.readFileSync(`${chiaro}.out`).equals(dati), `giro di ${n} byte`);
  }
});

test("la chiave di un'altra installazione non apre, e non resta un file a metà", () => {
  const d = cartella();
  const k = generaChiaviRecupero();
  fs.writeFileSync(path.join(d, "c"), "segreto del cliente");
  cifraFile(path.join(d, "c"), path.join(d, "c.cif"), k.pubblica);
  assert.throws(() => decifraFile(path.join(d, "c.cif"), path.join(d, "out"), generaChiaviRecupero().privata), /chiave di recupero non è quella/i);
  assert.equal(fs.existsSync(path.join(d, "out")), false);
});

test("una chiave ricopiata male dal foglio si riconosce prima di provare", () => {
  const k = generaChiaviRecupero();
  const sbagliata = k.privata.slice(0, -1) + (k.privata.endsWith("A") ? "B" : "A");
  assert.throws(() => improntaChiave(sbagliata), /ricopiata male/i);
  // Minuscole e spazi al posto dei trattini: sul foglio capita.
  assert.equal(improntaChiave(k.privata.toLowerCase().replace(/-/g, " ")), improntaChiave(k.pubblica));
});

test("un backup manomesso o troncato è rifiutato", () => {
  const d = cartella();
  const k = generaChiaviRecupero();
  fs.writeFileSync(path.join(d, "c"), Buffer.alloc(3 * 1024 * 1024, 1));
  cifraFile(path.join(d, "c"), path.join(d, "c.cif"), k.pubblica);
  const buono = fs.readFileSync(path.join(d, "c.cif"));
  const toccato = Buffer.from(buono);
  toccato[toccato.length - 40] ^= 1;
  fs.writeFileSync(path.join(d, "t.cif"), toccato);
  assert.throws(() => decifraFile(path.join(d, "t.cif"), path.join(d, "o1"), k.privata), /manomesso|rovinato/i);
  // Tagliato a un confine di blocco: ogni blocco rimasto è integro, manca solo la fine.
  fs.writeFileSync(path.join(d, "tr.cif"), buono.subarray(0, buono.length - (4 + 16)));
  assert.throws(() => decifraFile(path.join(d, "tr.cif"), path.join(d, "o2"), k.privata), /troncato|manomesso|rovinato/i);
  assert.equal(fs.existsSync(path.join(d, "o1")), false);
  assert.equal(fs.existsSync(path.join(d, "o2")), false);
});

test("archivio: database e chiavi tornano uguali in una cartella pulita, e il file non li mostra", async () => {
  const d = cartella();
  const dati = path.join(d, "data");
  fs.mkdirSync(path.join(dati, "tenants"), { recursive: true });
  const hub = new Database(path.join(dati, "hub.db"));
  hub.pragma("journal_mode = WAL");
  hub.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)");
  hub.prepare("INSERT INTO users (username) VALUES (?)").run("mario.rossi-unico");
  const t = new Database(path.join(dati, "tenants", "C001.db"));
  t.exec("CREATE TABLE hosts (ip TEXT)");
  t.prepare("INSERT INTO hosts VALUES (?)").run("10.99.88.77");
  const chiavi = path.join(d, ".env.local");
  fs.writeFileSync(chiavi, "ENCRYPTION_KEY=valore-finto-di-prova\n");
  const k = generaChiaviRecupero();
  const file = path.join(d, "backup.dainv");

  const esito = await creaArchivioCifrato({ dataDir: dati, fileChiavi: chiavi, uscita: file, pubblica: k.pubblica });
  hub.close();
  t.close();
  assert.deepEqual(esito.contenuto.sort(), [".env.local", "hub.db", "tenants/C001.db"]);
  const grezzo = fs.readFileSync(file);
  for (const parola of ["mario.rossi-unico", "10.99.88.77", "valore-finto-di-prova"]) {
    assert.equal(grezzo.includes(Buffer.from(parola)), false, `«${parola}» non si legge nel file`);
  }
  assert.equal(fs.statSync(file).mode & 0o077, 0, "il file non è leggibile da altri");

  const dove = path.join(d, "ripristino");
  const r = ripristinaArchivio({ file, privata: k.privata, destinazione: dove });
  assert.deepEqual(r.contenuto.sort(), [".env.local", "hub.db", "tenants/C001.db"]);
  assert.equal(fs.readFileSync(path.join(dove, ".env.local"), "utf8"), "ENCRYPTION_KEY=valore-finto-di-prova\n");
  const hub2 = new Database(path.join(dove, "hub.db"), { readonly: true });
  assert.deepEqual(hub2.prepare("SELECT username FROM users").all(), [{ username: "mario.rossi-unico" }]);
  hub2.close();
  const t2 = new Database(path.join(dove, "tenants", "C001.db"), { readonly: true });
  assert.deepEqual(t2.prepare("SELECT ip FROM hosts").all(), [{ ip: "10.99.88.77" }]);
  t2.close();
  // Niente copie in chiaro lasciate in giro accanto al backup.
  assert.deepEqual(fs.readdirSync(d).sort(), [".env.local", "backup.dainv", "data", "ripristino"]);
});

test("ripristino: non scrive sopra una cartella che ha già qualcosa", async () => {
  const d = cartella();
  const dati = path.join(d, "data");
  fs.mkdirSync(dati);
  new Database(path.join(dati, "hub.db")).exec("CREATE TABLE a (b)");
  const k = generaChiaviRecupero();
  const file = path.join(d, "b.dainv");
  await creaArchivioCifrato({ dataDir: dati, fileChiavi: null, uscita: file, pubblica: k.pubblica });
  assert.throws(() => ripristinaArchivio({ file, privata: k.privata, destinazione: dati }), /non è vuota/i);
});
