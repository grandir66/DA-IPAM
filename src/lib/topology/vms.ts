/**
 * Hypervisor e VM nel modello (spec §11.5). Logica pura: legge le VM dalla
 * scansione Proxmox già salvata (`parseProxmoxScan`, tollerante a ogni forma
 * rovinata), le mette nel loro host (`placeVms`) e dice quali sono già un nodo
 * censito e quali MAC non vanno contati come client di una porta.
 */
import { parseDbDate } from "@/lib/db-date";
import { nodeClass, identifiesByName } from "@/lib/topology/identity";
import type { MapNode, MapVm, ModelScanHostRow, ModelVmRow, TopologyModelInput } from "@/lib/topology/model-types";
import { nameKey, nodeFor, type NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage } from "@/lib/utils";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Gli IPv4 di un campo che può essere una stringa («192.0.2.1/24, 192.0.2.2») o un elenco. */
function ipsOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  const out = raw
    .map((x) => text(x).replace(/\/\d+$/, ""))
    .filter((x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x));
  return [...new Set(out)];
}

function macsOf(values: unknown[]): string[] {
  const out = values.map((x) => normalizeMacForStorage(typeof x === "string" ? x : null)).filter((x): x is string => x !== null);
  return [...new Set(out)];
}

/**
 * VM e host di cluster dal JSON di `network_devices.last_proxmox_scan_result`.
 * Un JSON rovinato o di forma inattesa dà zero VM e zero host, mai un errore:
 * la pagina della mappa non deve cadere per una scansione sporca.
 */
export function parseProxmoxScan(scannedDeviceId: number, raw: string | null): { vms: ModelVmRow[]; hosts: ModelScanHostRow[] } {
  const vuoto = { vms: [], hosts: [] };
  if (!raw) return vuoto;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return vuoto; // scansione rovinata: nessuna VM per questo apparato
  }
  if (!isRec(json)) return vuoto;
  const scannedAt = text(json.scanned_at) || null;
  const vms: ModelVmRow[] = [];
  for (const v of Array.isArray(json.vms) ? json.vms : []) {
    if (!isRec(v)) continue;
    const vmid = Number(v.vmid);
    if (!Number.isInteger(vmid)) continue;
    vms.push({
      scannedDeviceId, vmid, name: text(v.name) || `vm-${vmid}`, node: text(v.node), status: text(v.status) || "unknown",
      type: text(v.type) || "qemu",
      macs: macsOf((Array.isArray(v.networks_details) ? v.networks_details : []).map((n) => (isRec(n) ? n.mac : null))),
      ips: ipsOf(v.ip_addresses), scannedAt,
    });
  }
  const hosts: ModelScanHostRow[] = [];
  for (const h of Array.isArray(json.hosts) ? json.hosts : []) {
    if (!isRec(h) || !text(h.hostname)) continue;
    const ifaces = (Array.isArray(h.network_interfaces) ? h.network_interfaces : []).filter(isRec);
    hosts.push({
      scannedDeviceId, hostname: text(h.hostname),
      ips: [...new Set(ifaces.flatMap((i) => ipsOf(i.ip_addresses)))],
      macs: macsOf(ifaces.map((i) => i.mac_address)),
    });
  }
  return { vms, hosts };
}

/** Il nodo con quell'id; un host semplice nasce al bisogno (come per i vicini LLDP). */
function nodeAt(idx: NodeIndex, id: string): MapNode | undefined {
  const k = nodeFor(idx, id);
  return k ? idx.nodes.get(k) : undefined;
}

const hostKey = (scannedDeviceId: number, hostname: string): string => `${scannedDeviceId}|${hostname.trim().toLowerCase()}`;

