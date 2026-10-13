import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNodeIndex, resolveNode, nodeFor, canonical } from "@/lib/topology/node-index";
import { dev, host } from "./support/righe";

test("l'host collegato all'apparato si fonde: IP, MAC e nome portano all'apparato", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1", host_id: 40, name: "PVE-1", device_type: "hypervisor" })],
    [host(40, { ip: "10.0.0.1", mac: "AA-BB-CC-00-00-01", hostname: "pve-1.dominio.local", classification: "hypervisor" })],
    [],
  );
  assert.equal(idx.fusedHosts, 1);
  assert.equal(canonical(idx, "host:40"), "dev:1");
  assert.equal(resolveNode(idx, { mac: "aa:bb:cc:00:00:01" }), "dev:1");
  assert.equal(resolveNode(idx, { name: "PVE-1.altro.dominio" }), "dev:1");
  assert.deepEqual(idx.nodes.get("dev:1")?.fusedHostIds, [40]);
  assert.equal(idx.nodes.has("host:40"), false);
});

test("si fonde anche per stesso IP e per stessa identità fisica", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1" }), dev(2, { host: "10.0.0.2", physical_device_id: 7 })],
    [host(40, { ip: "10.0.0.1" }), host(41, { ip: "10.9.9.9", physical_device_id: 7 })],
    [],
  );
  assert.equal(canonical(idx, "host:40"), "dev:1");
  assert.equal(canonical(idx, "host:41"), "dev:2");
});

test("MAC conteso fra due apparati: non abbina (Review Focus 2)", () => {
  const idx = buildNodeIndex(
    [dev(1, { controller_mac: "00:00:5e:00:01:01" }), dev(2)],
    [],
    [{ device_id: 2, mac: "00:00:5E:00:01:01" }],
  );
  assert.equal(resolveNode(idx, { mac: "00:00:5e:00:01:01" }), null);
  assert.equal(resolveNode(idx, { mac: "00:00:5e:00:01:01", name: "SW-2" }), "dev:2", "MAC conteso: si passa al nome");
});

test("nome uguale fra due apparati: non abbina per nome", () => {
  const idx = buildNodeIndex([dev(1, { name: "core" }), dev(2, { name: "CORE" })], [], []);
  assert.equal(resolveNode(idx, { name: "core" }), null);
});

test("un host non contende il nome a un apparato", () => {
  const idx = buildNodeIndex([dev(1, { name: "nas-1" })], [host(50, { hostname: "nas-1" })], []);
  assert.equal(resolveNode(idx, { name: "NAS-1" }), "dev:1");
});

test("un nome che è un IP o un MAC non si abbina come nome (Review Focus 3)", () => {
  const idx = buildNodeIndex(
    [dev(1, { name: "192" }), dev(2, { controller_mac: "aa:bb:cc:00:00:02" })],
    [],
    [],
  );
  assert.equal(resolveNode(idx, { name: "192.168.1.1" }), null);
  assert.equal(resolveNode(idx, { name: "AA:BB:CC:00:00:02" }), "dev:2", "un nome a forma di MAC vale come MAC");
});

test("un host non fuso diventa nodo solo quando serve", () => {
  const idx = buildNodeIndex([dev(1)], [host(60, { ip: "10.0.1.60", custom_name: "SRV-BACKUP" })], []);
  assert.equal(idx.nodes.has("host:60"), false);
  const id = resolveNode(idx, { ip: "10.0.1.60" });
  assert.equal(id, "host:60");
  assert.equal(idx.nodes.get("host:60")?.name, "SRV-BACKUP");
  assert.equal(nodeFor(idx, "host:999"), null);
});

test("un host con IP diverso ma il MAC (controller_mac) di un solo apparato si fonde con lui", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1", controller_mac: "AA-BB-CC-00-00-01" })],
    [host(60, { ip: "10.0.50.1", mac: "aa:bb:cc:00:00:01" })],
    [],
  );
  assert.equal(canonical(idx, "host:60"), "dev:1");
  assert.equal(resolveNode(idx, { ip: "10.0.50.1" }), "dev:1");
  assert.equal(idx.fusedHosts, 1);
  assert.deepEqual(idx.nodes.get("dev:1")?.fusedHostIds, [60]);
});

test("lo stesso vale per un MAC delle righe knownMacs", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1" })],
    [host(61, { ip: "10.0.60.1", mac: "AA:BB:CC:00:00:09" })],
    [{ device_id: 1, mac: "aa-bb-cc-00-00-09" }],
  );
  assert.equal(canonical(idx, "host:61"), "dev:1");
  assert.equal(resolveNode(idx, { ip: "10.0.60.1" }), "dev:1");
});

test("un MAC di due apparati (VRRP) non fonde nessun host", () => {
  const idx = buildNodeIndex(
    [dev(1, { controller_mac: "00:00:5e:00:01:01" }), dev(2)],
    [host(62, { ip: "10.0.70.1", mac: "00:00:5E:00:01:01" })],
    [{ device_id: 2, mac: "00:00:5e:00:01:01" }],
  );
  assert.equal(canonical(idx, "host:62"), "host:62");
  assert.equal(idx.fusedHosts, 0);
});

test("un host già fuso per host_id non si sposta per MAC", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1", host_id: 63 }), dev(2, { controller_mac: "aa:bb:cc:00:00:63" })],
    [host(63, { ip: "10.0.0.1", mac: "aa:bb:cc:00:00:63" })],
    [],
  );
  assert.equal(canonical(idx, "host:63"), "dev:1");
  assert.equal(idx.fusedHosts, 1);
  assert.deepEqual(idx.nodes.get("dev:2")?.fusedHostIds, []);
});
