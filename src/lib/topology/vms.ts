/**
 * Hypervisor e VM nel modello (spec §11.5). Logica pura: legge le VM dalla
 * scansione Proxmox già salvata (`parseProxmoxScan`, tollerante a ogni forma
 * rovinata), le mette nel loro host (`placeVms`) e dice quali sono già un nodo
 * censito (per MAC; senza MAC per nome; infine per l'IP che la VM dichiara) e quali MAC non vanno contati come client di una porta.
 */
import { parseDbDate } from "@/lib/db-date";
import { nodeClass, identifiesByName } from "@/lib/topology/identity";
import type { MapNode, MapVm, ModelScanHostRow, ModelVmRow, TopologyModelInput } from "@/lib/topology/model-types";
import { nameKey, nodeFor, type NodeIndex } from "@/lib/topology/node-index";
import { isRunning } from "@/lib/topology/vm-nodes";
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

/** Sei ottetti esadecimali separati da «:» o «-»: la sola forma che la scansione Proxmox scrive per un MAC. */
const MAC_FORM = /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;

/**
 * Un MAC valido nella forma del DB, o null; I MAC validi di un elenco (macsOf). Lo usa anche
 * `scripts/misura-fase2b.ts` (revisione finale M-6). Prima si controlla la forma e poi si
 * normalizza: le scansioni salvate prima della fase 2b hanno l'IP nel campo MAC
 * (`getNodeNetwork` copiava `address`), e `normalizeMacForStorage` da solo, che toglie
 * tutto ciò che non è esadecimale, trasformerebbe «192.168.100.123» in un MAC.
 */
export function macOf(x: unknown): string | null {
  return typeof x === "string" && MAC_FORM.test(x.trim()) ? normalizeMacForStorage(x) : null;
}

function macsOf(values: unknown[]): string[] {
  return [...new Set(values.map(macOf).filter((x): x is string => x !== null))];
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
      macs: macsOf(ifaces.map((i) => i.mac_address)), scannedAt,
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

/**
 * Il nodo hypervisor di ogni host di cluster: per IP, poi per nome (alias compresi); null se non si abbina.
 * `byIp` dice se l'abbinamento viene da un IP del nodo nelle schede dell'host (serve al nome dal Proxmox, §12.5).
 */
export function resolveScanHosts(
  hosts: readonly ModelScanHostRow[], idx: NodeIndex,
): Array<{ row: ModelScanHostRow; nodeId: string | null; byIp: boolean }> {
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
    const byIp = nodeId !== null;
    if (!nodeId) {
      const k = nameKey(row.hostname);
      if (k) nodeId = hyper(idx.byName.get(k)) ?? hyper(byAlias.get(k));
    }
    return { row, nodeId, byIp };
  });
}

export interface PlacedVms {
  vms: MapVm[];
  /** Nodi esistenti che sono una VM: non sono «da sistemare» e non hanno una sede da assegnare. */
  vmNodeIds: Set<string>;
  /** Tutti i MAC delle VM: non sono client di nessuna porta e non creano collegamenti. */
  vmMacs: Set<string>;
  /**
   * MAC delle VM accese → la VM e il suo hypervisor (spec §12.5, fonte `vm_mac`), secondo la lettura più recente
   * che riporta quel MAC. `hypervisor` null = non si sa di chi è: hypervisor non trovato, o lo stesso MAC in VM
   * accese di due hypervisor nella stessa lettura. Le VM spente nell'ultima lettura non ci sono.
   */
  runningVmMacs: Map<string, { vm: string; hypervisor: string | null }>;
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

  const readings = input.vms.map((vm) => {
    const v = { ...vm, macs: macsOf(vm.macs) }; // sempre nella forma del DB, qualunque cosa arrivi
    for (const m of v.macs) vmMacs.add(m);
    return { v, hypervisorNodeId: resolved.get(hostKey(v.scannedDeviceId, v.node)) ?? scanned(v.scannedDeviceId) };
  });

