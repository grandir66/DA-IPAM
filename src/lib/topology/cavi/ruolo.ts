/**
 * Il ruolo dalle prove (spec topologia §13.8.2, D6): un oggetto fa da switch, router o access point nell'albero solo se
 * ha almeno una prova SUA. Il tipo dichiarato e la classificazione automatica non bastano: sull'hub 19 PC e server
 * (spec §13.1 punto 12) registrati come «switch» per l'inventario, sei nell'albero, e la promessa della spec §8 («la
 * mappa li mette in Da sistemare») non era mantenuta (vincolo 7 di Riccardo, 14/10). Alle quattro prove di D6 Riccardo
 * ne ha aggiunte sei e il ruolo a mano (14/10 sera). Logica pura, senza nomi di prodotto (prova I37).
 */
import { nodeClass, type NodeClass } from "@/lib/topology/identity";
import { righeUltimoGiro } from "@/lib/topology/links";
import type { MapVm, TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, nameKey, type NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage } from "@/lib/utils";

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

/**
 * Il ruolo a mano come lo legge T1b: «rete» e «attaccato»; «core» e «accesso», che scriverà T3 (spec §13.9), valgono
 * «rete» (una versione successiva li ha scritti e si è tornati indietro: Review Focus 7); ogni altro valore, o vuoto,
 * decide il sistema.
 */
export function ruoloLetto(v: string | null | undefined): "rete" | "attaccato" | null {
  const r = (v ?? "").trim();
  return r === "rete" || r === "core" || r === "accesso" ? "rete" : r === "attaccato" ? "attaccato" : null;
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
  for (const r of input.macPorts) {
    const io = `dev:${r.device_id}`;
    const altro = chiDi(idx, { mac: r.mac });
    const k = altro && altro !== io ? classeDi(idx, altro) : null;
    if (k === "infra" || k === "ap") metti(io, "mac_dietro");
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
