/**
 * Il modello della mappa (spec §3, fase 1 «i dati giusti»): nodi fusi,
 * collegamenti con fonte ed età, sedi con testa, proposte e «da sistemare».
 * Si calcola a ogni richiesta, non si salva. Logica pura.
 */
import { attachMacs } from "@/lib/topology/attach";
import { correzioniOrfane } from "@/lib/topology/ignorati";
import { buildLinks, pairKey } from "@/lib/topology/links";
import { enrichLinks } from "@/lib/topology/link-attrs";
import { classeInMappa, proveDiRuolo, ruoloLetto } from "@/lib/topology/cavi/ruolo";
import { motivoDaSistemare } from "@/lib/topology/da-sistemare";
import {
  LINK_SOURCE_RANK,
  type ClasseMappa,
  type LinkSource,
  type MapNode,
  type ModelCounts,
  type TopologyModel,
  type TopologyModelInput,
} from "@/lib/topology/model-types";
import { addNodeMacs, indiceDeiNodi, nameKey, type NodeIndex } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
import { assignSites, retiDiCuiGateway } from "@/lib/topology/sites";
import { placeVms, resolveScanHosts } from "@/lib/topology/vms";
import { ipervisoriDelleVm, vmEIpervisore } from "@/lib/topology/vm-ports";
import { normalizeName } from "@/lib/topology/match";
import { TESTI_UNIONI, type InfoUnioni } from "@/lib/topology/unioni-tipi";
import { parseDbDate } from "@/lib/db-date";

export const PROMOTE_CLASSES = ["switch", "router", "access_point", "firewall"] as const;
const SUSPICIOUS_TYPES = ["switch", "access_point"];

