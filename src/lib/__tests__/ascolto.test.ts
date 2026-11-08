/**
 * Indirizzo su cui ascolta `server.ts` (`DA_ASCOLTO`, installazione «tecnico» su Mac, 08/11).
 * Sul portatile del tecnico, collegato alla LAN del cliente, DA-IPAM risponde solo al portatile
 * (`127.0.0.1`). Senza variabile resta `0.0.0.0`, come sempre: le appliance non cambiano.
 *
 * Run: node --import tsx --test src/lib/__tests__/ascolto.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { indirizzoAscolto } from "@/lib/ascolto";

test("senza variabile o vuota: 0.0.0.0 come oggi", () => {
  assert.equal(indirizzoAscolto({}), "0.0.0.0");
  assert.equal(indirizzoAscolto({ DA_ASCOLTO: "" }), "0.0.0.0");
  assert.equal(indirizzoAscolto({ DA_ASCOLTO: "  " }), "0.0.0.0");
});

test("indirizzo dichiarato", () => {
  assert.equal(indirizzoAscolto({ DA_ASCOLTO: "127.0.0.1" }), "127.0.0.1");
  assert.equal(indirizzoAscolto({ DA_ASCOLTO: " 127.0.0.1\n" }), "127.0.0.1");
});
