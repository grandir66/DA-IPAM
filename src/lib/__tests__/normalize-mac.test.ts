/**
 * `normalizeMac` con la forma di `arp -a` di macOS (installazione «tecnico» su Mac, 08/11).
 *
 * macOS scrive i byte senza lo zero davanti: `0:50:56:a5:4b:ab`. La versione di prima toglieva
 * i separatori e poi tagliava a coppie, e dava `05:05:6A:54:BA:` (misurato su questo Mac l'08/11):
 * un MAC sbagliato in `readArpCache`. Linux scrive sempre due cifre, e lì nulla cambia.
 *
 * Run: node --import tsx --test src/lib/__tests__/normalize-mac.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMac } from "@/lib/utils";

test("macOS: gruppi di una cifra completati con lo zero", () => {
  assert.equal(normalizeMac("0:50:56:a5:4b:ab"), "00:50:56:A5:4B:AB");
  assert.equal(normalizeMac("a:b:c:d:e:f"), "0A:0B:0C:0D:0E:0F");
  assert.equal(normalizeMac("bc:24:11:3:9e:5"), "BC:24:11:03:9E:05");
});

test("forme di sempre: risultato identico a prima", () => {
  assert.equal(normalizeMac("bc:24:11:3d:9e:52"), "BC:24:11:3D:9E:52");
  assert.equal(normalizeMac("BC-24-11-3D-9E-52"), "BC:24:11:3D:9E:52");
  assert.equal(normalizeMac("bc24113d9e52"), "BC:24:11:3D:9E:52");
  assert.equal(normalizeMac("BC:24:11:3D:9E:52"), "BC:24:11:3D:9E:52");
});
