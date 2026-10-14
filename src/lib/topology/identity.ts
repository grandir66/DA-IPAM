/**
 * Un oggetto fisico, un nodo (spec §10.4). Logica pura. I MAC virtuali (VRRP,
 * HSRP) passano da un router all'altro: non identificano nessuno. Il seriale
 * degli host non si usa (spec §10.1: 40 seriali su 81 condivisi sulla copia
 * di un cliente).
 */
import type { MapNode, ModelHostRow, ModelNeighborRow } from "@/lib/topology/model-types";

const VIRTUALI = [/^00:00:5e:00:0[12]:/i, /^00:00:0c:07:ac:/i];

export function isVirtualMac(mac: string | null | undefined): boolean {
  return !!mac && VIRTUALI.some((r) => r.test(mac.replace(/-/g, ":")));
}

/**
 * Nomi di fabbrica: li portano tanti apparati diversi (l'identità predefinita di
 * ogni MikroTik è «MikroTik»), quindi non fondono niente (revisione finale I3).
 */
const NOMI_DI_FABBRICA = new Set([
  "mikrotik", "routeros", "localhost", "ubnt", "unifi", "ubiquiti", "router", "switch", "ap", "gateway", "default",
  "unknown", "ubuntu", "debian", "raspberrypi", "openwrt",
]);

/**
 * Una chiave di nome (già normalizzata) vale come identità per fondere? No se è
 * un nome di fabbrica, se è più corta di 4 caratteri, o se è solo cifre o
 * esadecimale: è il pezzo di un MAC a punti («0050.56ab.0001» → «0050»).
 */
export function identifiesByName(key: string): boolean {
  const k = key.toLowerCase();
  return k.length >= 4 && !/^[0-9a-f]+$/.test(k) && !NOMI_DI_FABBRICA.has(k);
}

/** I primi tre byte di un MAC vero (già normalizzato), o null se manca o è virtuale. */
export function realOui(mac: string | null | undefined): string | null {
  if (!mac || isVirtualMac(mac)) return null;
  const parts = mac.toLowerCase().split(/[:-]/);
  return parts.length === 6 ? parts.slice(0, 3).join(":") : null;
}

export const IDENTITY_TYPES: readonly string[] = [
  "router", "firewall", "switch", "access_point", "server", "server_linux", "server_windows", "hypervisor", "nas", "storage",
];

export type NodeClass = "infra" | "ap" | "hyper" | "att" | "client";

/**
 * Ruolo nella mappa (spec §10.3, §11.5): i client non sono nodi della mappa automatica.
 * Un hypervisor è un apparato `hypervisor`, oppure un server/NAS con fornitore Proxmox o VMware
 * o con la scansione Proxmox (`proxmoxScan`, revisione finale M-2).
 */
export function nodeClass(n: Pick<MapNode, "type"> & { vendor?: string | null; proxmoxScan?: boolean }): NodeClass {
  if (n.type === "router" || n.type === "firewall" || n.type === "switch") return "infra";
  if (n.type === "access_point") return "ap";
  if (n.type === "hypervisor") return "hyper";
  if (["server", "server_linux", "server_windows", "hypervisor", "nas", "storage"].includes(n.type)) {
    return n.proxmoxScan === true || /^(proxmox|vmware)/i.test(n.vendor?.trim() ?? "") ? "hyper" : "att";
  }
  return "client";
}

/** Nomi annunciati (LLDP/CDP/MNDP) per l'IP di un host, se quell'IP è di un host solo. */
export function announcedNames(hosts: ModelHostRow[], neighbors: ModelNeighborRow[]): Map<number, string[]> {
  const byIp = new Map<string, number | null>();
  for (const h of hosts) if (h.ip) byIp.set(h.ip, byIp.has(h.ip) ? null : h.id);
  const out = new Map<number, string[]>();
  for (const n of neighbors) {
    const id = n.remote_ip ? byIp.get(n.remote_ip) : undefined;
    const name = n.remote_device_name?.trim();
    if (typeof id !== "number" || !name) continue;
    const list = out.get(id) ?? [];
    if (!list.includes(name)) out.set(id, [...list, name].sort());
  }
  return out;
}
