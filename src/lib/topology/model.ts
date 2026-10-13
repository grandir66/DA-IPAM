/**
 * Il modello della mappa (spec §3, fase 1 «i dati giusti»): nodi fusi,
 * collegamenti con fonte ed età, sedi con testa, proposte e «da sistemare».
 * Si calcola a ogni richiesta, non si salva. Logica pura.
 */
import { attachMacs } from "@/lib/topology/attach";
import { buildLinks } from "@/lib/topology/links";
import {
  LINK_SOURCE_RANK,
  type LinkSource,
  type ModelCounts,
  type TopologyModel,
  type TopologyModelInput,
} from "@/lib/topology/model-types";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { assignSites } from "@/lib/topology/sites";

export const PROMOTE_CLASSES = ["switch", "router", "access_point", "firewall"] as const;
const SUSPICIOUS_TYPES = ["switch", "access_point"];

export function buildTopologyModel(input: TopologyModelInput): TopologyModel {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  const { links: baseLinks, unmatched } = buildLinks(input, idx);
  const { portClients, clientCount, attachLinks } = attachMacs(input, idx, baseLinks);
  const links = [...baseLinks, ...attachLinks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sites = assignSites(input, idx, links);

  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.a, (degree.get(l.a) ?? 0) + 1);
    degree.set(l.b, (degree.get(l.b) ?? 0) + 1);
  }
  const nodes = [...idx.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const portCount = new Map(input.devices.map((d) => [d.id, d.port_count]));
  const devices = nodes.filter((n) => n.kind === "device");

  const promote = nodes
    .filter((n) => n.kind === "host" && (PROMOTE_CLASSES as readonly string[]).includes(n.type) && (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      hostId: n.refId, name: n.name, ip: n.mgmtIp ?? "", classification: n.type, links: degree.get(n.id) ?? 0,
    }))
    .sort((a, b) => b.links - a.links || a.name.localeCompare(b.name, "it") || a.hostId - b.hostId);
  const isolated = devices.filter((n) => !n.hidden && (degree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const suspicious = isolated.filter((id) => {
    const n = idx.nodes.get(id);
    return n !== undefined && SUSPICIOUS_TYPES.includes(n.type) && (portCount.get(n.refId) ?? 0) === 0;
  });
  const withoutSite = devices.filter((n) => !n.hidden && n.siteId === null).map((n) => n.id);

  const linksBySource = Object.fromEntries(
    (Object.keys(LINK_SOURCE_RANK) as LinkSource[]).map((s) => [s, links.filter((l) => l.source === s).length]),
  ) as Record<LinkSource, number>;
  const isDev = (id: string) => id.startsWith("dev:");
  const counts: ModelCounts = {
    nodes: nodes.length,
    devices: devices.length,
    links: links.length,
    linksBySource,
    deviceLinks: links.filter((l) => isDev(l.a) && isDev(l.b)).length,
    attachedLinks: links.filter((l) => isDev(l.a) !== isDev(l.b)).length,
    staleLinks: links.filter((l) => l.stale).length,
    unmatchedNeighbors: unmatched.length,
    isolatedDevices: isolated.length,
    fusedHosts: idx.fusedHosts,
    mergedHosts: idx.mergedHosts,
    devicesWithoutSite: withoutSite.length,
    sitesWithHead: sites.filter((s) => s.headNodeId !== null).length,
    promoteProposals: promote.length,
    suspiciousTypes: suspicious.length,
  };
  const canonical = Object.fromEntries([...idx.alias.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return { nodes, links, sites, promote, unmatched, isolated, suspicious, withoutSite, counts, portClients, clientCount, canonical };
}
