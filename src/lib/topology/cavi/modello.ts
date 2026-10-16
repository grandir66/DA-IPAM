/**
 * Il modello per cavo in ombra (spec topologia §13.11.3, T2.7): dall'ingresso alle prove, ai collegamenti e (Task 11)
 * all'albero dallo spanning tree. L'identità degli oggetti è quella del modello di oggi (stessi nodi, stessi id), con in più
 * i MAC degli apparati letti in T2 (solo per abbinare le righe). Da T3 le righe si abbinano per telaio, nome e IP (§13.6.4,
 * in prove.ts) e la classe di ogni oggetto ha anche le prove di ruolo che vede solo il modello per cavo (§13.8.2, in
 * ruolo.ts). Da T3 i collegamenti «dalle VM» che non sono principali stanno nei dettagli dell'hypervisor, se la misura lo
 * conferma (§13.15 punto 4, `DALLE_VM_SOLO_DETTAGLI`). Logica pura; si calcola a richiesta e non si salva.
 */
import { nodeClass, ruoloLetto } from "@/lib/topology/identity";
import { macSullaPorta, parseSpeedMbps } from "@/lib/topology/link-attrs";
import { ipervisoriLetti, lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { comeDi, portaSalvata } from "@/lib/topology/links";
import type { ClasseMappa, TopologyModel } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, type NodeIndex } from "@/lib/topology/node-index";
import { resolveScanHosts } from "@/lib/topology/vms";
import { alberoCavi, type AlberoCavi, type NodoCavi } from "./albero";
import { costruisciCollegamenti, type Collegamento, type ContestoCavi, type RisultatoCavi, type Segmento } from "./collegamenti";
import { chiavePorta, elenchiPorte, indiciInElenco, type ElencoPorte } from "./porte";
import { elenchiCavi, indiceFatti, proveDaInput, type IndiceFatti, type IngressoCavi, type Prova } from "./prove";
import { classiCavi, proveDiRuolo, proveDiRuoloCavi, type ProvaRuolo } from "./ruolo";

export interface PreparatoCavi {
  idx: NodeIndex; prove: Prova[]; ctx: ContestoCavi; elenchi: Map<string, ElencoPorte>; fatti: IndiceFatti;
  /** La classe di ogni nodo (§13.8.2, T3): le prove di ruolo di oggi e quelle del modello per cavo, coi capi dei ponti radio dati. */
  classi: (ponti: ReadonlySet<string>) => Map<string, ClasseMappa>;
}

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
  const prove = proveDaInput(ing, { idx, elenchi, come: comeDi(ing.t1), fatti, macSullaPorta: (n, porta, altro) => macSullaPorta(ing.t1, idx, n, porta, altro) }, t1);
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

  // Le classi del modello per cavo (§13.8.2, T3): le prove di oggi (le stesse di buildTopologyModel, ricalcolate sull'indice del
  // modello per cavo, che ha anche i MAC letti in T2) e quelle che vede solo il modello per cavo; i capi dei ponti radio dati.
  // I nodi si contano a ogni chiamata: le correzioni creano al bisogno i nodi degli host (nodeFor), come il modello di oggi.
  const proveOggi = proveDiRuolo(ing.t1, idx, { vms: t1.vms, scansioni: ipervisoriLetti(ing.t1.devices) });
  const ruoli = new Map(ing.t1.devices.map((d) => [`dev:${d.id}`, ruoloLetto(d.topology_role)]));
  // Un nodo che è una VM sta dentro il suo hypervisor: nessuna classe dalle prove, come nel modello di oggi (`model.ts`).
  const vm = new Set(t1.vms.flatMap((v) => (v.nodeId ? [v.nodeId] : [])));
  const classi = (ponti: ReadonlySet<string>): Map<string, ClasseMappa> => {
    const proveT3 = proveDiRuoloCavi(ing, prove, fatti, ponti, (id) => { const n = idx.nodes.get(id); return n ? nodeClass(n) : null; });
    const unite = new Map<string, ProvaRuolo[]>();
    for (const m of [proveOggi, proveT3]) for (const [id, l] of m) unite.set(id, [...new Set([...(unite.get(id) ?? []), ...l])].sort());
    const nodiTutti = [...idx.nodes.values(), ...t1.nodes.filter((n) => !idx.nodes.has(n.id))];
    return classiCavi(nodiTutti.filter((n) => !vm.has(n.id)), unite, (id) => ruoli.get(id) ?? null, ponti);
  };
  // Per le regole che decidono i collegamenti (§13.7.6 punto 5): gli apparati di rete senza i ponti radio, che si conoscono solo
  // dopo i collegamenti; gli hypervisor; chi legge vicini propri, qualunque fonte.
  const prime = classi(new Set());
  const rete = new Set([...prime].filter(([, k]) => k === "infra" || k === "ap").map(([id]) => id));
  const ipervisori = new Set([...prime].filter(([, k]) => k === "hyper").map(([id]) => id));
  for (const h of vmIpervisore.values()) ipervisori.add(h);
  const ctx: ContestoCavi = {
    nowMs: ing.t1.nowMs, staleDays: ing.t1.staleDays, porte: elenchi, fatti, statoPorte, velocita, velocitaPerNome, macApparati, idx, router,
    vmIpervisore, portaSalvata: portaSalvata(ing.t1), letti: new Set(ing.vicini.map((n) => `dev:${n.device_id}`)), rete, ipervisori,
  };
  return { idx, prove, ctx, elenchi, fatti, classi };
}

