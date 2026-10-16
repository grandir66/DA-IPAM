// Prova dedicata alla precedenza longest-prefix (36 bit > 28 bit > 24 bit) su un
// artefatto FIXTURE, non sull'artefatto reale committato.
//
// Perché una fixture e non l'artefatto reale: interrogando `data/attribution-kb.sqlite`
// con sqlite3 (2026-07-28) risulta che, per costruzione IEEE, i blocchi MA-M (/28) e
// MA-S (/36) sono ritagliati da spazio indirizzi dedicato che NON compare mai come
// blocco MA-L (/24) a sé stante nello stesso file `manuf` — verificato con:
//   SELECT count(*) FROM oui o28 JOIN oui o24
//     ON o24.bits=24 AND o24.prefix=substr(o28.prefix,1,6) WHERE o28.bits=28;   -- → 0
// (stesso risultato per 36 vs 28 e 36 vs 24). Non esiste quindi, nei dati reali,
// un MAC il cui prefisso combaci contemporaneamente con righe reali a 24/28/36 bit,
// il che rende impossibile testare la PRECEDENZA (a differenza del singolo lookup
// per bit-length, testato in kb.test.ts con prefissi reali indipendenti) contro il
// file reale. Questa fixture usa STRINGHE VENDOR REALI, estratte con sqlite3
// dall'artefatto vero (Xerox Corporation / Shinko Technos co.,ltd. / Converging
// Systems Inc. — le stesse di kb.test.ts), assegnate a prefissi costruiti ad hoc
// (AAAAAA / AAAAAAB / AAAAAAB CD) in modo che nidifichino, per isolare l'algoritmo
// di precedenza dalla forma dei dati reali.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

describe("kb.ts — precedenza longest-prefix MAC (fixture)", () => {
  const originalCwd = process.cwd();
  let tmpDir: string;
  let kb: typeof import("../kb");

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-precedence-"));
    fs.mkdirSync(path.join(tmpDir, "data"));
    const dbPath = path.join(tmpDir, "data", "attribution-kb.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE kb_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE oui (
        prefix TEXT PRIMARY KEY,
        bits INTEGER NOT NULL,
        vendor_short TEXT,
        vendor_name TEXT NOT NULL
      );
      CREATE INDEX idx_oui_bits ON oui(bits);
      CREATE TABLE sysobj (
        oid TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        glpi_type TEXT,
        model TEXT
      );
    `);
    const insert = db.prepare(
      "INSERT INTO oui (prefix, bits, vendor_short, vendor_name) VALUES (?, ?, ?, ?)"
    );
    insert.run("AAAAAA", 24, "Xerox", "Xerox Corporation");
    insert.run("AAAAAAB", 28, "ShinkoTechno", "Shinko Technos co.,ltd.");
    insert.run("AAAAAABCD", 36, "Converging", "Converging Systems Inc.");
    db.close();

    process.chdir(tmpDir);
    kb = await import("../kb");
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("kbAvailable() true sulla fixture", () => {
    assert.equal(kb.kbAvailable(), true);
  });

  it("36 bit batte 28 e 24 quando tutti e tre combaciano", () => {
    const m = kb.kbLookupMac("AA:AA:AA:BC:DE:F0");
    assert.deepEqual(m, { vendor_name: "Converging Systems Inc.", vendor_short: "Converging", bits: 36 });
  });

  it("28 bit batte 24 quando il 36 non combacia", () => {
    const m = kb.kbLookupMac("AA:AA:AA:BF:F0:00");
    assert.deepEqual(m, { vendor_name: "Shinko Technos co.,ltd.", vendor_short: "ShinkoTechno", bits: 28 });
  });

  it("24 bit da solo quando né 28 né 36 combaciano", () => {
    const m = kb.kbLookupMac("AA:AA:AA:00:00:00");
    assert.deepEqual(m, { vendor_name: "Xerox Corporation", vendor_short: "Xerox", bits: 24 });
  });
});
