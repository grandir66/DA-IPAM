import type {
  DeviceRow,
  HostRow,
  NeighborRow,
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  TopologyStatus,
} from "@/lib/topology/types";
import { normalizeName, resolveRemote } from "@/lib/topology/match";

const DEFAULT_HOST_CLASSES = ["hypervisor", "vm", "proxmox"];

export function buildTopologyGraph(input: {
  devices: DeviceRow[];
  hosts: HostRow[];
  neighbors: NeighborRow[];
  statusByNode: Map<string, TopologyStatus>;
  hostClassifications?: string[];
}): TopologyGraph {
  const classes = (input.hostClassifications ?? DEFAULT_HOST_CLASSES).map((c) => c.toLowerCase());
  const nodes = new Map<string, TopologyNode>();
  const byName = new Map<string, string>();
  const byIp = new Map<string, string>();
  const st = (id: string): TopologyStatus => input.statusByNode.get(id) ?? "unknown";

  for (const d of input.devices) {
    const id = `dev:${d.id}`;
    nodes.set(id, {
      id, kind: "device", refId: d.id, name: d.name, type: d.device_type, model: d.model, mgmtIp: d.host, status: st(id),
    });
    if (d.name) byName.set(normalizeName(d.name), id);
    if (d.host) byIp.set(d.host, id);
  }
  for (const h of input.hosts) {
    if (!classes.includes((h.classification || "").toLowerCase())) continue;
    const id = `host:${h.id}`;
    const name = h.custom_name || h.hostname || h.ip;
    nodes.set(id, {
      id, kind: "host", refId: h.id, name, type: h.classification, model: h.model, mgmtIp: h.ip, status: st(id),
    });
    if (h.hostname) byName.set(normalizeName(h.hostname), id);
    if (h.ip) byIp.set(h.ip, id);
  }

  const index = { byName, byIp };
  const edges = new Map<string, TopologyEdge>();
  for (const n of input.neighbors) {
    const source = `dev:${n.device_id}`;
    if (!nodes.has(source)) continue;
    let target = resolveRemote({ name: n.remote_device_name, ip: n.remote_ip }, index);
    if (!target) {
      if (!n.remote_device_name) continue;
      target = `ext:${normalizeName(n.remote_device_name)}`;
      if (!nodes.has(target)) {
        nodes.set(target, {
          id: target, kind: "external", refId: null, name: n.remote_device_name,
          type: "external", model: null, mgmtIp: n.remote_ip, status: "unknown",
        });
      }
    }
    if (source === target) continue;
    const key = [source, target].sort().join("|");
    if (edges.has(key)) continue;
    edges.set(key, {
      id: `edge:${key}`, source, target,
      sourcePort: n.local_port || undefined, targetPort: n.remote_port || undefined, protocol: n.protocol,
    });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
