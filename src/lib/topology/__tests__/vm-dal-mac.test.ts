// Riccardo, 11/11/2026 (72729): «se ci sono degli hypervisor, di base le vm dovrebbero essere legate all'hypervisor e non
// allo switch in cui sono viste; si può usare il macaddress… se ci sono più host l'unico modo è la config letta
// direttamente dentro l'hypervisor». Dati inventati con la forma vera: nove VM VMware viste su una porta di uno switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { baseInput, dev, host } from "./support/righe";

const ORA = "2026-10-13 11:00:00";
const ESXI = "B4:7A:F1:00:00:06", VM1 = "00:50:56:00:00:01", VM2 = "00:0C:29:00:00:02", PC = "D4:5D:64:00:00:09";
const ingresso = (altri: ReturnType<typeof host>[] = []) => baseInput({
  devices: [dev(1, { name: "SW-1" })],
  hosts: [
    host(6, { mac: ESXI, hostname: "esxi01", classification: "hypervisor" }),
    host(7, { mac: VM1, hostname: "srv-a" }), host(8, { mac: VM2, hostname: "vcenter01" }), host(9, { mac: PC, hostname: "pc-9" }),
    ...altri,
  ],
  macPorts: [ESXI, VM1, VM2, PC].map((mac, n) => ({ device_id: 1, mac, port_name: n === 0 ? "Port 12" : n === 3 ? "Port 3" : "Port 10", timestamp: ORA, source: "device" })),
});

test("un solo hypervisor: gli oggetti con un MAC da VM stanno dentro di lui, non sotto lo switch", () => {
  const m = buildTopologyModel(ingresso());
  const dedotte = m.vms.filter((v) => v.hypervisorNodeId === "host:6");
  assert.deepEqual(dedotte.map((v) => v.nodeId).sort(), ["host:7", "host:8"]);
  assert.ok(!m.vms.some((v) => v.nodeId === "host:9"), "un PC con un MAC fisico non è una VM");
  // Fra la VM e lo switch che ne vede il MAC non resta un collegamento: la VM arriva dalle schede dell'hypervisor.
  assert.ok(!m.links.some((l) => [l.a, l.b].includes("host:7") && [l.a, l.b].includes("dev:1")));
});

test("due hypervisor: dal MAC non si deduce di chi è la VM, serve la lettura dell'hypervisor", () => {
  const m = buildTopologyModel(ingresso([host(10, { mac: "40:B0:34:00:00:10", classification: "hypervisor" })]));
  assert.equal(m.vms.length, 0);
});

test("un «hypervisor» che ha lui stesso un MAC da VM (il vCenter) non conta come hypervisor fisico", () => {
  const m = buildTopologyModel(ingresso([host(11, { mac: "00:0C:29:00:00:11", hostname: "vcsa", classification: "hypervisor" })]));
  assert.deepEqual(m.vms.map((v) => v.nodeId).sort(), ["host:11", "host:7", "host:8"]);
  assert.ok(m.vms.every((v) => v.hypervisorNodeId === "host:6"));
});