/** Il nodo hypervisor di ogni host di cluster: per IP, poi per nome (alias compresi); null se non si abbina. */
export function resolveScanHosts(
  hosts: readonly ModelScanHostRow[], idx: NodeIndex,
): Array<{ row: ModelScanHostRow; nodeId: string | null }> {
  const hyper = (id: unknown): string | null => {
    const n = typeof id === "string" ? nodeAt(idx, id) : undefined;
    return n && nodeClass(n) === "hyper" ? n.id : null;
  };
  const byAlias = new Map<string, string | null>();
  for (const n of idx.nodes.values()) {
    for (const a of n.aliases) {
      const k = nameKey(a);
      if (k) byAlias.set(k, byAlias.has(k) && byAlias.get(k) !== n.id ? null : n.id);
    }
  }
  return hosts.map((row) => {
    let nodeId: string | null = null;
    for (const ip of row.ips) {
      nodeId = hyper(idx.byIp.get(ip));
      if (nodeId) break;
    }
    if (!nodeId) {
      const k = nameKey(row.hostname);
      if (k) nodeId = hyper(idx.byName.get(k)) ?? hyper(byAlias.get(k));
    }
    return { row, nodeId };
  });
}

export interface PlacedVms {
  vms: MapVm[];
  /** Nodi esistenti che sono una VM: non sono «da sistemare» e non hanno una sede da assegnare. */
  vmNodeIds: Set<string>;
  /** Tutti i MAC delle VM: non sono client di nessuna porta e non creano collegamenti. */
  vmMacs: Set<string>;
}

const ts = (s: string | null): number => {
  const t = s ? parseDbDate(s).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export function placeVms(input: Pick<TopologyModelInput, "vms" | "scanHosts">, idx: NodeIndex): PlacedVms {
  const resolved = new Map(resolveScanHosts(input.scanHosts, idx).map((r) => [hostKey(r.row.scannedDeviceId, r.row.hostname), r.nodeId]));
  const scanned = (id: number): string | null => (idx.nodes.has(`dev:${id}`) ? `dev:${id}` : null);
  const vmMacs = new Set<string>();
  const vmNodeIds = new Set<string>();

  const placed = input.vms.map((vm) => {
    const v = { ...vm, macs: macsOf(vm.macs) }; // sempre nella forma del DB, qualunque cosa arrivi
    const hypervisorNodeId = resolved.get(hostKey(v.scannedDeviceId, v.node)) ?? scanned(v.scannedDeviceId);
    for (const m of v.macs) vmMacs.add(m);
    let nodeId: string | null = null;
    for (const m of v.macs) {
      const id = idx.byMac.get(m);
      const n = typeof id === "string" ? nodeAt(idx, id) : undefined;
      if (n && n.id !== hypervisorNodeId) { nodeId = n.id; break; }
    }
    if (nodeId === null && v.macs.length === 0) {
      const k = nameKey(v.name);
      const id = k && identifiesByName(k) ? idx.byName.get(k) : undefined;
      const n = typeof id === "string" ? nodeAt(idx, id) : undefined;
      if (n && n.id !== hypervisorNodeId && ["att", "client"].includes(nodeClass(n))) nodeId = n.id;
    }
    return { v, hypervisorNodeId, nodeId };
  });

  // La stessa VM letta da due apparati scansionati (un cluster con due schede): una sola, la lettura più recente.
  const best = new Map<string, (typeof placed)[number]>();
  const lone: typeof placed = [];
  for (const p of placed) {
    if (p.hypervisorNodeId === null) { lone.push(p); continue; }
    const key = `${p.hypervisorNodeId}|${p.v.vmid}|${p.v.type}`;
    const cur = best.get(key);
    if (!cur || ts(p.v.scannedAt) > ts(cur.v.scannedAt) || (ts(p.v.scannedAt) === ts(cur.v.scannedAt) && p.v.scannedDeviceId < cur.v.scannedDeviceId)) best.set(key, p);
  }
  const vms: MapVm[] = [...best.values(), ...lone]
    .sort((x, y) => x.v.scannedDeviceId - y.v.scannedDeviceId || x.v.vmid - y.v.vmid)
    .map(({ v, hypervisorNodeId, nodeId }) => {
      if (nodeId) vmNodeIds.add(nodeId);
      return { id: `vm:${v.scannedDeviceId}:${v.vmid}`, name: v.name, status: v.status, ips: v.ips, hypervisorNodeId, nodeId, scannedAt: v.scannedAt };
    });
  return { vms, vmNodeIds, vmMacs };
}
