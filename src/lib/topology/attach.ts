/**
 * Dove è attaccato un MAC (spec §10.5): sulla porta di bordo — non uplink, non
 * porta di un collegamento fra apparati — di uno switch o AP; un router solo se
 * nessuno switch lo vede (e allora non conta client: il suo bridge vede tutta la
 * rete). A parità, la porta con meno MAC (una porta di passaggio ne ha tanti),
 * poi nodo e porta. Il MAC di un nodo noto che non è un client (apparato,
 * server) diventa un collegamento «mac_table»; gli altri sono client contati
 * sulla porta, con nome e IP se l'host è noto. Logica pura.
 */
import type { MapLink, PortClients, TopologyModelInput } from "@/lib/topology/model-types";
import { type NodeIndex, resolveNode } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";

const CLIENT_COUNTING = ["switch", "access_point"];
const DAY = 86_400_000;

interface Cand { node: string; port: string; ts: string; counting: boolean }

export function attachMacs(
  input: TopologyModelInput,
  idx: NodeIndex,
  links: MapLink[],
): { portClients: PortClients[]; clientCount: Record<string, number>; attachLinks: MapLink[] } {
  const portKey = (node: string, port: string) => `${node}|${normalizePortNameForMatch(port)}`;
  const linkPorts = new Set<string>();
  for (const l of links) {
    if (l.aPort) linkPorts.add(portKey(l.a, l.aPort));
    if (l.bPort) linkPorts.add(portKey(l.b, l.bPort));
  }
  for (const u of input.uplinkPorts) linkPorts.add(portKey(`dev:${u.device_id}`, u.port_name));
  const linked = new Set(links.map((l) => [l.a, l.b].sort().join("|")));

  const perPort = new Map<string, number>();
  const cand = new Map<string, Cand[]>();
  for (const r of input.macPorts) {
    const node = `dev:${r.device_id}`;
    const n = idx.nodes.get(node);
    const mac = normalizeMacForStorage(r.mac);
    if (!n || !mac || linkPorts.has(portKey(node, r.port_name))) continue;
    const k = portKey(node, r.port_name);
    perPort.set(k, (perPort.get(k) ?? 0) + 1);
    cand.set(mac, [...(cand.get(mac) ?? []), { node, port: r.port_name, ts: r.timestamp, counting: CLIENT_COUNTING.includes(n.type) }]);
  }

  const byPort = new Map<string, PortClients>();
  const clientCount: Record<string, number> = {};
  const attachLinks: MapLink[] = [];
  for (const mac of [...cand.keys()].sort()) {
    const all = cand.get(mac)!;
    const pool = all.some((c) => c.counting) ? all.filter((c) => c.counting) : all;
    pool.sort((x, y) =>
      perPort.get(portKey(x.node, x.port))! - perPort.get(portKey(y.node, y.port))!
      || (x.node < y.node ? -1 : x.node > y.node ? 1 : 0)
      || x.port.localeCompare(y.port));
    const best = pool[0];
    const seenMs = parseDbDate(best.ts).getTime();
    const daysUnseen = Math.max(0, Math.floor((input.nowMs - seenMs) / DAY));
    const stale = input.nowMs - seenMs > input.staleDays * DAY;
    const otherId = resolveNode(idx, { mac });
    const other = otherId ? idx.nodes.get(otherId) : undefined;
    if (other && other.id !== best.node && nodeClass(other) !== "client") {
      const key = [best.node, other.id].sort().join("|");
      if (!linked.has(key)) {
        linked.add(key);
        attachLinks.push({
          id: `mac:${key}`, a: best.node, aPort: best.port, b: other.id, bPort: "", source: "mac_table", sources: ["mac_table"],
          uplinkFrom: other.id, lastSeen: best.ts, daysUnseen, stale,
        });
      }
      continue;
    }
    if (!best.counting) continue;
    const pk = `${best.node}|${best.port}`;
    const pc = byPort.get(pk) ?? { nodeId: best.node, port: best.port, clients: [] };
    pc.clients.push({ mac, nodeId: other?.id ?? null, name: other?.name ?? null, ip: other?.mgmtIp ?? null, lastSeen: best.ts, stale });
    byPort.set(pk, pc);
    clientCount[best.node] = (clientCount[best.node] ?? 0) + 1;
  }
  const portClients = [...byPort.values()].sort((a, b) =>
    (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) || a.port.localeCompare(b.port, "it", { numeric: true }));
  attachLinks.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { portClients, clientCount, attachLinks };
}
