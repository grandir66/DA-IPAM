/**
 * Il ruolo dalle prove (spec topologia §13.8.2, D6): un oggetto fa da switch, router o access point nell'albero solo se
 * ha almeno una prova SUA. Il tipo dichiarato e la classificazione automatica non bastano: sull'hub 19 PC e server
 * (spec §13.1 punto 12) registrati come «switch» per l'inventario, sei nell'albero, e la promessa della spec §8 («la
 * mappa li mette in Da sistemare») non era mantenuta (vincolo 7 di Riccardo, 14/10). Alle quattro prove di D6 Riccardo
 * ne ha aggiunte sei e il ruolo a mano (14/10 sera). Logica pura, senza nomi di prodotto (prova I37).
 */
import { nodeClass, ruoloLetto, type NodeClass } from "@/lib/topology/identity";
import { eReteDalleCapacita, lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { righeUltimoGiro } from "@/lib/topology/links";
import type { ClasseMappa, MapNode, MapVm, TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, nameKey, type NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage } from "@/lib/utils";
import { normale } from "./porte";
import type { IndiceFatti, IngressoCavi, Prova } from "./prove";

/** Il ruolo a mano come lo legge T1b: sta in identity.ts perché serve anche al nodo (node-index.ts). */
export { ruoloLetto };

export type ProvaRuolo = "vicini" | "spanning_tree" | "mac_dietro" | "vm" | "scansione" | "uplink" | "controller" | "padre_di" | "annuncio" | "radio" | "capacita" | "a_mano";

/** Gli stati dello spanning tree che dicono che l'apparato lo parla (spec §13.8.2, I65): non `disabled`, non `broken`. */
const STP_ATTIVO: ReadonlySet<string> = new Set(["forwarding", "learning", "listening", "blocking", "discarding"]);

/** Le prove aggiunte il 14/10 sera (§13.15): nell'elenco per nome si segnano a parte gli oggetti tenuti solo da loro. */
export const PROVE_AGGIUNTE: ReadonlySet<ProvaRuolo> = new Set<ProvaRuolo>(["uplink", "controller", "padre_di", "annuncio", "radio", "capacita"]);

/** Come resolveNode (node-index.ts), ma senza creare il nodo di un host: le prove non cambiano i nodi del modello. */
function chiDi(idx: NodeIndex, ref: { ip?: string | null; mac?: string | null; name?: string | null }): string | null {
  const mac = normalizeMacForStorage(ref.mac ?? null);
  const k = nameKey(ref.name);
  for (const c of [ref.ip ? idx.byIp.get(ref.ip) : undefined, mac ? idx.byMac.get(mac) : undefined, k ? idx.byName.get(k) : undefined]) {
    if (typeof c === "string") return canonical(idx, c);
  }
  return null;
}

/** La classe di un nodo, anche se il suo host non è ancora un nodo (le prove si calcolano prima di attaccare i MAC). */
function classeDi(idx: NodeIndex, id: string): NodeClass | null {
  const n = idx.nodes.get(id);
  if (n) return nodeClass(n);
  const m = /^host:(\d+)$/.exec(id);
  const h = m ? idx.hostById.get(Number(m[1])) : undefined;
  return h ? nodeClass({ type: h.classification || "unknown" }) : null;
}

export function proveDiRuolo(input: TopologyModelInput, idx: NodeIndex,
  extra: { vms?: readonly MapVm[]; capiRadio?: ReadonlySet<string>; scansioni?: ReadonlySet<string> } = {}): Map<string, ProvaRuolo[]> {
  const prove = new Map<string, Set<ProvaRuolo>>();
  const metti = (id: string | null | undefined, p: ProvaRuolo): void => {
    if (!id) return;
    const s = prove.get(id);
    if (s) s.add(p);
    else prove.set(id, new Set([p]));
  };
  // Legge vicini: lo interroghiamo come apparato di rete.
  for (const n of input.neighbors) metti(`dev:${n.device_id}`, "vicini");
  // Ha porte con uno stato di spanning tree ATTIVO (la lettura di oggi; nel modello per cavo i fatti per porta e i BPDU
  // ricevuti): inoltra, impara o è bloccata, su una porta accesa (I65). `disabled` vuol dire spanning tree spento (gli switch
  // senza spanning tree della rete B: uplink acceso e `disabled`), e su una porta giù ogni stato vale «giù» (G12).
  for (const p of input.ports ?? []) {
    const giu = ["down", "disabled"].includes((p.status ?? "").trim().toLowerCase());
    if (STP_ATTIVO.has((p.stp_state ?? "").trim().toLowerCase()) && !giu) metti(`dev:${p.device_id}`, "spanning_tree");
  }
  // La sua tabella MAC vede altri apparati di rete dietro una porta.
  // Chi è un MAC si cerca una volta sola: sul cliente A 2.637 righe per poche centinaia di MAC (tetto del modello, C17).
  const diChi = new Map<string, string | null>();
  for (const r of input.macPorts) {
    const io = `dev:${r.device_id}`;
    let altro = diChi.get(r.mac);
    if (altro === undefined) {
      const id = chiDi(idx, { mac: r.mac });
      const k = id ? classeDi(idx, id) : null;
      altro = k === "infra" || k === "ap" ? id : null;
      diChi.set(r.mac, altro);
    }
    if (altro && altro !== io) metti(io, "mac_dietro");
  }
  // Ospita VM (allora è un hypervisor).
  for (const v of extra.vms ?? []) metti(v.hypervisorNodeId, "vm");
  // oppure è un hypervisor censito e letto (la scansione delle sue VM, passata dal modello: il nome del prodotto qui non
  // si scrive, prova I37).
  for (const id of extra.scansioni ?? []) metti(id, "scansione");
  // Le sei aggiunte: porta di uplink secondo il controller; gestito da un controller; padre di un altro apparato.
  for (const u of input.uplinkPorts) metti(`dev:${u.device_id}`, "uplink");
  for (const d of input.devices) {
    if (d.controller_mac) metti(`dev:${d.id}`, "controller");
    if (d.uplink_mac) metti(chiDi(idx, { mac: d.uplink_mac }), "padre_di");
    if (ruoloLetto(d.topology_role) === "rete") metti(`dev:${d.id}`, "a_mano");
  }
  // Si annuncia come apparato, contando solo le righe che passano R-superata: gli annunci di rete (non LLDP).
  for (const n of righeUltimoGiro(input)) {
    if (n.protocol === "lldp" || n.protocol === "unknown") continue;
    const chi = chiDi(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (chi && chi !== `dev:${n.device_id}`) metti(chi, "annuncio");
  }
  // Capo di un salto radio: lo dicono i collegamenti di genere «radio» del modello per cavo (T3).
  for (const id of extra.capiRadio ?? []) metti(id, "radio");
  return new Map([...prove].map(([k, s]) => [k, [...s].sort()]));
}

/**
 * La classe nella mappa: quella di nodeClass (identity.ts:52-60), ma «infra» e «ap» solo con una prova. Il ruolo a mano
 * decide prima di tutto: «Attaccato (server, PC)» fa foglia, «Apparato di rete» tiene nell'albero. Il tipo del nodo è
 * quello che chiede nodeClass, preso da lì: scritto qui nominerebbe un prodotto (prova I37). E «hyper» solo per chi ospita
 * VM o è un hypervisor censito e letto: altrimenti «att».
 */
export function classeInMappa(n: Parameters<typeof nodeClass>[0], prove: readonly ProvaRuolo[] | undefined,
  ruoloAMano: "rete" | "attaccato" | null): NodeClass | "da_sistemare" {
  const nominale = nodeClass(n);
  // «hyper» solo con una prova (spec §13.8.2, G10, I65): ospita VM, o è un hypervisor censito e letto (una scansione). La
  // classificazione da sola no: sulla rete B un nodo «hypervisor» fatto di host fusi su un MAC resta dov'è, come attaccato.
  const base = nominale === "hyper" && !(prove ?? []).some((p) => p === "vm" || p === "scansione") ? "att" : nominale;
  if (ruoloAMano === "attaccato") return base === "hyper" ? "hyper" : "att";
  if (ruoloAMano === "rete") return base === "ap" ? "ap" : "infra";
  if (base !== "infra" && base !== "ap") return base;
  return (prove?.length ?? 0) > 0 ? base : "da_sistemare";
}

/**
 * Le prove di ruolo che vede solo il modello per cavo (spec §13.8.2, «Una prova che in T1b non c'è ancora»): lo spanning tree
 * dai fatti per porta e dai BPDU che un apparato letto riceve da chi sta sull'altro capo, le capacità annunciate col nome di
 * sistema, il capo di un ponte radio (§13.7.6 punto 4), e «legge vicini» coi lettori che il modello di oggi non legge. Si
 * aggiungono a quelle di oggi (proveDiRuolo). Sull'hub lo switch di storage, che non legge vicini e che nessun controller
 * gestisce, torna fra gli apparati di rete coi BPDU che manda al router.
 */
export function proveDiRuoloCavi(ing: Pick<IngressoCavi, "fattiPorta" | "vicini">, prove: readonly Prova[], fatti: IndiceFatti,
  capiRadio: ReadonlySet<string>, nominale: (id: string) => NodeClass | null): Map<string, ProvaRuolo[]> {
  const out = new Map<string, Set<ProvaRuolo>>();
  const metti = (id: string | null | undefined, p: ProvaRuolo): void => {
    if (id) out.set(id, (out.get(id) ?? new Set<ProvaRuolo>()).add(p));
  };
  // Legge vicini (la prova di oggi, `device_neighbors.device_id`) anche coi lettori che solo il modello per cavo legge (SNMP, da
  // T2): lo interroghiamo come apparato di rete. Non la lettura dal lato dell'host: è un hypervisor letto come host, e un
  // server registrato switch tornerebbe nell'albero senza prove sue (decisione del Task 3 di T3).
  for (const n of ing.vicini) if (lettoreDellaFonte(n.source) !== "host") metti(`dev:${n.device_id}`, "vicini");
  // Le porte dell'apparato con uno stato di spanning tree attivo, su una porta accesa (I65: `disabled` e `broken` no).
  for (const f of ing.fattiPorta) {
    if (f.running === 0) continue;
    if (STP_ATTIVO.has((f.stp_state ?? "").trim().toLowerCase())) metti(`dev:${f.device_id}`, "spanning_tree");
  }
  // Gli apparati sentiti con un annuncio di collegamento su ogni porta, contati per apparato (§13.7.6 punto 1: una porta, un
  // cavo; gli annunci di segmento non contano).
  const portaDi = (p: Prova): string => `${p.da.nodo}|${p.da.chiave ?? `?${normale(p.da.nome)}`}`;
  const collegamento = prove.filter((p) => p.classe === "annuncio_collegamento" && p.altro?.nodo !== p.da.nodo);
  const sentiti = new Map<string, Set<string>>();
  for (const p of collegamento) sentiti.set(portaDi(p), (sentiti.get(portaDi(p)) ?? new Set<string>()).add(p.altro?.nodo ?? p.telaio ?? "?"));
  for (const p of collegamento) {
    if (!p.altro) continue;
    // I BPDU che l'osservatore riceve sulla porta che vede l'altro: l'altro parla lo spanning tree. Solo se la porta sente lui
    // solo: su una porta che sente due apparati (un hub, uno switch non gestito) non si sa chi li manda (decisione del Task 3
    // di T3: «da lui», §13.8.2).
    const bpdu = fatti.porta(p.da.nodo, p.da).some((f) => (f.bpdu_rx ?? 0) > 0 && f.running !== 0);
    if (bpdu && sentiti.get(portaDi(p))?.size === 1) metti(p.altro.nodo, "spanning_tree");
    // Capacità annunciate: solo con il nome di sistema, mai per un server o un hypervisor noto (un server con un bridge e
    // l'inoltro acceso annuncia «bridge, router»; l'LLDP del firmware delle schede annuncia senza nome).
    const k = nominale(p.altro.nodo);
    if (p.conNome === true && eReteDalleCapacita(p.capacita ?? null) && k !== "att" && k !== "hyper") metti(p.altro.nodo, "capacita");
  }
  for (const id of capiRadio) metti(id, "radio");
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

/**
 * La classe di ogni nodo nel modello per cavo: classeInMappa con le prove di oggi più quelle di T3; un capo di un ponte radio
 * non è mai «client» né «da sistemare» (diventa «att»: sta sulla linea, §13.7.6 punto 4; fare da ponte nell'albero lo decide
 * l'albero con `ponti`). Restituisce la classe di tutti i nodi dati, non solo di quelli che cambiano. Il tipo del nodo è
 * quello che chiede nodeClass, preso da lì (come in classeInMappa: scritto qui nominerebbe un prodotto, prova I37).
 */
export function classiCavi(nodi: Iterable<Parameters<typeof nodeClass>[0] & Pick<MapNode, "id">>,
  prove: ReadonlyMap<string, readonly ProvaRuolo[]>, ruoloAMano: (id: string) => "rete" | "attaccato" | null,
  ponti: ReadonlySet<string>): Map<string, ClasseMappa> {
  const out = new Map<string, ClasseMappa>();
  for (const n of nodi) {
    const k = classeInMappa(n, prove.get(n.id), ruoloAMano(n.id));
    out.set(n.id, ponti.has(n.id) && (k === "client" || k === "da_sistemare") ? "att" : k);
  }
  return out;
}
