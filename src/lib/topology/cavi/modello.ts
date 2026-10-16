/**
 * Il modello per cavo in ombra (spec topologia §13.11.3, T2.7): dall'ingresso alle prove, ai collegamenti e (Task 11)
 * all'albero dallo spanning tree. L'identità degli oggetti è quella del modello di oggi (stessi nodi, stessi id), con in più
 * i MAC degli apparati letti in T2 (solo per abbinare le righe). Da T3 le righe si abbinano per telaio, nome e IP (§13.6.4,
 * in prove.ts) e la classe di ogni oggetto ha anche le prove di ruolo che vede solo il modello per cavo (§13.8.2, in
 * ruolo.ts). Da T3 i collegamenti «dalle VM» che non sono principali stanno nei dettagli dell'hypervisor: la misura del 16/10
 * lo ha confermato (§13.15 punto 4, `DALLE_VM_SOLO_DETTAGLI`). Logica pura; si calcola a richiesta e non si salva.
 */
import { parseDbDate } from "@/lib/db-date";
import { nodeClass, ruoloLetto, ruoloRete } from "@/lib/topology/identity";
import { macSullaPorta, parseSpeedMbps } from "@/lib/topology/link-attrs";
import { ipervisoriLetti, lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { traduciPorta } from "@/lib/topology/lettori/traduci";
import { comeDi, portaSalvata } from "@/lib/topology/links";
import type { ClasseMappa, MapNode, TopologyModel } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, canonical, type NodeIndex } from "@/lib/topology/node-index";
import { isRunning } from "@/lib/topology/vm-nodes";
import { resolveScanHosts } from "@/lib/topology/vms";
import { normalizeMacForStorage } from "@/lib/utils";
import { alberoCavi, RADICE, type AlberoCavi, type NodoCavi } from "./albero";
import { aliasDeiSegmenti, costruisciCollegamenti, type Collegamento, type ContestoCavi, type RisultatoCavi, type Segmento } from "./collegamenti";
import { chiavePorta, elenchiPorte, indiciInElenco, type ElencoPorte, type Porta } from "./porte";
import { elenchiCavi, indiceFatti, proveDaInput, type IndiceFatti, type IngressoCavi, type Prova } from "./prove";
import { classiCavi, proveDiRuolo, proveDiRuoloCavi, type ProvaRuolo } from "./ruolo";

export interface PreparatoCavi {
  idx: NodeIndex; prove: Prova[]; ctx: ContestoCavi; elenchi: Map<string, ElencoPorte>; fatti: IndiceFatti;
  /** La classe di ogni nodo (§13.8.2, T3): le prove di ruolo di oggi e quelle del modello per cavo, coi capi dei ponti radio dati. */
  classi: (ponti: ReadonlySet<string>) => Map<string, ClasseMappa>;
}

/** `testa`: la testa confermata. Se è una VM resta fuori dalla regola del §13.7.8 (§13.16 punto 3, scelta di Riccardo: come oggi). */
export function preparaCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testa?: string | null } = {}): PreparatoCavi {
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
  // §13.7.8: sta dentro il suo hypervisor la VM ACCESA nell'ultima lettura e abbinata al nodo PER MAC. L'abbinamento di vms.ts vale
  // anche per IP, e le VM spente ci sono: un firewall fisico con l'IP di una vecchia VM spenta diventava una VM e perdeva tutti i
  // suoi cavi (revisione del Task 4). Di ogni MAC di una VM conta la lettura più recente che lo riporta (come `runningVmMacs`).
  const ultimaDelMac = new Map<string, { t: number; accesa: boolean }>();
  for (const r of ing.t1.vms) {
    const t = r.scannedAt ? parseDbDate(r.scannedAt).getTime() : 0;
    for (const raw of r.macs) {
      const m = normalizeMacForStorage(raw);
      if (!m) continue;
      const u = ultimaDelMac.get(m);
      const tt = Number.isNaN(t) ? 0 : t;
      if (!u || tt > u.t) ultimaDelMac.set(m, { t: tt, accesa: isRunning(r.status) });
      else if (tt === u.t && isRunning(r.status)) u.accesa = true;
    }
  }
  const perMac = new Set<string>();
  for (const [m, u] of ultimaDelMac) {
    const id = idx.byMac.get(m);
    if (u.accesa && typeof id === "string") perMac.add(canonical(idx, id));
  }
  const accese = new Set(t1.vms.filter((v) => v.nodeId && isRunning(v.status)).map((v) => v.nodeId));
  const vmDentro = new Map([...vmIpervisore].filter(([n]) => accese.has(n) && perMac.has(n) && n !== (opz.testa ?? null)));

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
    vmIpervisore, vmDentro, portaSalvata: portaSalvata(ing.t1), letti: new Set(ing.vicini.map((n) => `dev:${n.device_id}`)), rete, ipervisori,
  };
  return { idx, prove, ctx, elenchi, fatti, classi };
}

