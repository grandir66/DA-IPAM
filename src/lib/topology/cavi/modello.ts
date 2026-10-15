/**
 * Il modello per cavo in ombra (spec topologia §13.11.3, T2.7): dall'ingresso alle prove, ai collegamenti e (Task 11)
 * all'albero dallo spanning tree. L'identità degli oggetti è quella del modello di oggi (stessi nodi, stessi id), con in più
 * i MAC degli apparati letti in T2 (solo per abbinare le righe). Logica pura; si calcola a richiesta e non si salva.
 */
import { nodeClass } from "@/lib/topology/identity";
import { parseSpeedMbps } from "@/lib/topology/link-attrs";
import { lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { comeDi, portaSalvata } from "@/lib/topology/links";
import type { TopologyModel } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, type NodeIndex } from "@/lib/topology/node-index";
import { resolveScanHosts } from "@/lib/topology/vms";
import { alberoCavi, type AlberoCavi, type NodoCavi } from "./albero";
import { costruisciCollegamenti, type Collegamento, type ContestoCavi, type Segmento } from "./collegamenti";
import { chiavePorta, type ElencoPorte } from "./porte";
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

/** Le parti del modello per cavo che T2 non calcola: la traccia le dice in una riga ciascuna (§13.11.3). */
export const NON_CALCOLATO_IN_T2: readonly string[] = [
  "«oltre» una radio non letta (§13.7.6, punto 5): arriva in T3",
  "router e firewall in una VM dentro il loro hypervisor (§13.7.8): arriva in T3",
  "i collegamenti «dalle VM» che non sono principali e che nessun'altra lettura vede (§13.15, punto 4): si misurano in T3",
  "l'ordine nuovo dell'abbinamento «telaio, nome, IP» (§13.6.4): arriva in T3",
  "le mappe passo passo (§13.7.7): la traccia guarda la mappa automatica",
  "lo stato per istanza dello spanning tree, finché le istanze non sono lette sulla forma vera",
  "le prove di ruolo coi fatti nuovi (BPDU ricevuti, capacità annunciate): la classe di ogni oggetto è quella della mappa di oggi; arrivano in T3",
];

export interface ModelloCavi {
  collegamenti: Collegamento[];
  segmenti: Segmento[];
  albero: AlberoCavi;
  correzioniOrfane: number[];
  /** false = lo schema delle letture in più non c'è: il modello per cavo lavora solo sulle righe di oggi, e la traccia lo dice. */
  schema: boolean;
  nonCalcolato: readonly string[];
}

const macDel = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toLowerCase() : null);

export function costruisciModelloCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testaScelta: string | null }): ModelloCavi {
  const p = preparaCavi(ing, t1);
  const { collegamenti, segmenti, correzioniOrfane } = costruisciCollegamenti(p.prove, ing.t1.overrides, p.ctx);
  const nodi = new Map<string, NodoCavi>();
  // Anche i nodi del modello di oggi che l'indice qui non ha: il modello di oggi crea il nodo di un host al bisogno (nodeFor),
  // e la prova di bordo lo nomina con quell'id. Senza, un server attaccato dalla tabella MAC «usciva» dall'albero in ombra pur
  // avendo il cavo verso il suo switch (misura del Task 14 di T2 sulle copie, 15/10: 13 host sul cliente A, 9 sulla rete B).
  for (const n of [...p.idx.nodes.values(), ...t1.nodes]) {
    if (nodi.has(n.id)) continue;
    nodi.set(n.id, { id: n.id, classe: t1.classiMappa?.[n.id] ?? nodeClass(n), tipo: n.type, numero: n.refId, hidden: n.hidden });
  }
  for (const s of segmenti) nodi.set(s.id, { id: s.id, classe: "segmento", tipo: "segmento", numero: Number.MAX_SAFE_INTEGER, hidden: false });
  const collegati = new Set(collegamenti.flatMap((c) => [c.a.nodo, c.b.nodo]));
  const visibili = new Set([...nodi.values()].filter((n) => !n.hidden && n.classe !== "client" && n.classe !== "da_sistemare" && collegati.has(n.id)).map((n) => n.id));
  // Punto 1: la porta radice dai bridge letti (il controller non la dice), la radice; la porta di uplink del controller.
  const portaRadice = new Map<string, string>();
  for (const b of [...ing.fattiBridge].sort((x, y) => x.device_id - y.device_id || (x.bridge_name < y.bridge_name ? -1 : 1))) {
    const nodo = `dev:${b.device_id}`;
    if (b.instance !== 0 || lettoreDellaFonte(b.source) === "controller" || b.root_id === null || portaRadice.has(nodo)) continue;
    if (b.root_port !== null) portaRadice.set(nodo, b.root_port);
    else if (b.bridge_id !== null && macDel(b.root_id) === macDel(b.bridge_id)) portaRadice.set(nodo, "radice");
  }
  const portaUplink = new Map<string, { chiave: string | null; nome: string }>();
  const gateway = new Set<string>();
  const upCavi = new Map(ing.uplink.map((u) => [u.device_id, u.uplink_local_port_idx]));
  for (const d of ing.t1.devices) {
    if (!d.controller_mac) continue;
    const nodo = `dev:${d.id}`;
    if (d.device_type === "router" || d.device_type === "firewall") gateway.add(nodo);
    const i = upCavi.get(d.id) ?? ing.t1.uplinkPorts.find((u) => u.device_id === d.id)?.port_index ?? null;
    if (i === null) continue;
    const nome = p.elenchi.get(nodo)?.perIndice.get(i) ?? `Port ${i}`;
    portaUplink.set(nodo, { chiave: chiavePorta(nodo, { nome, fisica: true, senzaFili: false, nelBridge: null, fascio: null }, "locale", p.elenchi.get(nodo), i).chiave, nome });
  }
  const ipervisori = new Set([...nodi.values()].filter((n) => n.classe === "hyper").map((n) => n.id));
  for (const v of t1.vms) if (v.hypervisorNodeId) ipervisori.add(v.hypervisorNodeId);
  const testaConfermata = opz.testaScelta ?? t1.sites.find((s) => s.headNodeId !== null && !s.headProposed)?.headNodeId ?? null;
  const albero = alberoCavi({
    nodi, visibili, collegamenti, testaConfermata, portaRadice, portaUplink, gateway, gatewayDi: t1.gatewayDi ?? {},
    primari: ing.t1.primaries.map((x) => ({ node_id: x.node_id, other_node: x.other_node })), ipervisori,
  });
  return { collegamenti, segmenti, albero, correzioniOrfane, schema: ing.schema, nonCalcolato: NON_CALCOLATO_IN_T2 };
}
