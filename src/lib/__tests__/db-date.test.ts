/**
 * I timestamp di SQLite (`datetime('now')`) sono UTC senza fuso: "2026-10-12 08:00:00".
 * `new Date()` li leggeva come ora locale e le pagine mostravano orari 1-2 ore
 * indietro (difetto UI-2, analisi 2026-10-12). `parseDbDate` li legge come UTC e
 * per tutto il resto si comporta come `new Date()`.
 *
 * La prova imposta da sé il fuso (Europe/Rome, quello degli utenti) e lo rimette
 * com'era: senza, su una macchina in UTC passerebbe anche col difetto.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseDbDate } from "../db-date";

describe("parseDbDate", () => {
  let tzPrima: string | undefined;
  before(() => {
    tzPrima = process.env.TZ;
    process.env.TZ = "Europe/Rome";
  });
  after(() => {
    if (tzPrima === undefined) delete process.env.TZ;
    else process.env.TZ = tzPrima;
  });

  it("legge come UTC il formato di SQLite senza fuso", () => {
    assert.equal(parseDbDate("2026-10-12 08:00:00").toISOString(), "2026-10-12T08:00:00.000Z");
    assert.equal(parseDbDate("2026-10-12T08:00:00").toISOString(), "2026-10-12T08:00:00.000Z");
    assert.equal(parseDbDate("2026-10-12 08:00").toISOString(), "2026-10-12T08:00:00.000Z");
    assert.equal(parseDbDate("2026-10-12 08:00:00.250").toISOString(), "2026-10-12T08:00:00.250Z");
  });

  it("a Roma l'ora mostrata è quella giusta (UTC+2 in ottobre)", () => {
    const ora = parseDbDate("2026-10-12 08:00:00").toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    assert.equal(ora, "10:00");
  });

  it("tutto il resto passa invariato a new Date()", () => {
    for (const v of ["2026-10-12T08:00:00Z", "2026-10-12T08:00:00+02:00", "2026-10-12T08:00:00.000Z", "2026-10-12", 1760256000000]) {
      assert.equal(parseDbDate(v).getTime(), new Date(v).getTime(), String(v));
    }
    const d = new Date(1760256000000);
    assert.equal(parseDbDate(d).getTime(), d.getTime());
    assert.equal(parseDbDate(null).getTime(), new Date(0).getTime());
    assert.ok(Number.isNaN(parseDbDate(undefined).getTime()));
    assert.ok(Number.isNaN(parseDbDate("non una data").getTime()));
  });
});
