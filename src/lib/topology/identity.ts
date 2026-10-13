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

export const IDENTITY_TYPES: readonly string[] = [
  "router", "firewall", "switch", "access_point", "server", "server_linux", "server_windows", "hypervisor", "nas", "storage",
];

export type NodeClass = "infra" | "ap" | "att" | "client";

/** Ruolo nella mappa (spec §10.3): i client non sono nodi della mappa automatica. */
export function nodeClass(n: Pick<MapNode, "type">): NodeClass {
  if (n.type === "router" || n.type === "firewall" || n.type === "switch") return "infra";
  if (n.type === "access_point") return "ap";
  if (["server", "server_linux", "server_windows", "hypervisor", "nas", "storage"].includes(n.type)) return "att";
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
