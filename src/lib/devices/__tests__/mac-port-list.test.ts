import { test } from "node:test";
import assert from "node:assert/strict";
import { macPortListFromPorts } from "@/lib/devices/mac-port-list";

const norm = (s: string) => s.trim().toLowerCase();

test("l'elenco per porta segue l'indice, poi il nome; un MAC ripetuto sulla stessa porta conta una volta", () => {
  const ports = [{ port_index: 3, port_name: "Port 3" }, { port_index: 7, port_name: "ether7" }];
  const byIndex = new Map([[3, { macs: ["AA:00:00:00:00:01", "AA:00:00:00:00:01", "AA:00:00:00:00:02"] }]]);
  const byName = new Map([["ether7", { macs: ["AA:00:00:00:00:03"] }]]);
  assert.deepEqual(macPortListFromPorts(ports, byIndex, byName, norm), [
    { mac: "AA:00:00:00:00:01", port_name: "Port 3" },
    { mac: "AA:00:00:00:00:02", port_name: "Port 3" },
    { mac: "AA:00:00:00:00:03", port_name: "ether7" },
  ]);
});

test("una porta senza MAC non produce righe", () => {
  assert.deepEqual(macPortListFromPorts([{ port_index: 1, port_name: "Port 1" }], new Map(), new Map(), norm), []);
});
