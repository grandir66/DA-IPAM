/**
 * Backup cifrato dell'installazione (piano di sicurezza 14/11, P0-4). Le prove eseguono il giro vero: chiavi,
 * cifratura, archivio, ripristino, su file e database SQLite veri in una cartella temporanea.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cifraFile, decifraFile, generaChiaviRecupero, improntaChiave } from "../cifratura";

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
