/**
 * Vicino ↔ host di IPAM (22/10): prima l'IP, poi il MAC; senza IP né MAC non si può dire.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX") node --import tsx --test src/lib/scheda/__tests__/vicini-ipam.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { abbinaVicino, chiaveMac } from "../vicini-ipam";

const mappa = { ip: { "10.0.0.5": 11 }, mac: { "AABBCCDDEEFF": 22 } };

describe("chiaveMac", () => {
  it("normalizza separatori e maiuscole", () => {
    assert.equal(chiaveMac("aa:bb:cc:dd:ee:ff"), "AABBCCDDEEFF");
    assert.equal(chiaveMac("AA-BB-CC-DD-EE-FF"), "AABBCCDDEEFF");
  });
  it("un MAC che non ha 12 cifre non è un MAC", () => {
    assert.equal(chiaveMac("aa:bb"), null);
    assert.equal(chiaveMac(null), null);
  });
});

describe("abbinaVicino", () => {
  it("per IP", () => assert.deepEqual(abbinaVicino({ ip: "10.0.0.5" }, mappa), { hostId: 11 }));
  it("per MAC quando l'IP non c'è o non corrisponde", () => {
    assert.deepEqual(abbinaVicino({ mac: "aa:bb:cc:dd:ee:ff" }, mappa), { hostId: 22 });
    assert.deepEqual(abbinaVicino({ ip: "10.9.9.9", mac: "AA:BB:CC:DD:EE:FF" }, mappa), { hostId: 22 });
  });
  it("l'IP vince sul MAC", () => {
    assert.deepEqual(abbinaVicino({ ip: "10.0.0.5", mac: "AA:BB:CC:DD:EE:FF" }, mappa), { hostId: 11 });
  });
  it("IP o MAC senza host: assente (→ «non in IPAM»)", () => {
    assert.equal(abbinaVicino({ ip: "10.9.9.9" }, mappa), "assente");
    assert.equal(abbinaVicino({ mac: "11:22:33:44:55:66" }, mappa), "assente");
  });
  it("né IP né MAC (o MAC malformato): non si può dire", () => {
    assert.equal(abbinaVicino({}, mappa), null);
    assert.equal(abbinaVicino({ ip: " ", mac: "xx" }, mappa), null);
  });
  it("una chiave come «constructor» non è un host", () => {
    assert.equal(abbinaVicino({ ip: "constructor" }, mappa), "assente");
  });
});
