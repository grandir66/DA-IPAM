import { test } from "node:test";
import assert from "node:assert/strict";
import { creaIndicePorte } from "@/lib/mappa-porte/nomi-porta";
import type { RigaFatto } from "@/lib/mappa-porte/tipi";

const fatto = (o: Partial<RigaFatto>): RigaFatto => ({ device_id: 1, source: "controller", port_name: "", port_index: null, lag_group: null, ...o });
const porte = [
  { device_id: 1, port_index: 5, port_name: "Slot: 0 Port: 5 Gigabit - Level" },
  { device_id: 1, port_index: 49, port_name: "Slot: 0 Port: 49 10G - Level" },
  { device_id: 1, port_index: 60, port_name: "Link Aggregate 1" },
  { device_id: 2, port_index: 30, port_name: "bond1" },
  { device_id: 2, port_index: 7, port_name: "sfp28-1" },
];
const fatti = [
  fatto({ port_name: "SFP+ 1", port_index: 49, lag_group: "lag:1" }),
  fatto({ port_name: "SFP+ 2", port_index: 50, lag_group: "lag:1" }),
  fatto({ port_name: "Port 5 - CITOFONO", port_index: 5 }),
  fatto({ device_id: 2, source: "device", port_name: "sfp28-1", lag_group: "bond1" }),
  fatto({ device_id: 2, source: "device", port_name: "bond1", lag_group: "bond1" }),
];
const ix = creaIndicePorte(porte, fatti);

test("gli stessi nomi di fonti diverse danno la stessa chiave", () => {
  assert.equal(ix.chiave(1, "Slot: 0 Port: 5 Gigabit - Level"), "i:5");
  assert.equal(ix.chiave(1, "Port 5"), "i:5");
  assert.equal(ix.chiave(1, "Port5"), "i:5");
  assert.equal(ix.chiave(1, "Port 5 - CITOFONO"), "i:5");
});

test("SFP+ 1 non è la porta 1: l'indice lo dice il controller (ProMax, 07/11)", () => {
  assert.notEqual(ix.chiave(1, "SFP_ 1"), "i:1");
  assert.equal(ix.chiave(1, "SFP_ 1"), "lag:1");
});

test("il membro di un LAG si piega sull'aggregato, anche il bond del MikroTik", () => {
  assert.equal(ix.chiave(1, "Link Aggregate 1"), "lag:1");
  assert.equal(ix.chiave(1, "qualsiasi", 50), "lag:1");
  assert.equal(ix.chiave(2, "sfp28-1"), "lag:bond1");
  assert.equal(ix.chiave(2, "bond1"), "lag:bond1");
  assert.equal(ix.chiave(2, "sfp28-1,bond1,br_in"), "lag:bond1");
});

test("CPU e bridge non sono porte, il wifi è una chiave sola, l'ignoto resta col suo nome", () => {
  assert.equal(ix.chiave(1, "CPU Interface for Slot: 5 Port: 1"), null);
  assert.equal(ix.chiave(1, "Port0"), null);
  assert.equal(ix.chiave(1, "bridge"), null);
  assert.equal(ix.chiave(1, ""), null);
  assert.equal(ix.chiave(1, "wifi"), "wifi");
  assert.equal(ix.chiave(1, "ens18"), "n:ens18");
});
