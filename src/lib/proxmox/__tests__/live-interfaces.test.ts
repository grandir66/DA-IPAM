// Schede vive di un hypervisor (spec §11.5, piano fase 2b Task 4): un solo
// comando SSH in sola lettura (`ip -j link show` + velocità da /sys/class/net)
// e la sua lettura, logica pura. Dati inventati con la forma vera dell'uscita di
// iproute2 su un nodo Proxmox (bond attivo/riserva, bridge, VLAN, tap delle VM).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_INTERFACES_COMMAND,
  hostIndexForTarget,
  mergeLiveIntoHost,
  parseLiveInterfaces,
  parseLiveOutput,
  parseSpeedLines,
  type LiveInterface,
} from "@/lib/proxmox/live-interfaces";
import { readLiveInterfaces } from "@/lib/proxmox/proxmox-ssh";
import type { ProxmoxHostInfo, ProxmoxNetworkInterface } from "@/lib/proxmox/proxmox-client";
import { IP_LINK, SPEED_LINES } from "./fixtures/live-node";

test("parseLiveInterfaces: bond con i membri, bridge, VLAN; tap, fwbr, veth, fwpr, fwln e loopback scartati", () => {
  const live = parseLiveInterfaces(IP_LINK, parseSpeedLines(SPEED_LINES));
  assert.deepEqual(live, [
    { name: "eno1", mac: "02:00:00:00:10:01", state: "up", speedMbps: 1000, master: "bond0", kind: "eth" },
    // Membro di riserva: il MAC vero è `permaddr` (address è quello del bond); -1 = velocità ignota.
    { name: "eno2", mac: "02:00:00:00:10:02", state: "down", speedMbps: null, master: "bond0", kind: "eth" },
    { name: "bond0", mac: "02:00:00:00:10:01", state: "up", speedMbps: 1000, master: "vmbr0", kind: "bond" },
    { name: "vmbr0", mac: "02:00:00:00:10:01", state: "up", speedMbps: null, master: null, kind: "bridge" },
    { name: "vmbr0.40", mac: "02:00:00:00:10:01", state: "up", speedMbps: null, master: null, kind: "vlan" },
  ] satisfies LiveInterface[]);
});

test("parseLiveInterfaces: il tipo viene da linkinfo.info_kind quando c'è, altrimenti dal nome", () => {
  const conInfo = parseLiveInterfaces(
    [
      { ifname: "uplink", operstate: "UP", link_type: "ether", address: "02:00:00:00:10:09", linkinfo: { info_kind: "bond" } },
      { ifname: "lan", operstate: "UP", link_type: "ether", address: "02:00:00:00:10:0a", linkinfo: { info_kind: "bridge" } },
      { ifname: "v40", operstate: "UP", link_type: "ether", address: "02:00:00:00:10:0b", linkinfo: { info_kind: "vlan" } },
      { ifname: "wg0", operstate: "UNKNOWN", link_type: "none", linkinfo: { info_kind: "wireguard" } },
      { ifname: "enp3s0f1", operstate: "LOWERLAYERDOWN", link_type: "ether", address: "02-00-00-00-10-0C" },
    ],
    {},
  );
  assert.deepEqual(
    conInfo.map((l) => [l.name, l.kind, l.state, l.mac]),
    [
      ["uplink", "bond", "up", "02:00:00:00:10:09"],
      ["lan", "bridge", "up", "02:00:00:00:10:0A"],
      ["v40", "vlan", "up", "02:00:00:00:10:0B"],
      ["wg0", "other", "unknown", null],
      ["enp3s0f1", "eth", "down", "02:00:00:00:10:0C"],
    ],
  );
});

test("parseLiveInterfaces: un'uscita che non è un elenco, o voci senza nome, non fanno danni", () => {
  assert.deepEqual(parseLiveInterfaces(null, {}), []);
  assert.deepEqual(parseLiveInterfaces({ ifname: "eno1" }, {}), []);
  assert.deepEqual(parseLiveInterfaces([null, 3, { operstate: "UP" }, { ifname: "" }], {}), []);
});

test("parseSpeedLines: numero positivo = Mbit/s; -1, vuoto o testo = null", () => {
  assert.deepEqual(parseSpeedLines(SPEED_LINES), {
    bond0: 1000,
    eno1: 1000,
    eno2: null,
    fwbr101i0: null,
    lo: null,
    tap100i0: 10,
    vmbr0: null,
    "vmbr0.40": null,
  });
  assert.deepEqual(parseSpeedLines("/sys/class/net/eno1/speed 10000\nrumore\n/sys/class/net/eno3/speed abc\n"), { eno1: 10000, eno3: null });
});

test("parseLiveOutput: JSON di ip, poi «---», poi le velocità", () => {
  const out = `${JSON.stringify(IP_LINK)}\n---\n${SPEED_LINES}\n`;
  const live = parseLiveOutput(out);
  assert.equal(live.length, 5);
  assert.equal(live.find((l) => l.name === "eno1")?.speedMbps, 1000);
  assert.throws(() => parseLiveOutput("bash: ip: command not found\n---\n"), /ip -j link/);
  assert.throws(() => parseLiveOutput(""), /ip -j link/);
});

