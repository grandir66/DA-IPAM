/**
 * La scelta a mano della classe arriva al motore (11/11/2026, hub 533: 106 scelte a mano,
 * nessuna evidenza `manual`; il telefono scelto «smartphone» restava «macchina virtuale»).
 *
 * Run: node --import tsx --test src/lib/attribution/__tests__/scelta-a-mano.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { allineaSceltaAMano, SEGNO_SCELTA_A_MANO } from "../scelta-a-mano";
import { fuseAttribution } from "../fuse";
import { getActiveEvidence } from "../evidence";

let db: Database.Database;
const ORA = "2026-11-11T10:00:00.000Z";

function host(classe: string | null, manuale: number | null) {
  db.prepare("INSERT OR REPLACE INTO hosts (id, classification, classification_manual) VALUES (1, ?, ?)").run(classe, manuale);
}
function manuali(): Array<{ claim: string; raw_value: string | null; expires_at: string | null; superseded_by: number | null }> {
  return db.prepare("SELECT claim, raw_value, expires_at, superseded_by FROM attribution_evidence WHERE source = 'manual' ORDER BY id")
    .all() as Array<{ claim: string; raw_value: string | null; expires_at: string | null; superseded_by: number | null }>;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE hosts (id INTEGER PRIMARY KEY, classification TEXT, classification_manual INTEGER);
    CREATE TABLE attribution_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER NOT NULL, source TEXT NOT NULL,
      phase TEXT NOT NULL, dimension TEXT NOT NULL, claim TEXT NOT NULL, confidence REAL NOT NULL, weight REAL NOT NULL,
      raw_value TEXT, observed_at TEXT DEFAULT (datetime('now')), expires_at TEXT, superseded_by INTEGER);`);
});

describe("allineaSceltaAMano", () => {
  it("scelta a mano → evidenza manual della categoria corrispondente, e vince la fusione", () => {
    host("smartphone", 1);
    db.prepare("INSERT INTO attribution_evidence (host_id, source, phase, dimension, claim, confidence, weight) VALUES (1, 'snmp_sysobj', 'snmp', 'category', 'peripheral.printer', 0.95, 1)").run();
    assert.equal(allineaSceltaAMano(db, 1, ORA), "scritta");
    assert.deepEqual(manuali().map((m) => [m.claim, m.raw_value]), [["mobile.phone", SEGNO_SCELTA_A_MANO]]);
    const fusa = fuseAttribution(getActiveEvidence(db, 1), ORA);
    assert.equal(fusa.category.claim, "mobile.phone");
  });
  it("rifatta senza cambi non scrive niente", () => {
    host("stampante", 1);
    allineaSceltaAMano(db, 1, ORA);
    assert.equal(allineaSceltaAMano(db, 1, ORA), "niente");
    assert.equal(manuali().length, 1);
  });
  it("scelta cambiata → la nuova sostituisce la vecchia", () => {
    host("stampante", 1);
    allineaSceltaAMano(db, 1, ORA);
    host("smartphone", 1);
    assert.equal(allineaSceltaAMano(db, 1, ORA), "scritta");
    const vive = manuali().filter((m) => m.superseded_by == null && m.expires_at == null);
    assert.deepEqual(vive.map((m) => m.claim), ["mobile.phone"]);
  });
  it("scelta tolta (torna automatica) → l'evidenza si ritira", () => {
    host("smartphone", 1);
    allineaSceltaAMano(db, 1, ORA);
    host("smartphone", 0);
    assert.equal(allineaSceltaAMano(db, 1, ORA), "ritirata");
    assert.equal(manuali()[0].expires_at, ORA);
  });
  it("senza scelta a mano (0 o NULL), o classe che non ha categoria, non scrive", () => {
    host("smartphone", 0);
    assert.equal(allineaSceltaAMano(db, 1, ORA), "niente");
    host("smartphone", null);
    assert.equal(allineaSceltaAMano(db, 1, ORA), "niente");
    host("classe_inventata", 1);
    assert.equal(allineaSceltaAMano(db, 1, ORA), "niente");
    assert.equal(manuali().length, 0);
  });
  it("un'evidenza manual nata altrove (IP contesi) non si ritira da qui", () => {
    host("smartphone", 0);
    db.prepare("INSERT INTO attribution_evidence (host_id, source, phase, dimension, claim, confidence, weight, raw_value) VALUES (1, 'manual', 'manual', 'category', 'voip.phone', 1, 1, 'altro')").run();
    assert.equal(allineaSceltaAMano(db, 1, ORA), "niente");
    assert.equal(manuali()[0].expires_at, null);
  });
});
