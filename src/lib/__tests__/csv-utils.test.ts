/**
 * UI-15 (analisi 2026-10-12): l'export CSV della Discovery metteva i valori così
 * com'erano. Un hostname o un banner che comincia con `=`, `+`, `-` o `@` Excel lo
 * apre come formula (CSV injection): si antepone un apostrofo, che Excel non mostra.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeCsvField, joinCsvRow } from "../csv-utils";

describe("escapeCsvField", () => {
  it("neutralizza i valori che Excel leggerebbe come formula", () => {
    assert.equal(escapeCsvField('=HYPERLINK("http://x","clic")'), `"'=HYPERLINK(""http://x"",""clic"")"`);
    assert.equal(escapeCsvField("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(escapeCsvField("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
    assert.equal(escapeCsvField("-2+3"), "'-2+3");
    assert.equal(escapeCsvField("\t=1"), "'\t=1");
  });
  it("lascia stare numeri, testo normale e vuoti", () => {
    assert.equal(escapeCsvField(-5), "-5");
    assert.equal(escapeCsvField("-12.5"), "-12.5");
    assert.equal(escapeCsvField("192.168.1.1"), "192.168.1.1");
    assert.equal(escapeCsvField("PC-MARIO"), "PC-MARIO");
    assert.equal(escapeCsvField(null), "");
    assert.equal(escapeCsvField("—"), "—");
  });
  it("mette ancora fra virgolette i valori con ; o a capo", () => {
    assert.equal(joinCsvRow(["a;b", "x"]), '"a;b";x');
  });
});