/**
 * §13.7.2 passo 10, §13.15 punto 4 (I56, S11): un collegamento con la SOLA prova «dalle VM» che non è il principale del suo
 * hypervisor non si disegna, nemmeno a richiesta, e sta nei dettagli dell'hypervisor. Il valore lo decide la misura del Task 0
 * del piano di T3 (riga «Decisione: dalle VM» del registro): entra se ogni collegamento «dalle VM» non principale è una
 * ridondanza che nessun'altra lettura vede. Misura del 16/10 sulle copie (hub 06:14 UTC, cliente A 06:21 UTC): sul cliente A
 * i collegamenti «dalle VM» non principali sono 2, tutti verso l'hypervisor 2 (il caso M26), visti da una VM ciascuno (uno su
 * uno switch di un'altra sede), nessuno nella mappa attesa; sull'hub 0. Decisione: entra. Costo se è sbagliata: un cavo vero
 * visto solo dalle VM sparisce dalla mappa, anche a richiesta, e resta nei dettagli dell'hypervisor («visto dalle VM anche su
 * ‹porta›»), dove si ritrova; il principale di un hypervisor e ogni collegamento che fa da padre restano sempre disegnati.
 */
export const DALLE_VM_SOLO_DETTAGLI: boolean = true;

/** Le parti del modello per cavo che non si calcolano ancora: la traccia e la pagina le dicono in una riga ciascuna (§13.11.3). */
function nonCalcolato(dalleVmSoloDettagli: boolean): readonly string[] {
  return [
    "lo stato per istanza dello spanning tree, finché le istanze non sono lette sulla forma vera (Task 3b del piano di T2)",
    "la testa quando l'unico router è una VM (§13.16, punto 3, scelta di Riccardo): una VM confermata come testa resta fuori dalla regola delle VM dentro l'hypervisor (§13.7.8), come oggi; senza testa confermata la VM non è mai la testa",
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
  /** I collegamenti «dalle VM» non principali che non si disegnano (con `DALLE_VM_SOLO_DETTAGLI`): nei dettagli dell'hypervisor.
   * Nessuno è un `albero.via`; `albero.scelto` può nominarne uno (la porta radice o l'uplink di uno switch che vede solo le VM). */
  soloDettagli: Array<{ collegamento: Collegamento; ipervisore: string; altro: string; porta: string; vm: number }>;
  /** Tutte le prove dall'ingresso, come le dà `proveDaInput` (prima delle regole): «Candidati per porta» (§13.4.6) le mostra porta
   * per porta, anche quelle che non diventano un collegamento né uno scarto (gli altri apparati sentiti sulla porta di un segmento). */
  prove: readonly Prova[];
  /**
   * I nodi dell'indice del modello per cavo, anche quelli che il modello di oggi non ha (un host che solo una prova di T3 nomina,
   * come la radio lontana trovata dal nome che annuncia): la mappa ci prende i capi dei collegamenti che le mancano (revisione
   * del Task 7 di T3).
   */
  nodiIndice: ReadonlyMap<string, MapNode>;
  /**
   * §13.7.8, ultimo punto (criterio C della misura del 16/10): le VM che stanno dentro il loro hypervisor (accese, abbinate per MAC,
   * non la testa confermata) e che nella mappa nuova non hanno collegamenti: VM → hypervisor. Nella pagina sono VM del riquadro
   * dell'hypervisor, come le VM senza collegamenti propri di oggi; la traccia le mette sotto di lui. Anche con collegamenti propri
   * nella mappa di oggi (vicini, una tabella MAC sua), che qui sono «stessa rete».
   */
  dentro: ReadonlyMap<string, string>;
}

const macDel = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toLowerCase() : null);