test("il comando è uno solo e in sola lettura, scritto alla lettera", () => {
  assert.equal(
    LIVE_INTERFACES_COMMAND,
    'ip -j link show; echo ---; for f in /sys/class/net/*/speed; do echo "$f $(cat $f 2>/dev/null)"; done',
  );
  // Sola lettura: l'unica redirezione è quella degli errori verso /dev/null; nessun verbo che scrive.
  const senzaErrori = LIVE_INTERFACES_COMMAND.replaceAll("2>/dev/null", "");
  assert.doesNotMatch(senzaErrori, />|\btee\b|\brm\b|\b(ip\s+(-j\s+)?link\s+(set|add|del))\b|\bsysctl\b/);
});

test("readLiveInterfaces: una sola chiamata SSH con quel comando; un errore di trasporto o di comando è un errore", async () => {
  const chiamate: string[] = [];
  const exec = async (_o: unknown, cmd: string) => {
    chiamate.push(cmd);
    return { stdout: `${JSON.stringify(IP_LINK)}\n---\n${SPEED_LINES}\n`, stderr: "", code: 0 };
  };
  const live = await readLiveInterfaces({ host: "192.0.2.11", username: "root", password: "x" }, exec);
  assert.deepEqual(chiamate, [LIVE_INTERFACES_COMMAND]);
  assert.equal(live.length, 5);

  await assert.rejects(
    readLiveInterfaces({ host: "192.0.2.11", username: "root", password: "x" }, async () => ({ stdout: "", stderr: "no", code: 127 })),
    /schede vive/,
  );
});

function host(nome: string, schede: Array<Partial<ProxmoxNetworkInterface> & { name: string }>): ProxmoxHostInfo {
  return {
    hostname: nome, status: "online", uptime_seconds: null, uptime_human: null, cpu_model: null, cpu_mhz: null,
    cpu_sockets: null, cpu_cores: null, cpu_total_cores: null, memory_total_gb: null, memory_used_gb: null,
    memory_free_gb: null, memory_usage_percent: null, proxmox_version: null, kernel_version: null,
    rootfs_total_gb: null, rootfs_used_gb: null, storage: [], subscription: null, hardware_serial: null,
    hardware_model: null, hardware_manufacturer: null,
    network_interfaces: schede.map((s) => ({
      type: "eth", state: "down", mac_address: null, ip_addresses: null, bridge: null, vlan_id: null, speed_mbps: null, ...s,
    })),
  };
}

test("mergeLiveIntoHost: le schede con lo stesso nome ricevono MAC, stato, velocità e bond; le altre si aggiungono", () => {
  const h = host("pve-a", [
    { name: "eno1", type: "eth" },
    { name: "bond0", type: "bond" },
    { name: "vmbr0", type: "bridge", ip_addresses: "192.0.2.11", bridge: "bond0" },
    { name: "vmbr9", type: "bridge" }, // solo nella configurazione: resta com'è
  ]);
  const live = parseLiveInterfaces(IP_LINK, parseSpeedLines(SPEED_LINES));
  const m = mergeLiveIntoHost(h, live, "2026-10-14T03:00:00.000Z");
  assert.equal(m.live_read_at, "2026-10-14T03:00:00.000Z");
  const s = (n: string) => m.network_interfaces.find((i) => i.name === n);
  assert.deepEqual(s("eno1"), {
    name: "eno1", type: "eth", state: "up", mac_address: "02:00:00:00:10:01", ip_addresses: null, bridge: null,
    vlan_id: null, speed_mbps: "1000", master: "bond0",
  });
  assert.equal(s("vmbr0")?.ip_addresses, "192.0.2.11");
  assert.equal(s("vmbr0")?.bridge, "bond0");
  assert.equal(s("vmbr0")?.state, "up");
  assert.deepEqual(s("vmbr9"), h.network_interfaces[3]);
  assert.equal(s("vmbr9")?.master, undefined);
  // eno2 e vmbr0.40 non erano nella configurazione: entrano col tipo letto.
  assert.deepEqual(s("eno2"), {
    name: "eno2", type: "eth", state: "down", mac_address: "02:00:00:00:10:02", ip_addresses: null, bridge: null,
    vlan_id: null, speed_mbps: null, master: "bond0",
  });
  assert.equal(s("vmbr0.40")?.type, "vlan");
  assert.equal(m.network_interfaces.length, 6);
  // Il resto dell'host non cambia.
  assert.equal(m.hostname, "pve-a");
});

test("hostIndexForTarget: l'host del cluster che ha l'IP del bersaglio; uno solo = quello; altrimenti -1", () => {
  const a = host("pve-a", [{ name: "vmbr0", ip_addresses: "192.0.2.11" }]);
  const b = host("pve-b", [{ name: "vmbr0", ip_addresses: "192.0.2.12/24" }, { name: "vmbr1", ip_addresses: null }]);
  const c = host("pve-c", []);
  assert.equal(hostIndexForTarget([a, b, c], "192.0.2.12"), 1);
  assert.equal(hostIndexForTarget([a, b, c], "192.0.2.11"), 0);
  assert.equal(hostIndexForTarget([a, b, c], "192.0.2.13"), -1);
  assert.equal(hostIndexForTarget([c], "192.0.2.13"), 0);
  // Senza configurazione delle schede (API non letta) si guarda la scansione di prima.
  assert.equal(hostIndexForTarget([host("pve-a", []), host("pve-b", [])], "192.0.2.12", [a, b]), 1);
  assert.equal(hostIndexForTarget([host("pve-a", []), host("pve-b", [])], "192.0.2.13", [a, b]), -1);
});
