// Ordine di risoluzione di lookupVendorSync (Task 2): custom_oui.txt → KB → oui-data.
// I prefissi KB usati sono reali (vedi kb.test.ts per come sono stati scelti con sqlite3).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lookupVendorSync, invalidateCustomOuiCache } from "../mac-vendor";

describe("lookupVendorSync — ordine custom_oui.txt → KB → oui-data", () => {
  it("prefisso MA-M/28 assente in oui-data ma presente in KB → risolto dalla KB", () => {
    // 0055DA0 è un blocco /28 (MA-M): oui-data (solo MA-L/24) non lo conosce affatto.
    const v = lookupVendorSync("00:55:DA:0A:BB:CC");
    assert.equal(v, "Shinko Technos co.,ltd.");
  });

  it("prefisso MA-S/36 assente in oui-data ma presente in KB → risolto dalla KB", () => {
    const v = lookupVendorSync("00:1B:C5:00:0A:BC");
    assert.equal(v, "Converging Systems Inc.");
  });

  it("MAC totalmente sconosciuto (né custom, né KB, né oui-data) → null", () => {
    assert.equal(lookupVendorSync("FF:FF:FF:00:11:22"), null);
  });

  it("input vuoto → null, nessuna eccezione", () => {
    assert.equal(lookupVendorSync(""), null);
  });

  it("invalidateCustomOuiCache non rompe il lookup successivo (custom assente in questo repo)", () => {
    invalidateCustomOuiCache();
    const v = lookupVendorSync("00:55:DA:0A:BB:CC");
    assert.equal(v, "Shinko Technos co.,ltd.");
  });
});
