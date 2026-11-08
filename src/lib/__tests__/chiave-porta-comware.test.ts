/**
 * Incidente 2026-11-08, misurato su 70151: i 5 Comware avevano 0 porte con MAC in `switch_ports` contro 800-1.100 MAC
 * nella tabella per apparato. `switch_ports` porta i nomi lunghi («GigabitEthernet1/0/8», «Bridge-Aggregation109»),
 * `display mac-address` quelli corti («GE1/0/8», «BAGG109»), e la chiave di confronto toglieva solo spazi e maiuscole.
 * La chiave deve far coincidere le due forme; il nome mostrato resta quello letto.
 *
 * Run: node --import tsx --test src/lib/__tests__/chiave-porta-comware.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePortNameForMatch } from "@/lib/utils";
import { nomePorta } from "@/lib/acquisition/proiezioni";

const COPPIE: Array<[string, string]> = [
  ["GigabitEthernet1/0/8", "GE1/0/8"],
  ["GigabitEthernet1/0/39", "GE1/0/39"],
  ["Ten-GigabitEthernet1/0/1", "XGE1/0/1"],
  ["Bridge-Aggregation109", "BAGG109"],
  ["Bridge-Aggregation34", "BAGG34"],
  ["FortyGigE1/0/53", "FGE1/0/53"],
  ["HundredGigE1/0/25", "HGE1/0/25"],
  ["Twenty-FiveGigE1/0/1", "WGE1/0/1"],
  ["Route-Aggregation1", "RAGG1"],
  ["M-GigabitEthernet0/0/0", "MGE0/0/0"],
];

test("le due forme dei nomi Comware hanno la stessa chiave, nel giro e nel collector", () => {
  for (const [lungo, corto] of COPPIE) {
    assert.equal(normalizePortNameForMatch(lungo), normalizePortNameForMatch(corto), `${lungo} / ${corto}`);
    assert.equal(nomePorta(lungo), nomePorta(corto), `${lungo} / ${corto} (collector)`);
  }
});

test("porte diverse restano diverse", () => {
  assert.notEqual(normalizePortNameForMatch("GigabitEthernet1/0/8"), normalizePortNameForMatch("Ten-GigabitEthernet1/0/8"));
  assert.notEqual(normalizePortNameForMatch("GE1/0/8"), normalizePortNameForMatch("MGE1/0/8"));
  assert.notEqual(normalizePortNameForMatch("BAGG1"), normalizePortNameForMatch("RAGG1"));
});

test("gli altri nomi non cambiano chiave: spazi e maiuscole come prima", () => {
  for (const [nome, chiave] of [
    ["Port 1", "port1"], ["ether1", "ether1"], ["sfp28-2", "sfp28-2"], ["qsfp28-1-1", "qsfp28-1-1"], ["1", "1"], ["A1", "a1"],
    ["Trk1", "trk1"], ["1/1/48", "1/1/48"], ["Slot: 0 Port: 6 Gigabit - Level", "slot:0port:6gigabit-level"], ["ge-0/0/0", "ge-0/0/0"],
    ["Gi0/1", "gi0/1"],
  ] as const) {
    assert.equal(normalizePortNameForMatch(nome), chiave, nome);
    assert.equal(nomePorta(nome), chiave, `${nome} (collector)`);
  }
});