  // La stessa VM letta da due apparati scansionati (un cluster con due schede): una sola, coi dati della lettura più
  // recente (a pari data l'apparato con id più basso). Se la lettura più recente non riporta IP o MAC, valgono quelli
  // della lettura precedente più recente che li ha: l'agent non sempre risponde, e senza quegli indirizzi una VM già
  // riconosciuta tornerebbe «da sistemare». L'id invece viene dall'apparato con l'id più basso del gruppo (revisione
  // finale M-1): se seguisse la lettura più recente, una notte in cui l'ultima lettura fallisce cambierebbe gli id, e
  // le VM salvate in una mappa passo passo diventerebbero «sparite».
  const groups = new Map<string, Array<(typeof readings)[number]>>();
  const lone: typeof readings = [];
  for (const r of readings) {
    if (r.hypervisorNodeId === null) { lone.push(r); continue; }
    const key = `${r.hypervisorNodeId}|${r.v.vmid}|${r.v.type}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const merged = [...groups.values()].map((g) => {
    g.sort((x, y) => ts(y.v.scannedAt) - ts(x.v.scannedAt) || x.v.scannedDeviceId - y.v.scannedDeviceId);
    const [newest, ...older] = g;
    const ips = newest.v.ips.length > 0 ? newest.v.ips : (older.find((o) => o.v.ips.length > 0)?.v.ips ?? []);
    const macs = newest.v.macs.length > 0 ? newest.v.macs : (older.find((o) => o.v.macs.length > 0)?.v.macs ?? []);
    const idDeviceId = Math.min(...g.map((r) => r.v.scannedDeviceId));
    return { v: { ...newest.v, ips, macs }, hypervisorNodeId: newest.hypervisorNodeId, idDeviceId };
  });

  const placed = [...merged, ...lone.map((r) => ({ ...r, idDeviceId: r.v.scannedDeviceId }))].map(({ v, hypervisorNodeId, idDeviceId }) => {
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
    if (nodeId === null) {
      // L'IP letto dalla VM stessa: una macchina Windows censita come «switch» non ha un MAC noto ma ha il suo indirizzo.
      for (const ip of v.ips) {
        const id = idx.byIp.get(ip);
        const n = typeof id === "string" ? nodeAt(idx, id) : undefined;
        if (n && n.id !== hypervisorNodeId && nodeClass(n) !== "hyper") { nodeId = n.id; break; }
      }
    }
    return { v, hypervisorNodeId, nodeId, idDeviceId };
  });

  const perMac = new Map<string, Array<{ vm: string; hypervisor: string | null; running: boolean; t: number }>>();
  const vms: MapVm[] = placed
    .sort((x, y) => x.idDeviceId - y.idDeviceId || x.v.vmid - y.v.vmid)
    .map(({ v, hypervisorNodeId, nodeId, idDeviceId }) => {
      if (nodeId) vmNodeIds.add(nodeId);
      const id = `vm:${idDeviceId}:${v.vmid}`;
      for (const m of v.macs) {
        perMac.set(m, [...(perMac.get(m) ?? []), { vm: id, hypervisor: hypervisorNodeId, running: isRunning(v.status), t: ts(v.scannedAt) }]);
      }
      return { id, name: v.name, status: v.status, ips: v.ips, hypervisorNodeId, nodeId, scannedAt: v.scannedAt };
    });
  // Di chi è oggi il MAC di una VM accesa (spec §12.5): conta solo la lettura più recente che lo riporta. Una
  // scansione vecchia di un altro cluster (la VM girava altrove, a maggio) o una replica spenta con lo stesso MAC
  // non lo rendono «di due hypervisor»; due VM accese nella stessa lettura più recente su due hypervisor sì.
  const runningVmMacs = new Map<string, { vm: string; hypervisor: string | null }>();
  for (const [m, list] of perMac) {
    const latest = Math.max(...list.map((r) => r.t));
    const run = list.filter((r) => r.t === latest && r.running);
    if (run.length === 0) continue; // spenta nell'ultima lettura
    const hyps = new Set(run.map((r) => r.hypervisor));
    runningVmMacs.set(m, { vm: run[0].vm, hypervisor: hyps.size === 1 ? run[0].hypervisor : null });
  }
  return { vms, vmNodeIds, vmMacs, runningVmMacs };
}
