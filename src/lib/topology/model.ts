/**
 * Il modello della mappa (spec §3, fase 1 «i dati giusti»): nodi fusi,
 * collegamenti con fonte ed età, sedi con testa, proposte e «da sistemare».
 * Si calcola a ogni richiesta, non si salva. Logica pura.
 */
import { attachMacs } from "@/lib/topology/attach";
import { buildLinks } from "@/lib/topology/links";
import { enrichLinks } from "@/lib/topology/link-attrs";
import {
  LINK_SOURCE_RANK,
  type LinkSource,
  type ModelCounts,
  type TopologyModel,
  type TopologyModelInput,
} from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, nameKey, type NodeIndex } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { assignSites } from "@/lib/topology/sites";
import { placeVms, resolveScanHosts } from "@/lib/topology/vms";
import { normalizeName } from "@/lib/topology/match";
import { parseDbDate } from "@/lib/db-date";

export const PROMOTE_CLASSES = ["switch", "router", "access_point", "firewall"] as const;
const SUSPICIOUS_TYPES = ["switch", "access_point"];

export function buildTopologyModel(input: TopologyModelInput): TopologyModel {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  // Spec §11.5: le schede vive di un hypervisor (MAC veri) lo identificano sulla tabella MAC degli switch.
  for (const { row, nodeId } of resolveScanHosts(input.scanHosts, idx)) if (nodeId) addNodeMacs(idx, nodeId, row.macs);
  const { vms, vmNodeIds, vmMacs, runningVmMacs } = placeVms(input, idx);
  const { links: baseLinks, unmatched, ignored } = buildLinks(input, idx);
  const { portClients, clientCount, attachLinks } = attachMacs(input, idx, baseLinks, vmMacs, runningVmMacs, ignored);
  const links = [...baseLinks, ...attachLinks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  enrichLinks(links, input, idx);
  const sites = assignSites(input, idx, links);

  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.a, (degree.get(l.a) ?? 0) + 1);
    degree.set(l.b, (degree.get(l.b) ?? 0) + 1);
  }
  const proxmoxName = proxmoxNames(input, idx);
  const nodes = [...idx.nodes.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => {
      const pn = proxmoxName.get(n.id);
      return pn === undefined ? n : { ...n, name: pn, ...(nameKey(n.name) ? { dnsName: n.name } : {}) };
    });
  const portCount = new Map(input.devices.map((d) => [d.id, d.port_count]));
  const devices = nodes.filter((n) => n.kind === "device");

  const promote = nodes
    .filter((n) => n.kind === "host" && (PROMOTE_CLASSES as readonly string[]).includes(n.type) && (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      hostId: n.refId, name: n.name, ip: n.mgmtIp ?? "", classification: n.type, links: degree.get(n.id) ?? 0,
    }))
    .sort((a, b) => b.links - a.links || a.name.localeCompare(b.name, "it") || a.hostId - b.hostId);
  // «Da sistemare» (spec §10.2): apparati senza collegamenti e oggetti attaccati (server, NAS, hypervisor) senza collegamenti.
  // Un nodo che è una VM (spec §11.5) sta dentro il suo hypervisor: non c'è niente da sistemare.
  const isolated = nodes
    .filter((n) => !n.hidden && !vmNodeIds.has(n.id) && (degree.get(n.id) ?? 0) === 0
      && (n.kind === "device" || ["att", "hyper"].includes(nodeClass(n))))
    .map((n) => n.id);
  const suspicious = isolated.filter((id) => {
    const n = idx.nodes.get(id);
    return n !== undefined && SUSPICIOUS_TYPES.includes(n.type) && (portCount.get(n.refId) ?? 0) === 0;
  });
  const withoutSite = devices.filter((n) => !n.hidden && !vmNodeIds.has(n.id) && n.siteId === null).map((n) => n.id);

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
    isolatedDevices: isolated.filter(isDev).length,
    fusedHosts: idx.fusedHosts,
    mergedHosts: idx.mergedHosts,
    devicesWithoutSite: withoutSite.length,
    sitesWithHead: sites.filter((s) => s.headNodeId !== null).length,
    promoteProposals: promote.length,
    suspiciousTypes: suspicious.length,
    vms: vms.length,
    hypervisors: nodes.filter((n) => nodeClass(n) === "hyper").length,
    vmsOnNodes: vms.filter((v) => v.nodeId !== null).length,
  };
  const canonical = Object.fromEntries([...idx.alias.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return { nodes, links, sites, promote, unmatched, isolated, suspicious, withoutSite, counts, portClients, clientCount, canonical, vms };
}

/**
 * Nome dal Proxmox (spec §12.5): un hypervisor il cui IP sta nelle schede di un host della scansione Proxmox con un
 * altro nome (confronto senza dominio e senza maiuscole) si chiama sulla mappa come il nodo Proxmox; il nome di prima
 * diventa `dnsName` («DNS: …»), tranne quando era solo un IP. Solo l'abbinamento per IP: per nome i nomi coincidono già.
 * Due host del cluster con nomi diversi per lo stesso nodo: non si sceglie, il nome resta.
 * Solo da una scansione degli ultimi 30 giorni (Riccardo, 14/10); senza data valida la scansione è vecchia.
 */
const PROXMOX_NAME_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
function scanIsRecent(scannedAt: string | null | undefined, nowMs: number): boolean {
  const t = parseDbDate(scannedAt).getTime();
  return Number.isFinite(t) && nowMs - t <= PROXMOX_NAME_MAX_AGE_MS;
}

function proxmoxNames(input: TopologyModelInput, idx: NodeIndex): Map<string, string> {
  const found = new Map<string, string | null>();
  for (const { row, nodeId, byIp } of resolveScanHosts(input.scanHosts, idx)) {
    if (!nodeId || !byIp || !scanIsRecent(row.scannedAt, input.nowMs)) continue;
    const cur = found.get(nodeId);
    found.set(nodeId, cur === undefined || (cur !== null && normalizeName(cur) === normalizeName(row.hostname)) ? (cur ?? row.hostname) : null);
  }
  const out = new Map<string, string>();
  for (const [id, hostname] of found) {
    const n = idx.nodes.get(id);
    if (hostname && n && normalizeName(n.name) !== normalizeName(hostname)) out.set(id, hostname);
  }
  return out;
}