/**
 * §13.7.2 passo 10, §13.15 punto 4 (I56, S11): un collegamento con la SOLA prova «dalle VM» che non è il principale del suo
 * hypervisor non si disegna, nemmeno a richiesta, e sta nei dettagli dell'hypervisor. Il valore lo decide la misura del Task 0
 * del piano di T3 (riga «Decisione: dalle VM» del registro): entra se ogni collegamento «dalle VM» non principale è una
 * ridondanza che nessun'altra lettura vede. Al 16/10 la misura non c'è ancora: spenta, e quei collegamenti restano ridondanze
 * a richiesta, come oggi (§13.14). Costo se resta spenta e la regola era giusta: i cavi inventati verso un hypervisor (M26)
 * restano disegnabili a richiesta; se si accende e uno era un cavo vero, sparisce dalla mappa (resta nei dettagli).
 */
export const DALLE_VM_SOLO_DETTAGLI: boolean = false;

/** Le parti del modello per cavo che non si calcolano ancora: la traccia e la pagina le dicono in una riga ciascuna (§13.11.3). */
function nonCalcolato(dalleVmSoloDettagli: boolean): readonly string[] {
  return [
    "lo stato per istanza dello spanning tree, finché le istanze non sono lette sulla forma vera (Task 3b del piano di T2)",
    "la testa quando l'unico router è una VM: resta la regola di oggi, scelta di Riccardo (§13.16, punto 3)",
    ...(dalleVmSoloDettagli ? [] : ["i collegamenti «dalle VM» non principali restano ridondanze a richiesta: la misura non ha ancora confermato la regola (§13.15, punto 4)"]),
  ];
}
export const NON_CALCOLATO: readonly string[] = nonCalcolato(DALLE_VM_SOLO_DETTAGLI);

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
  /** I capi dei salti radio (§13.7.6 punto 4): letti o dedotti (genere «radio»), dichiarati a mano (tipo wireless), e la radio
   * vicina di un router «oltre» (punto 5). */
  ponti: ReadonlySet<string>;
  /** Le prove che non diventano un collegamento: stessa rete (anche gli annunci di una VM, §13.7.8), tunnel spenti o non letti. */
  stessaRete: Prova[];
  oltre: RisultatoCavi["oltre"];
  scartateBordo: RisultatoCavi["scartateBordo"];
  scartateVm: RisultatoCavi["scartateVm"];
  /** I collegamenti «dalle VM» non principali che non si disegnano (con `DALLE_VM_SOLO_DETTAGLI`): nei dettagli dell'hypervisor. */
  soloDettagli: Array<{ collegamento: Collegamento; ipervisore: string; altro: string; porta: string; vm: number }>;
}

const macDel = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toLowerCase() : null);

export function costruisciModelloCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testaScelta: string | null; dalleVmSoloDettagli?: boolean }): ModelloCavi {
  const p = preparaCavi(ing, t1);
  const r = costruisciCollegamenti(p.prove, ing.t1.overrides, p.ctx);
  const { collegamenti, segmenti, correzioniOrfane } = r;
  // I capi dei salti radio (§13.7.6 punto 4): letti o dedotti, dichiarati a mano (tipo wireless, D7), la radio vicina del punto 5.
  // Fanno da ponte nell'albero ed essere capo di un salto è una prova di ruolo (§13.8.2).
  const ponti = new Set([
    ...collegamenti.filter((c) => c.genere === "radio" || c.medio === "wireless").flatMap((c) => [c.a.nodo, c.b.nodo]),
    ...collegamenti.flatMap((c) => (c.oltre !== undefined ? [c.oltre] : [])),
  ]);
  const classi = p.classi(ponti);
  const nodiTutti = [...p.idx.nodes.values(), ...t1.nodes.filter((n) => !p.idx.nodes.has(n.id))];
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

  // §13.7.2 passo 10, §13.15 punto 4 (I56, S11): un collegamento con la SOLA prova «dalle VM» che non è il principale del suo
  // hypervisor non si disegna, nemmeno a richiesta: sta nei dettagli dell'hypervisor. L'hypervisor è una foglia, quindi quel
  // collegamento non è il padre di nessuno: toglierlo dopo l'albero non cambia l'albero (lo prova cavi-collegamenti.test.ts).
  const dalleVm = opz.dalleVmSoloDettagli ?? DALLE_VM_SOLO_DETTAGLI;
  const soloDettagli: ModelloCavi["soloDettagli"] = [];
  const disegnati = !dalleVm ? collegamenti : collegamenti.filter((c) => {
    if (c.prove.length === 0 || !c.prove.every((q) => q.classe === "vm")) return true;
    const h = ipervisori.has(c.a.nodo) ? c.a : ipervisori.has(c.b.nodo) ? c.b : null;
    if (h === null || albero.via.get(h.nodo)?.id === c.id) return true;     // il principale resta, anche con una VM sola
    const sw = h === c.a ? c.b : c.a;
    soloDettagli.push({ collegamento: c, ipervisore: h.nodo, altro: sw.nodo, porta: sw.nome, vm: c.vm ?? 0 });
    return false;
  });
  return {
    collegamenti: disegnati, segmenti, albero, correzioniOrfane, schema: ing.schema, nonCalcolato: nonCalcolato(dalleVm), classi, ponti,
    stessaRete: r.stessaRete, oltre: r.oltre, scartateBordo: r.scartateBordo, scartateVm: r.scartateVm, soloDettagli,
  };
}