/** `regole`: le regole del passaggio universale accese (spec §13.16); le spegne solo la misura (C19). */
export function buildTopologyModel(input: TopologyModelInput, regole: Regole = REGOLE_T1): TopologyModel {
  const idx = indiceDeiNodi(input);
  // Spec §11.5: le schede vive di un hypervisor (MAC veri) lo identificano sulla tabella MAC degli switch.
  for (const { row, nodeId } of resolveScanHosts(input.scanHosts, idx)) if (nodeId) addNodeMacs(idx, nodeId, row.macs);
  const { vms, vmNodeIds, vmMacs, runningVmMacs } = placeVms(input, idx);
  // Spec §13.7.8: per ogni nodo che è una VM, il suo hypervisor: fra i due nessun collegamento dai dati (G9).
  const ipervisori = ipervisoriDelleVm(vms);
  // T1b (spec §13.8.2): le prove di ruolo, prima di attaccare i MAC — chi è «da sistemare» conta come un client.
  // La scansione delle VM di un hypervisor censito (spec §11.5): una prova del ruolo «hypervisor» (§13.8.2, I65).
  const scansioni = new Set(input.devices.filter((d) => d.proxmox_scan === 1).map((d) => `dev:${d.id}`));
  const prove = proveDiRuolo(input, idx, { vms, scansioni });
  const ruoloAMano = new Map<string, "rete" | "attaccato" | null>(
    input.devices.map((d) => [`dev:${d.id}`, ruoloLetto(d.topology_role)]),
  );
  const classe = (n: MapNode): ClasseMappa => classeInMappa(n, prove.get(n.id), ruoloAMano.get(n.id) ?? null);
  const { links: baseLinks, unmatched, ignorati, segmenti, scartate } = buildLinks(input, idx, runningVmMacs, regole);
  const { portClients, clientCount, attachLinks } = attachMacs(input, idx, baseLinks, { vmMacs, runningVmMacs, ignorati, segmenti, ipervisori, regole, classe });
  // Nemmeno da un annuncio (una VM che sente il bridge del suo hypervisor): la VM sta dentro; un collegamento a mano resta.
  const links = [...baseLinks, ...attachLinks]
    .filter((l) => !regole.has("vm-e-mac-propri") || l.sources.includes("manual") || !vmEIpervisore(ipervisori, l.a, l.b))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // T1b (§13.4.6): il motivo delle righe scartate sulla coppia, in fondo ai passi della sua linea (anche di una linea della
  // tabella MAC o delle VM: la coppia è la stessa).
  for (const l of links) {
    const s = scartate.get(pairKey(l.a, l.b));
    if (s) l.perche = [...(l.perche ?? []), ...s];
  }
  enrichLinks(links, input, idx, regole);
  const sites = assignSites(input, idx, links);
  // Spec §13.8.1 (I63, H17): le reti di cui ogni apparato è gateway, per la testa proposta della mappa automatica.
  const gatewayDi = regole.has("testa-per-reti") ? Object.fromEntries(retiDiCuiGateway(input, idx)) : undefined;

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
  const classiMappa: Record<string, ClasseMappa> = {};
  for (const n of nodes) {
    if (vmNodeIds.has(n.id)) continue;
    const k = classe(n);
    if (k !== nodeClass(n)) classiMappa[n.id] = k;
  }
  const daSistemare = nodes
    .filter((n) => !n.hidden && classiMappa[n.id] === "da_sistemare")
    .map((n) => ({ id: n.id, motivo: motivoDaSistemare(n) }));
  const portCount = new Map(input.devices.map((d) => [d.id, d.port_count]));
  const devices = nodes.filter((n) => n.kind === "device");

  const promote = nodes
    .filter((n) => n.kind === "host" && (PROMOTE_CLASSES as readonly string[]).includes(n.type) && (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      hostId: n.refId, name: n.name, ip: n.mgmtIp ?? "", classification: n.type, links: degree.get(n.id) ?? 0,
    }))
    .sort((a, b) => b.links - a.links || a.name.localeCompare(b.name, "it") || a.hostId - b.hostId);
  // «Da sistemare» (spec §10.2): apparati senza collegamenti e oggetti attaccati (server, NAS, hypervisor) senza
  // collegamenti; da T1 anche chi la porta di un segmento sente e, per la regola del segmento, resta senza collegamenti
  // (H5: sull'hub gli switch di laboratorio, solo host, diventavano radici sole della mappa automatica; revisione del
  // piano, 15/10). Solo loro: un host isolato per altri motivi resta com'era (sul cliente A la radio lontana a 60 GHz
  // resta la seconda radice, C16). Un nodo che è una VM (spec §11.5) sta dentro il suo hypervisor: niente da sistemare.
  const membriDiSegmento = new Set([...segmenti.values()].flatMap((m) => [...m]));
  const isolated = nodes
    .filter((n) => !n.hidden && !vmNodeIds.has(n.id) && (degree.get(n.id) ?? 0) === 0
      && (n.kind === "device" || ["att", "hyper"].includes(nodeClass(n)) || membriDiSegmento.has(n.id)
        // T1b (spec §13.8.2, G10, I64): nessuna radice sola — un host di rete con una prova di ruolo e nessun collegamento.
        // Senza una prova sta già in `daSistemare` («senza prove di ruolo»). Rete B: cinque radici sole; cliente A la radio.
        || (n.kind === "host" && ["infra", "ap"].includes(classe(n)))))
    .map((n) => n.id);
  // I tipi sospetti sono degli apparati: il numero di porte è di network_devices, e ora fra gli isolati può esserci un host.
  const suspicious = isolated.filter((id) => {
    const n = idx.nodes.get(id);
    return n !== undefined && n.kind === "device" && SUSPICIOUS_TYPES.includes(n.type) && (portCount.get(n.refId) ?? 0) === 0;
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
    senzaProve: daSistemare.length,
  };
  const canonical = Object.fromEntries([...idx.alias.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return {
    nodes, links, sites, promote, unmatched, isolated, suspicious, withoutSite, counts, portClients, clientCount, canonical, vms,
    // Dopo attachMacs: tabella MAC, ripiego del router e VM segnano anche loro le regole che tolgono qualcosa (§13.9, C5).
    correzioniOrfane: correzioniOrfane(ignorati, input.overrides),
    segmenti: Object.fromEntries([...segmenti].map(([k, membri]) => [k, [...membri].sort()])),
    classiMappa, daSistemare,
    ...(gatewayDi ? { gatewayDi } : {}),
    // Solo con righe (Scelte 8): un campo vuoto cambierebbe le impronte di oggi.
    ...(input.unioni?.length || input.separazioni?.length ? { unioni: infoUnioni(idx, input) } : {}),
  };
}

/** Le unioni a mano applicate, quelle che non si applicano (col perché) e i membri spariti (ADR 0021). */
function infoUnioni(idx: NodeIndex, input: TopologyModelInput): InfoUnioni {
  const nome = (id: string): string => idx.nodes.get(id)?.name ?? id;
  return {
    aMano: Object.fromEntries([...idx.aMano.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
    nonApplicate: idx.nonApplicate.map((n) => ({ gruppo: n.gruppo, membri: n.membri, motivo: TESTI_UNIONI.dueApparati(nome(n.apparati[0]), nome(n.apparati[1])) })),
    mancanti: [...new Set(idx.mancanti)].sort(),
    separazioni: input.separazioni?.length ?? 0,
  };
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
