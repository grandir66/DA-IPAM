// Scansione Proxmox di un apparato con le schede vive (piano fase 2b, Task 4) e
// Review Focus 4: una scansione fallita o incompleta non sovrascrive mai la
// precedente, e la data resta quella vecchia (mai «0 VM» al posto delle VM di
// ieri). Niente rete: API, SSH e schede vive sono finte, il DB è un tenant di
// prova. Dati inventati (IP 192.0.2.x, MAC 02:00:00:…).
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { runProxmoxDeviceScan, type ProxmoxDeviceScanResult, type ProxmoxScanDeps } from "@/lib/proxmox/run-proxmox-device-scan";
import { parseLiveInterfaces, parseSpeedLines } from "@/lib/proxmox/live-interfaces";
import type { ProxmoxHostInfo, ProxmoxVM } from "@/lib/proxmox/proxmox-client";
import { IP_LINK, SPEED_LINES } from "./fixtures/live-node";

const T = "TESTPROXMOXSCAN";
const LIVE = parseLiveInterfaces(IP_LINK, parseSpeedLines(SPEED_LINES));

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

beforeEach(() => {
  deleteTenantDatabase(T);
});

function host(nome: string, ip: string | null): ProxmoxHostInfo {
  return {
    hostname: nome, status: "online", uptime_seconds: 100, uptime_human: "1m 40s", cpu_model: null, cpu_mhz: null,
    cpu_sockets: null, cpu_cores: null, cpu_total_cores: 16, memory_total_gb: 64, memory_used_gb: 10,
    memory_free_gb: 54, memory_usage_percent: 15, proxmox_version: "8.2.4", kernel_version: null,
    rootfs_total_gb: null, rootfs_used_gb: null, storage: [], subscription: null, hardware_serial: null,
    hardware_model: null, hardware_manufacturer: null,
    network_interfaces: [
      { name: "eno1", type: "eth", state: "down", mac_address: null, ip_addresses: null, bridge: null, vlan_id: null, speed_mbps: null },
      { name: "bond0", type: "bond", state: "down", mac_address: null, ip_addresses: null, bridge: null, vlan_id: null, speed_mbps: null },
      { name: "vmbr0", type: "bridge", state: "down", mac_address: null, ip_addresses: ip, bridge: "bond0", vlan_id: null, speed_mbps: null },
    ],
  };
}

function vm(vmid: number, nodo: string): ProxmoxVM {
  return {
    node: nodo, vmid, name: `vm-${vmid}`, status: "running", type: "qemu", maxcpu: 2, cores: 2, sockets: 1,
    maxmem: 0, memory_mb: 0, maxdisk: 0, disk_gb: 0, ip_addresses: [], disks_details: [],
    networks_details: [{ id: "net0", mac: `02:00:00:00:30:${String(vmid).padStart(2, "0")}`, bridge: "vmbr0" }],
  };
}

const CLUSTER = { hosts: [host("pve-a", "192.0.2.11"), host("pve-b", "192.0.2.12")], vms: [vm(10, "pve-a"), vm(11, "pve-b")] };

