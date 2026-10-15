/**
 * Il modello per cavo in ombra (spec topologia §13.11.3, T2.7): dall'ingresso alle prove, ai collegamenti e (Task 11)
 * all'albero dallo spanning tree. L'identità degli oggetti è quella del modello di oggi (stessi nodi, stessi id), con in più
 * i MAC degli apparati letti in T2 (solo per abbinare le righe). Logica pura; si calcola a richiesta e non si salva.
 */
import { parseSpeedMbps } from "@/lib/topology/link-attrs";
import { comeDi, portaSalvata } from "@/lib/topology/links";
import type { TopologyModel } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, type NodeIndex } from "@/lib/topology/node-index";
import { resolveScanHosts } from "@/lib/topology/vms";
import type { ContestoCavi } from "./collegamenti";
import type { ElencoPorte } from "./porte";
import { elenchiCavi, indiceFatti, proveDaInput, type IndiceFatti, type IngressoCavi, type Prova } from "./prove";

export interface PreparatoCavi { idx: NodeIndex; prove: Prova[]; ctx: ContestoCavi; elenchi: Map<string, ElencoPorte>; fatti: IndiceFatti }

export function preparaCavi(ing: IngressoCavi, t1: TopologyModel): PreparatoCavi {
  const idx = buildNodeIndex(ing.t1.devices, ing.t1.hosts, ing.t1.knownMacs, ing.t1.neighbors);
  for (const { row, nodeId } of resolveScanHosts(ing.t1.scanHosts, idx)) if (nodeId) addNodeMacs(idx, nodeId, row.macs);
  const macApparati = new Map<string, Set<string>>();
  for (const m of ing.macApparati) {
    const nodo = `dev:${m.device_id}`;
    const s = macApparati.get(nodo) ?? new Set<string>();
    s.add(m.mac.toUpperCase());
    macApparati.set(nodo, s);
  }
  for (const [nodo, macs] of macApparati) if (idx.nodes.has(nodo)) addNodeMacs(idx, nodo, [...macs]);
  const elenchi = elenchiCavi(ing);
  const fatti = indiceFatti(ing);
  const prove = proveDaInput(ing, { idx, elenchi, come: comeDi(ing.t1), fatti }, t1);
  const velocita = new Map<string, number>();
  const statoPorte = new Map<string, "su" | "giu" | "spenta">();
  for (const p of ing.t1.ports ?? []) {
    const k = `dev:${p.device_id}|i:${p.port_index}`;
    const v = parseSpeedMbps(p.speed);
    if (v) velocita.set(k, v);
    const s = p.status === "up" ? "su" : p.status === "down" ? "giu" : p.status === "disabled" ? "spenta" : null;
    if (s) statoPorte.set(k, s);
  }
  const router = new Set([...idx.nodes.values()].filter((n) => n.type === "router" || n.type === "firewall").map((n) => n.id));
  const vmIpervisore = new Map(t1.vms.flatMap((v) => (v.nodeId && v.hypervisorNodeId ? [[v.nodeId, v.hypervisorNodeId] as const] : [])));
  const ctx: ContestoCavi = {
    nowMs: ing.t1.nowMs, staleDays: ing.t1.staleDays, porte: elenchi, fatti, statoPorte, velocita, macApparati, idx, router, vmIpervisore,
    portaSalvata: portaSalvata(ing.t1),
  };
  return { idx, prove, ctx, elenchi, fatti };
}
