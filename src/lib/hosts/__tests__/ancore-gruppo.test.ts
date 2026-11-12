// Ancore del motore dei gruppi: i casi di DTS del 12/11/2026 (seriale «F2510000.USB3» su quattro MikroTik diversi,
// MAC VRRP condiviso, MAC casuale dei telefoni).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ancoraDiModello, macAncora, serialeAncora } from "../ancore-gruppo";

test("la porta USB dei MikroTik non è un seriale", () => {
  assert.equal(serialeAncora("f2510000.usb3"), null);
  assert.equal(serialeAncora("F2510000.USB3"), null);
  assert.equal(serialeAncora("HG109XYZ12"), "HG109XYZ12");
  assert.equal(serialeAncora("abc"), null);
});

test("un MAC vero è un'ancora, in maiuscolo", () => {
  assert.equal(macAncora("48:a9:8a:bd:c3:98"), "48:A9:8A:BD:C3:98");
  assert.equal(macAncora("78-9A-18-02-BA-C6"), "78:9A:18:02:BA:C6");
});

test("VRRP, HSRP, MAC casuali e vuoti non uniscono", () => {
  assert.equal(macAncora("00:00:5E:00:01:B4"), null);
  assert.equal(macAncora("00:00:0C:07:AC:01"), null);
  assert.equal(macAncora("9A:97:14:EF:EC:8F"), null);
  assert.equal(macAncora("EA:C7:85:A6:3D:C0"), null);
  assert.equal(macAncora(null), null);
  assert.equal(macAncora("00:00:00:00:00:00"), null);
});

test("i segnaposto dei BIOS non sono seriali", () => {
  assert.equal(serialeAncora("Default string"), null);
  assert.equal(serialeAncora("To be filled by O.E.M."), null);
  assert.equal(serialeAncora("BSS-0123456789"), null);
});

test("diciotto telefoni dello stesso modello non sono un apparato, un router con dodici indirizzi sì", () => {
  const diciotto = Array.from({ length: 14 }, (_, i) => `80:5E:C0:00:00:${String(i).padStart(2, "0")}`);
  assert.equal(ancoraDiModello(18, diciotto), true);
  assert.equal(ancoraDiModello(12, ["48:A9:8A:BD:C3:98", "48:A9:8A:BD:C3:98", "48:A9:8A:BD:C3:99"]), false);
  assert.equal(ancoraDiModello(2, ["AA", "BB"]), false);
});