/** Un hypervisor Proxmox con credenziali (SSH root), eventualmente con una scansione di prima. */
function hypervisor(prima?: { at: string; result: string }): number {
  return Number(
    getTenantDb(T)
      .prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, scan_target, username, encrypted_password, enabled,
                                      last_proxmox_scan_at, last_proxmox_scan_result)
         VALUES ('HV-1', '192.0.2.11', 'hypervisor', 'proxmox', 'ssh', 'proxmox', 'root', ?, 1, ?, ?)`,
      )
      .run(encrypt("segreto-di-prova"), prima?.at ?? null, prima?.result ?? null).lastInsertRowid,
  );
}

function riga(id: number): { at: string | null; result: string | null } {
  const r = getTenantDb(T).prepare("SELECT last_proxmox_scan_at AS at, last_proxmox_scan_result AS result FROM network_devices WHERE id = ?").get(id) as {
    at: string | null;
    result: string | null;
  };
  return r;
}

interface Chiamate { api: string[]; ssh: string[]; live: string[] }

function finti(over: Partial<ProxmoxScanDeps> = {}, now = "2026-10-14T03:00:00.000Z"): { deps: ProxmoxScanDeps; chiamate: Chiamate } {
  const chiamate: Chiamate = { api: [], ssh: [], live: [] };
  const deps: ProxmoxScanDeps = {
    readApi: async (c) => {
      chiamate.api.push(c.apiUrl);
      return structuredClone(CLUSTER);
    },
    readSsh: async (c) => {
      chiamate.ssh.push(c.host);
      return { hosts: [], vms: structuredClone(CLUSTER.vms) };
    },
    readLive: async (c) => {
      chiamate.live.push(c.host);
      return structuredClone(LIVE);
    },
    now: () => new Date(now),
    ...over,
  };
  return { deps, chiamate };
}

/** Tutto quello che finisce nel log durante `fn`. */
async function log<R>(fn: () => Promise<R>): Promise<{ righe: string[]; esito: R | Error }> {
  const righe: string[] = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  const prendi = (...a: unknown[]) => righe.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
  console.info = prendi; console.warn = prendi; console.error = prendi; console.log = prendi;
  try {
    return { righe, esito: await fn() };
  } catch (e) {
    return { righe, esito: e instanceof Error ? e : new Error(String(e)) };
  } finally {
    Object.assign(console, orig);
  }
}

function json(r: string | null): ProxmoxDeviceScanResult {
  assert.ok(r);
  return JSON.parse(r) as ProxmoxDeviceScanResult;
}

test("scansione con le schede vive: le schede dell'host del bersaglio prendono MAC, stato, velocità e bond, con la data", async () => {
  const id = hypervisor();
  const { deps, chiamate } = finti();
  const r = await withTenant(T, () => runProxmoxDeviceScan(id, deps));
  assert.deepEqual(chiamate.live, ["192.0.2.11"], "una lettura delle schede vive per bersaglio");
  const salvato = json(riga(id).result);
  assert.equal(riga(id).at, "2026-10-14T03:00:00.000Z");
  assert.equal(salvato.scanned_at, "2026-10-14T03:00:00.000Z");
  assert.deepEqual(salvato, JSON.parse(JSON.stringify(r)));
  const a = salvato.hosts.find((h) => h.hostname === "pve-a");
  assert.equal(a?.live_read_at, "2026-10-14T03:00:00.000Z");
  const eno1 = a?.network_interfaces.find((i) => i.name === "eno1");
  assert.deepEqual(
    [eno1?.mac_address, eno1?.state, eno1?.speed_mbps, eno1?.master],
    ["02:00:00:00:10:01", "up", "1000", "bond0"],
  );
  assert.equal(a?.network_interfaces.find((i) => i.name === "eno2")?.mac_address, "02:00:00:00:10:02");
  // L'altro nodo del cluster non è stato letto: niente data, niente schede vive.
  const b = salvato.hosts.find((h) => h.hostname === "pve-b");
  assert.equal(b?.live_read_at, undefined);
  assert.equal(b?.network_interfaces.find((i) => i.name === "eno1")?.mac_address, null);
  assert.equal(salvato.vms.length, 2);
  assert.equal(salvato.avvisi, undefined);
});

test("Review Focus 4: scansione fallita (API, SSH e schede vive irraggiungibili) → il JSON e la data di prima restano", async () => {
  const prima = { at: "2026-10-13T03:00:00.000Z", result: JSON.stringify({ hosts: CLUSTER.hosts, vms: CLUSTER.vms, scanned_at: "2026-10-13T03:00:00.000Z" }) };
  const id = hypervisor(prima);
  const giu = async () => {
    throw new Error("connect ETIMEDOUT 192.0.2.11:22");
  };
  const { deps } = finti({ readApi: giu, readSsh: giu, readLive: giu });
  const { esito, righe } = await log(() => withTenant(T, () => runProxmoxDeviceScan(id, deps)));
  assert.ok(esito instanceof Error, "la scansione deve fallire");
  assert.match(esito.message, /ETIMEDOUT/, "l'errore arriva a chi ha chiesto la lettura (resoconto)");
  assert.deepEqual(riga(id), prima);
  assert.deepEqual(righe, [], "niente nel log: l'errore lo riporta chi chiama");
});

test("Review Focus 4: VM a zero con errori quando prima c'erano → non si scrive, mai «0 VM»", async () => {
  const prima = { at: "2026-10-13T03:00:00.000Z", result: JSON.stringify({ hosts: CLUSTER.hosts, vms: CLUSTER.vms, scanned_at: "2026-10-13T03:00:00.000Z" }) };
  const id = hypervisor(prima);
  const { deps } = finti({
    readApi: async () => ({ hosts: structuredClone(CLUSTER.hosts), vms: [] }), // le VM dell'API non lette (errore muto)
    readSsh: async () => {
      throw new Error("pvesh non disponibile");
    },
  });
  await assert.rejects(withTenant(T, () => runProxmoxDeviceScan(id, deps)), /nessuna VM/i);
  assert.deepEqual(riga(id), prima);
});

test("zero VM senza errori (tutte spente) si scrive: è una lettura vera", async () => {
  const prima = { at: "2026-10-13T03:00:00.000Z", result: JSON.stringify({ hosts: CLUSTER.hosts, vms: CLUSTER.vms, scanned_at: "2026-10-13T03:00:00.000Z" }) };
  const id = hypervisor(prima);
  const { deps } = finti({
    readApi: async () => ({ hosts: structuredClone(CLUSTER.hosts), vms: [] }),
    readSsh: async () => ({ hosts: [], vms: [] }),
  });
  await withTenant(T, () => runProxmoxDeviceScan(id, deps));
  assert.equal(json(riga(id).result).vms.length, 0);
  assert.equal(riga(id).at, "2026-10-14T03:00:00.000Z");
});

test("Review Focus 4: schede vive non lette → restano quelle di prima con la loro data; il resto si aggiorna", async () => {
  const id = hypervisor();
  await withTenant(T, () => runProxmoxDeviceScan(id, finti({}, "2026-10-13T03:00:00.000Z").deps));
  const { deps } = finti({
    readLive: async () => {
      throw new Error("Timed out while waiting for handshake");
    },
  });
  const { righe } = await log(() => withTenant(T, () => runProxmoxDeviceScan(id, deps)));
  const salvato = json(riga(id).result);
  assert.equal(salvato.scanned_at, "2026-10-14T03:00:00.000Z");
  const a = salvato.hosts.find((h) => h.hostname === "pve-a");
  assert.equal(a?.live_read_at, "2026-10-13T03:00:00.000Z", "la data delle schede resta quella dell'ultima lettura");
  const eno1 = a?.network_interfaces.find((i) => i.name === "eno1");
  assert.deepEqual([eno1?.mac_address, eno1?.state, eno1?.speed_mbps, eno1?.master], ["02:00:00:00:10:01", "up", "1000", "bond0"]);
  assert.equal(a?.network_interfaces.find((i) => i.name === "eno2")?.mac_address, "02:00:00:00:10:02");
  assert.ok(salvato.avvisi?.some((x) => /schede vive/i.test(x) && /handshake/.test(x)), "l'errore va nel resoconto");
  assert.deepEqual(righe, []);
});

test("host del bersaglio non riconoscibile (cluster senza configurazione delle schede): nessuna scheda viva attribuita a caso", async () => {
  const id = hypervisor();
  const { deps } = finti({
    readApi: async () => {
      throw new Error("401 authentication failure");
    },
    readSsh: async () => ({ hosts: [{ ...host("pve-a", null), network_interfaces: [] }, { ...host("pve-b", null), network_interfaces: [] }], vms: structuredClone(CLUSTER.vms) }),
  });
  await withTenant(T, () => runProxmoxDeviceScan(id, deps));
  const salvato = json(riga(id).result);
  assert.ok(salvato.hosts.every((h) => h.live_read_at === undefined && h.network_interfaces.length === 0));
  assert.ok(salvato.avvisi?.some((x) => /schede vive/i.test(x)));
});

test("scansione di prima rovinata (JSON non valido): si legge e si scrive lo stesso", async () => {
  const id = hypervisor({ at: "2026-10-13T03:00:00.000Z", result: "{non json" });
  await withTenant(T, () => runProxmoxDeviceScan(id, finti().deps));
  assert.equal(json(riga(id).result).hosts.length, 2);
});
