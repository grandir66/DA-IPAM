// Porte note di un oggetto per «Collega a…» (spec §11.3, piano fase 2b Task 9):
// porte dello switch con velocità e PoE, oppure schede dell'hypervisor dalla
// scansione Proxmox. Dati inventati con la forma vera (IP 192.0.2.x, MAC 02:00:00:…).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hypervisorNics, switchPortsToKnown } from "@/lib/topology/known-ports";

test("porte dello switch: velocità come la scrive la fonte, PoE in W, note in parole", () => {
  const p = switchPortsToKnown([
    { port_name: "Port 1", speed: "10000 Mbps", poe_power_mw: null, status: "up", is_uplink: 1, is_trunk: 0 },
    { port_name: "Port 2", speed: "1000 Mbps", poe_power_mw: 4500, status: "up", is_uplink: 0, is_trunk: 0 },
    { port_name: "Port 3", speed: null, poe_power_mw: 0, status: "down", is_uplink: 0, is_trunk: 1 },
    { port_name: "Port 4", speed: "", poe_power_mw: null, status: "disabled", is_uplink: 0, is_trunk: 0 },
  ]);
  assert.deepEqual(p, [
    { name: "Port 1", speed: "10000 Mbps", poeW: null, kind: "switch_port", note: "uplink" },
    { name: "Port 2", speed: "1000 Mbps", poeW: 4.5, kind: "switch_port", note: null },
    { name: "Port 3", speed: null, poeW: null, kind: "switch_port", note: "trunk, giù" },
    { name: "Port 4", speed: null, poeW: null, kind: "switch_port", note: "disabilitata" },
  ]);
});

const scan = (hosts: unknown[], scannedAt = "2026-10-13T06:00:00.000Z") => JSON.stringify({ scanned_at: scannedAt, hosts, vms: [] });
const vive = [
  { name: "vmbr0", type: "bridge", state: "up", mac_address: "02:00:00:00:10:01", ip_addresses: "192.0.2.11/24", speed_mbps: null, master: null },
  { name: "bond0", type: "bond", state: "up", mac_address: "02:00:00:00:10:01", ip_addresses: null, speed_mbps: "1000", master: "vmbr0" },
  { name: "eno2", type: "eth", state: "down", mac_address: "02:00:00:00:10:02", ip_addresses: null, speed_mbps: null, master: "bond0" },
  { name: "eno1", type: "eth", state: "up", mac_address: "02:00:00:00:10:01", ip_addresses: null, speed_mbps: "1000", master: "bond0" },
  { name: "tap100i0", type: "eth", state: "up", mac_address: "02:00:00:00:20:01", ip_addresses: null, speed_mbps: null, master: "vmbr0" },
];

test("schede dell'hypervisor: l'host della scansione con l'IP dell'apparato; prima le schede fisiche, niente schede di VM", () => {
  const raw = scan([
    { hostname: "pve-b", network_interfaces: [{ name: "eno1", type: "eth", state: "down", mac_address: null, ip_addresses: "192.0.2.12/24", speed_mbps: null }] },
    { hostname: "pve-a", live_read_at: "2026-10-13T06:00:00.000Z", network_interfaces: vive },
  ]);
  const p = hypervisorNics({ id: 3, host: "192.0.2.11", name: "pve-a" }, [{ id: 3, raw }]);
  assert.deepEqual(p.map((x) => [x.name, x.speed, x.note]), [
    ["eno1", "1000 Mbps", "membro di bond0"],
    ["eno2", null, "membro di bond0, giù"],
    ["bond0", "1000 Mbps", "bond, membro di vmbr0"],
    ["vmbr0", null, "bridge"],
  ]);
  assert.ok(p.every((x) => x.kind === "hypervisor_nic" && x.poeW === null));
});

test("schede dell'hypervisor: un nodo del cluster letto da un altro apparato; lo stato della sola configurazione non si dice", () => {
  const raw = scan([
    { hostname: "pve-a", network_interfaces: vive },
    // Scansione senza schede vive: «down» è quello che dice sempre la configurazione, non vuol dire niente.
    { hostname: "pve-b", network_interfaces: [{ name: "eno1", type: "eth", state: "down", mac_address: "192.168.100.123", ip_addresses: "192.0.2.12/24", speed_mbps: null }] },
  ]);
  assert.deepEqual(hypervisorNics({ id: 9, host: "192.0.2.12", name: "pve-b.example.local" }, [{ id: 3, raw }]), [
    { name: "eno1", speed: null, poeW: null, kind: "hypervisor_nic", note: null },
  ]);
  // Per nome (senza dominio) quando l'IP non si trova.
  assert.equal(hypervisorNics({ id: 9, host: "192.0.2.99", name: "PVE-B" }, [{ id: 3, raw }]).length, 1);
});

test("schede dell'hypervisor: fra due scansioni dello stesso host vince quella dell'apparato stesso, poi la più recente", () => {
  const vecchia = scan([{ hostname: "pve-a", network_interfaces: [{ name: "eth9", type: "eth", ip_addresses: "192.0.2.11/24" }] }], "2026-05-22T10:00:00.000Z");
  const nuova = scan([{ hostname: "pve-a", network_interfaces: [{ name: "eno1", type: "eth", ip_addresses: "192.0.2.11/24" }] }]);
  assert.deepEqual(hypervisorNics({ id: 4, host: "192.0.2.11", name: "pve-a" }, [{ id: 3, raw: vecchia }, { id: 5, raw: nuova }]).map((x) => x.name), ["eno1"]);
  assert.deepEqual(hypervisorNics({ id: 3, host: "192.0.2.11", name: "pve-a" }, [{ id: 3, raw: vecchia }, { id: 5, raw: nuova }]).map((x) => x.name), ["eth9"]);
});

test("schede dell'hypervisor: un host solo nella propria scansione vale anche senza IP; JSON rovinato o nessun abbinamento = nessuna scheda", () => {
  const solo = scan([{ hostname: "nodo", network_interfaces: [{ name: "eno1", type: "eth" }] }]);
  assert.equal(hypervisorNics({ id: 3, host: "192.0.2.50", name: "altro" }, [{ id: 3, raw: solo }]).length, 1);
  assert.deepEqual(hypervisorNics({ id: 4, host: "192.0.2.50", name: "altro" }, [{ id: 3, raw: solo }]), []);
  assert.deepEqual(hypervisorNics({ id: 3, host: "192.0.2.50", name: "altro" }, [{ id: 3, raw: "{rotto" }]), []);
});
