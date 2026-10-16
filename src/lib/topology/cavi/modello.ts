/**
 * Il modello per cavo in ombra (spec topologia §13.11.3, T2.7): dall'ingresso alle prove, ai collegamenti e (Task 11)
 * all'albero dallo spanning tree. L'identità degli oggetti è quella del modello di oggi (stessi nodi, stessi id), con in più
 * i MAC degli apparati letti in T2 (solo per abbinare le righe). Da T3 le righe si abbinano per telaio, nome e IP (§13.6.4,
 * in prove.ts) e la classe di ogni oggetto ha anche le prove di ruolo che vede solo il modello per cavo (§13.8.2, in
 * ruolo.ts). Logica pura; si calcola a richiesta e non si salva.
 */
import { nodeClass, ruoloLetto } from "@/lib/topology/identity";
import { parseSpeedMbps } from "@/lib/topology/link-attrs";
import { ipervisoriLetti, lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { comeDi, portaSalvata } from "@/lib/topology/links";
import type { ClasseMappa, TopologyModel } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, type NodeIndex } from "@/lib/topology/node-index";
import { resolveScanHosts } from "@/lib/topology/vms";
import { alberoCavi, type AlberoCavi, type NodoCavi } from "./albero";
import { costruisciCollegamenti, type Collegamento, type ContestoCavi, type Segmento } from "./collegamenti";
import { chiavePorta, elenchiPorte, indiciInElenco, type ElencoPorte } from "./porte";
import { elenchiCavi, indiceFatti, proveDaInput, type IndiceFatti, type IngressoCavi, type Prova } from "./prove";
import { classiCavi, proveDiRuolo, proveDiRuoloCavi, type ProvaRuolo } from "./ruolo";

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
  // Un nome doppio (spec §13.6.1, I70; come `enrichLinks` del modello di oggi): la porta non si sa, ma se tutte le porte con
  // quel nome vanno alla stessa velocità la velocità sì. Senza, sull'hub un hypervisor cambiava padre nella traccia (revisione
  // finale di T2, I1). L'elenco è quello di switch_ports, come per la chiave «i:N».
  const elenchiT1 = elenchiPorte(ing.t1.ports ?? []);
  const velocitaPerNome = (nodo: string, nome: string): number | null => {
    const el = elenchiT1.get(nodo);
    if (!el) return null;
    const v = [...new Set(indiciInElenco(el, nome).map((i) => velocita.get(`${nodo}|i:${i}`) ?? null))];
    return v.length === 1 ? v[0] : null;
  };
  const router = new Set([...idx.nodes.values()].filter((n) => n.type === "router" || n.type === "firewall").map((n) => n.id));
  const vmIpervisore = new Map(t1.vms.flatMap((v) => (v.nodeId && v.hypervisorNodeId ? [[v.nodeId, v.hypervisorNodeId] as const] : [])));
  const ctx: ContestoCavi = {
    nowMs: ing.t1.nowMs, staleDays: ing.t1.staleDays, porte: elenchi, fatti, statoPorte, velocita, velocitaPerNome, macApparati, idx, router,
    vmIpervisore, portaSalvata: portaSalvata(ing.t1),
  };
  return { idx, prove, ctx, elenchi, fatti };
}

/** Le parti del modello per cavo che T2 non calcola: la traccia le dice in una riga ciascuna (§13.11.3). */
export const NON_CALCOLATO_IN_T2: readonly string[] = [
  "«oltre» una radio non letta (§13.7.6, punto 5): arriva in T3",
  "router e firewall in una VM dentro il loro hypervisor (§13.7.8): arriva in T3",
  "i collegamenti «dalle VM» che non sono principali e che nessun'altra lettura vede (§13.15, punto 4): si misurano in T3",
  "le mappe passo passo (§13.7.7): la traccia guarda la mappa automatica",
  "lo stato per istanza dello spanning tree, finché le istanze non sono lette sulla forma vera",
];

export interface ModelloCavi {
  collegamenti: Collegamento[];
  segmenti: Segmento[];
  albero: AlberoCavi;
  correzioniOrfane: number[];
  /** false = lo schema delle letture in più non c'è: il modello per cavo lavora solo sulle righe di oggi, e la traccia lo dice. */
  schema: boolean;
  nonCalcolato: readonly string[];
  /** La classe di ogni nodo nel modello per cavo (§13.8.2, con le prove di T3); le VM non ci sono, come nel modello di oggi. */
  classi: ReadonlyMap<string, ClasseMappa>;
  /** I capi dei collegamenti di genere «radio». */
  ponti: ReadonlySet<string>;
}

const macDel = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toLowerCase() : null);

export function costruisciModelloCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testaScelta: string | null }): ModelloCavi {
  const p = preparaCavi(ing, t1);
  const { collegamenti, segmenti, correzioniOrfane } = costruisciCollegamenti(p.prove, ing.t1.overrides, p.ctx);
  // Le classi del modello per cavo (§13.8.2, T3): le prove di oggi (le stesse di buildTopologyModel, ricalcolate sull'indice
  // del modello per cavo, che ha anche i MAC letti in T2) e quelle che vede solo il modello per cavo; i capi dei ponti radio.
  const ponti = new Set(collegamenti.filter((c) => c.genere === "radio").flatMap((c) => [c.a.nodo, c.b.nodo]));
  const proveOggi = proveDiRuolo(ing.t1, p.idx, { vms: t1.vms, scansioni: ipervisoriLetti(ing.t1.devices) });
  const proveT3 = proveDiRuoloCavi(ing, p.prove, p.fatti, ponti, (id) => { const n = p.idx.nodes.get(id); return n ? nodeClass(n) : null; });
  const unite = new Map<string, ProvaRuolo[]>();
  for (const m of [proveOggi, proveT3]) for (const [id, l] of m) unite.set(id, [...new Set([...(unite.get(id) ?? []), ...l])].sort());
  const ruoli = new Map(ing.t1.devices.map((d) => [`dev:${d.id}`, ruoloLetto(d.topology_role)]));
  // Un nodo che è una VM sta dentro il suo hypervisor: nessuna classe dalle prove, come nel modello di oggi (`model.ts`).
  const vm = new Set(t1.vms.flatMap((v) => (v.nodeId ? [v.nodeId] : [])));
  const nodiTutti = [...p.idx.nodes.values(), ...t1.nodes.filter((n) => !p.idx.nodes.has(n.id))];
  const classi = classiCavi(nodiTutti.filter((n) => !vm.has(n.id)), unite, (id) => ruoli.get(id) ?? null, ponti);
  const nodi = new Map<string, NodoCavi>();
  // Anche i nodi del modello di oggi che l'indice qui non ha: il modello di oggi crea il nodo di un host al bisogno (nodeFor),
  // e la prova di bordo lo nomina con quell'id. Senza, un server attaccato dalla tabella MAC «usciva» dall'albero in ombra pur
  // avendo il cavo verso il suo switch (misura del Task 14 di T2 sulle copie, 15/10: 13 host sul cliente A, 9 sulla rete B).
  for (const n of nodiTutti) {
    nodi.set(n.id, { id: n.id, classe: classi.get(n.id) ?? t1.classiMappa?.[n.id] ?? nodeClass(n), tipo: n.type, numero: n.refId, hidden: n.hidden });
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
  return { collegamenti, segmenti, albero, correzioniOrfane, schema: ing.schema, nonCalcolato: NON_CALCOLATO_IN_T2, classi, ponti };
}
