/**
 * Propagazione all'apparato delle colonne vuote e segno «da rivedere»
 * (Riccardo, 05/11/2026). DB in memoria: niente tenant, niente file.
 *
 * Run: node --import tsx --test src/lib/scanner/profili/__tests__/propaga-apparato.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { propagaAllApparato, segnaDaRivedere, serialePropagabile } from "../propaga-apparato";

let db: Database.Database;

/** Lo stretto necessario delle due tabelle vere, colonne comprese quelle nuove. */
function apparecchia(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE hosts (id INTEGER PRIMARY KEY, ip TEXT, campi_da_rivedere TEXT);
    CREATE TABLE network_devices (
      id INTEGER PRIMARY KEY, name TEXT, host_id INTEGER,
      model TEXT, serial_number TEXT, firmware TEXT,
      campi_da_rivedere TEXT, updated_at TEXT
    );
    INSERT INTO hosts (id, ip) VALUES (7, '192.168.0.7');
  `);
  return d;
}

const apparato = (campi: Partial<{ model: string; serial_number: string; firmware: string }> = {}) =>
  db
    .prepare(
      "INSERT INTO network_devices (name, host_id, model, serial_number, firmware) VALUES ('sw', 7, ?, ?, ?)",
    )
    .run(campi.model ?? null, campi.serial_number ?? null, campi.firmware ?? null).lastInsertRowid as number;

const letto = (id: number) =>
  db.prepare("SELECT model, serial_number, firmware, campi_da_rivedere FROM network_devices WHERE id = ?").get(id) as {
    model: string | null;
    serial_number: string | null;
    firmware: string | null;
    campi_da_rivedere: string | null;
  };

beforeEach(() => {
  db = apparecchia();
});

describe("propagaAllApparato", () => {
  it("apparato vuoto: scrive le tre colonne e le segna da rivedere, in ordine", () => {
    const id = apparato();
    const e = propagaAllApparato(db, 7, { modello: "TS-231K", seriale: "CZJ2291NHC", firmware: "5.0.1" });
    assert.deepEqual(e.scritte.sort(), ["firmware", "model", "serial_number"]);
    const r = letto(id);
    assert.equal(r.model, "TS-231K");
    assert.equal(r.serial_number, "CZJ2291NHC");
    assert.equal(r.firmware, "5.0.1");
    assert.equal(r.campi_da_rivedere, "firmware,model,serial_number");
  });

  it("colonna gia' piena: non si tocca, e il motivo si dice", () => {
    const id = apparato({ model: "modello messo a mano" });
    const e = propagaAllApparato(db, 7, { modello: "TS-231K", firmware: "5.0.1" });
    assert.deepEqual(e.scritte, ["firmware"]);
    assert.ok(e.saltate.some((s) => s.colonna === "model" && s.motivo === "piena"));
    assert.equal(letto(id).model, "modello messo a mano");
    assert.equal(letto(id).campi_da_rivedere, "firmware", "si segna solo cio' che abbiamo scritto noi");
  });

  it("seriale finto: non entra nella chiave degli apparati", () => {
    const id = apparato();
    const e = propagaAllApparato(db, 7, { seriale: "MFG:HP;MDL:LaserJet;CMD:PJL;" });
    assert.deepEqual(e.scritte, []);
    assert.ok(e.saltate.some((s) => s.colonna === "serial_number" && s.motivo === "seriale non valido"));
    assert.equal(letto(id).serial_number, null);
  });

  it("host senza apparato: non succede niente", () => {
    const e = propagaAllApparato(db, 7, { modello: "TS-231K" });
    assert.equal(e.apparatoId, null);
    assert.deepEqual(e.scritte, []);
  });

  it("prova a vuoto: dice cosa scriverebbe e non scrive", () => {
    const id = apparato();
    const e = propagaAllApparato(db, 7, { modello: "TS-231K", firmware: "5.0.1" }, { soloProva: true });
    assert.deepEqual(e.scritte.sort(), ["firmware", "model"]);
    const r = letto(id);
    assert.equal(r.model, null);
    assert.equal(r.firmware, null);
    assert.equal(r.campi_da_rivedere, null);
  });
});

describe("segnaDaRivedere", () => {
  it("unisce senza doppioni e in ordine", () => {
    const id = apparato();
    segnaDaRivedere(db, "network_devices", id, ["model"]);
    segnaDaRivedere(db, "network_devices", id, ["firmware", "model"]);
    assert.equal(letto(id).campi_da_rivedere, "firmware,model");
  });

  it("riga che non esiste: non lancia", () => {
    assert.doesNotThrow(() => segnaDaRivedere(db, "network_devices", 999, ["model"]));
  });

  it("elenco vuoto: non scrive", () => {
    const id = apparato();
    segnaDaRivedere(db, "network_devices", id, []);
    assert.equal(letto(id).campi_da_rivedere, null);
  });
});

describe("serialePropagabile", () => {
  it("scarta i nomi di serie, le stringhe 1284, i valori corti e gli zeri", () => {
    assert.equal(serialePropagabile("ET-5805 Series"), false);
    assert.equal(serialePropagabile("MFG:HP;MDL:X;CMD:PJL;"), false);
    assert.equal(serialePropagabile("abc"), false);
    assert.equal(serialePropagabile("0000000"), false);
    assert.equal(serialePropagabile(undefined), false);
  });

  it("accetta un seriale vero", () => {
    assert.equal(serialePropagabile("CZJ2291NHC"), true);
    assert.equal(serialePropagabile("0x60c12345"), true);
  });
});