export function costruisciModelloCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testaScelta: string | null; dalleVmSoloDettagli?: boolean }): ModelloCavi {
  const testaConfermata = opz.testaScelta ?? t1.sites.find((s) => s.headNodeId !== null && !s.headProposed)?.headNodeId ?? null;
  const p = preparaCavi(ing, t1, { testa: testaConfermata });
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
  // La porta radice è una porta come le altre (§13.6.1): il traduttore del lettore che l'ha scritta, poi la chiave con l'elenco
  // delle porte del nodo. Un bridge letto via SNMP la scrive col nome dell'interfaccia (`snmp-topologia.ts:192`), mentre
  // l'altro capo del cavo può annunciarla col solo numero (`lldpRemPortId`): il nome solo non trovava il cavo (G16, C).
  const portaRadice = new Map<string, Pick<Porta, "chiave" | "nome"> | typeof RADICE>();
  const come = comeDi(ing.t1);
  for (const b of [...ing.fattiBridge].sort((x, y) => x.device_id - y.device_id || (x.bridge_name < y.bridge_name ? -1 : 1))) {
    const nodo = `dev:${b.device_id}`;
    if (b.instance !== 0 || lettoreDellaFonte(b.source) === "controller" || b.root_id === null || portaRadice.has(nodo)) continue;
    if (b.root_port !== null) {
      const letta = traduciPorta(b.root_port, "locale", come(nodo, b.source, null));
      portaRadice.set(nodo, { nome: b.root_port, chiave: chiavePorta(nodo, letta, "locale", p.elenchi.get(nodo)).chiave });
    } else if (b.bridge_id !== null && macDel(b.root_id) === macDel(b.bridge_id)) portaRadice.set(nodo, RADICE);
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
  // Le ★ con gli id canonici (come `enrichLinks` del modello di oggi) e, per un segmento, l'id di oggi del segmento che contiene
  // ancora il membro salvato (§13.7.3); le porte restano come scritte e si confrontano per chiave (`risolviStelle`).
  const alias = aliasDeiSegmenti(segmenti);
  const idDi = (id: string): string => alias.get(id) ?? canonical(p.idx, id);
  const primari = ing.t1.primaries.map((x) => ({ node_id: idDi(x.node_id), other_node: idDi(x.other_node), node_port: x.node_port, other_port: x.other_port }));
  // I ruoli «Core» e «Accesso» scritti a mano (§13.9): solo per l'anomalia del punto 8; la classe li legge «rete» (ruoloLetto).
  const ruoli = new Map(ing.t1.devices.flatMap((d) => { const r = ruoloRete(d.topology_role); return r ? [[`dev:${d.id}`, r] as const] : []; }));
  const albero = alberoCavi({
    nodi, visibili, collegamenti, testaConfermata, portaRadice, portaUplink, gateway, gatewayDi: t1.gatewayDi ?? {},
    primari, portaSalvata: p.ctx.portaSalvata, ipervisori, ruoli, ponti,
  });

  // §13.7.2 passo 10, §13.15 punto 4 (I56, S11): un collegamento con la SOLA prova «dalle VM» che non è il principale del suo
  // hypervisor non si disegna, nemmeno a richiesta: sta nei dettagli dell'hypervisor. Si toglie dopo l'albero, e resta ogni
  // collegamento che fa da padre a qualcuno (il principale dell'hypervisor, anche con una VM sola; e il padre di uno switch se
  // l'hypervisor non è una foglia: `ipervisori` prende l'hypervisor di ogni VM, di qualunque classe). Così l'albero non cambia.
  // `albero.scelto` può nominare un collegamento finito qui (la porta radice o l'uplink di uno switch dove si vedono solo le VM):
  // chi lo legge lo cerca anche in `soloDettagli` (revisione del Task 4).
  const dalleVm = opz.dalleVmSoloDettagli ?? DALLE_VM_SOLO_DETTAGLI;
  const padri = new Set([...albero.via.values()].map((c) => c.id));
  const soloDettagli: ModelloCavi["soloDettagli"] = [];
  const disegnati = !dalleVm ? collegamenti : collegamenti.filter((c) => {
    if (c.prove.length === 0 || !c.prove.every((q) => q.classe === "vm") || padri.has(c.id)) return true;
    const h = ipervisori.has(c.a.nodo) ? c.a : ipervisori.has(c.b.nodo) ? c.b : null;
    if (h === null) return true;
    const sw = h === c.a ? c.b : c.a;
    soloDettagli.push({ collegamento: c, ipervisore: h.nodo, altro: sw.nodo, porta: sw.nome, vm: c.vm ?? 0 });
    return false;
  });
  const conLinea = new Set(disegnati.flatMap((c) => [c.a.nodo, c.b.nodo]));
  const dentro = new Map([...p.ctx.vmDentro].filter(([vm]) => !conLinea.has(vm)).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return {
    collegamenti: disegnati, segmenti, albero, dentro, correzioniOrfane, schema: ing.schema, nonCalcolato: nonCalcolato(dalleVm), classi, ponti,
    stessaRete: r.stessaRete, oltre: r.oltre, scartateBordo: r.scartateBordo, scartateVm: r.scartateVm, soloDettagli, prove: p.prove,
    nodiIndice: p.idx.nodes,
  };
}
