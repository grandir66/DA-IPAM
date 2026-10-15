/**
 * Le voci dei menu del tasto destro della mappa (spec §11.2) e i dati che
 * servono alle loro azioni: quale nodo riceve «★ Rendi principale», quale
 * correzione a mano sta dietro una linea, quali collegati si possono
 * aggiungere, quali apparati rileggere per «Aggiorna VM». Logica pura: la
 * pagina disegna le voci, qui si decide quali e con che parole.
 */
import { nodeClass } from "@/lib/topology/identity";
import type { LinkOverrideRow, MapLink, MapVm, TopologyModel } from "@/lib/topology/model-types";
import { missingNeighbors, type TreeResult } from "@/lib/topology/tree";
import { SEGMENTO_NON_COLLEGABILE, VM_NON_COLLEGABILE } from "@/lib/topology/vm-nodes";

export interface NodeMenuCtx {
  mode: "auto" | "passo";
  isAdmin: boolean;
  /** Passo passo, admin, con una mappa scelta. */
  canEditMap: boolean;
  /** L'oggetto è nella mappa che si guarda. */
  inMap: boolean;
  isHead: boolean;
  isStart: boolean;
  /** Apparato censito (dev:N): solo questi si nascondono. */
  isDevice: boolean;
  hidden: boolean;
  isHypervisor: boolean;
  vmCount: number;
  /** Le VM dell'hypervisor sono mostrate. */
  expanded: boolean;
  /** C'è almeno un apparato con la scansione Proxmox da rileggere. */
  canRefreshVms: boolean;
  /** Host che è infrastruttura: si può promuovere ad apparato. */
  infraHost: boolean;
  /** Collegati non ancora nella mappa (per «Aggiungi collegati ▸»). */
  addableCount: number;
  /** VM non censita (`vm:N:M`): non si collega a mano (revisione finale I-1). */
  isUncensusedVm: boolean;
  /** Il ruolo nella mappa di un apparato ('' = decide il sistema); null per un host o una VM (T1b, spec §13.8.2). */
  ruolo: RuoloMappa | null;
}

/** Una VM non censita: un nodo della pagina, non un capo di collegamento del modello. */
export const isUncensusedVmId = (id: string): boolean => id.startsWith("vm:");

/** Un segmento (T3, spec §13.7.3): un nodo calcolato, solo con la mappa nuova accesa. */
const isSegmentoId = (id: string): boolean => id.startsWith("seg:");

/**
 * «Collega a…» fra due oggetti: null se si può, altrimenti il motivo in parole. Una VM non censita
 * non è un capo di collegamento: la rotta la rifiuterebbe (revisione finale I-1). Nemmeno un segmento
 * (T3, §13.7.3): si collegano gli apparati che ne fanno parte.
 */
export function connectRefusal(a: string, b: string): string | null {
  if (isUncensusedVmId(a) || isUncensusedVmId(b)) return VM_NON_COLLEGABILE;
  return isSegmentoId(a) || isSegmentoId(b) ? SEGMENTO_NON_COLLEGABILE : null;
}

export type NodeMenuKey =
  | "details" | "toggleVms" | "refreshVms" | "connect" | "addLinked" | "start" | "head" | "remove" | "role" | "hide" | "promote";

export interface MenuItem<K extends string> {
  key: K;
  label: string;
  /** Voce che dice uno stato («▶ è una partenza»): si vede, non si clicca. */
  disabled?: boolean;
}

/** Le voci del tasto destro su un oggetto, nell'ordine della spec §11.2; ognuna solo dove ha senso. */
export function nodeMenuItems(c: NodeMenuCtx): Array<MenuItem<NodeMenuKey>> {
  const out: Array<MenuItem<NodeMenuKey>> = [{ key: "details", label: "Dettagli" }];
  const passo = c.mode === "passo" && c.canEditMap;
  if (c.isHypervisor && c.vmCount > 0) out.push({ key: "toggleVms", label: c.expanded ? "Nascondi VM" : `Mostra VM (${c.vmCount})` });
  if (c.isAdmin && c.isHypervisor && c.canRefreshVms) out.push({ key: "refreshVms", label: "Aggiorna VM" });
  if (c.isAdmin && !c.isUncensusedVm) out.push({ key: "connect", label: "Collega a…" });
  if (passo && c.addableCount > 0) out.push({ key: "addLinked", label: `Aggiungi collegati (${c.addableCount})` });
  if (passo && c.inMap) out.push(c.isStart ? { key: "start", label: "▶ è una partenza", disabled: true } : { key: "start", label: "Usa come partenza" });
  if (c.mode === "auto" && c.isAdmin) out.push(c.isHead ? { key: "head", label: "● è la testa", disabled: true } : { key: "head", label: "Usa come testa" });
  if (passo && c.inMap) out.push({ key: "remove", label: "Togli dalla mappa" });
  if (c.isAdmin && c.isDevice && c.ruolo !== null) out.push({ key: "role", label: "Ruolo nella mappa" });
  else if (c.isAdmin && c.infraHost) out.push({ key: "role", label: "Ruolo nella mappa: prima Promuovi ad apparato", disabled: true });
  if (c.isAdmin && c.isDevice) out.push({ key: "hide", label: c.hidden ? "Rimostra in tutte le mappe" : "Nascondi da tutte le mappe" });
  if (c.isAdmin && c.infraHost) out.push({ key: "promote", label: "Promuovi ad apparato" });
  return out;
}

export type RuoloMappa = "" | "rete" | "attaccato";

/** Le voci di «Ruolo nella mappa ▸» nell'ordine della spec §13.8.2; quella di adesso porta «✓» (il segno è testo, non colore). */
export function ruoloVoci(attuale: RuoloMappa): Array<{ value: RuoloMappa; label: string }> {
  const voci: Array<[RuoloMappa, string]> = [["rete", "Apparato di rete"], ["attaccato", "Attaccato (server, PC)"], ["", "Decide il sistema"]];
  return voci.map(([value, label]) => ({ value, label: value === attuale ? `✓ ${label}` : label }));
}

export type EdgeMenuKey = "editPorts" | "primary" | "unprimary" | "remove" | "ignore";

/** Le voci del tasto destro su una linea (solo admin: tutte scrivono). */
export function edgeMenuItems(l: MapLink, isAdmin: boolean): Array<MenuItem<EdgeMenuKey>> {
  if (!isAdmin) return [];
  const manual = l.sources.includes("manual");
  const out: Array<MenuItem<EdgeMenuKey>> = [];
  if (manual) out.push({ key: "editPorts", label: "Modifica porte…" });
  // Una linea verso una VM non censita non ha un principale da scegliere: la rotta lo rifiuterebbe (I-1). Verso un
  // segmento sì (T3, §13.7.3: la rotta della ★ accetta «seg:»), anche se «Collega a…» lo rifiuta: qui solo la VM.
  if (isUncensusedVmId(l.a) || isUncensusedVmId(l.b)) {
    /* niente voce del principale */
  } else if (l.primary === "user") out.push({ key: "unprimary", label: "Togli la scelta del principale" });
  else out.push({ key: "primary", label: l.primary === "auto" ? "★ Fissa come principale" : "★ Rendi principale" });
  // In T1 una linea è una coppia: «Ignora questo cavo…» per tutte (spec §13.9). Da T3 la parola segue il genere (cavo, tunnel, fascio…).
  out.push(manual ? { key: "remove", label: "Rimuovi il collegamento a mano" } : { key: "ignore", label: "Ignora questo cavo…" });
  return out;
}

export interface PrimaryBody {
  node_id: string;
  other_node: string;
  node_port: string;
  other_port: string;
}

/**
 * Per quale oggetto la linea diventa il principale: quello che c'è già scritto,
 * altrimenti il capo più in basso nell'albero (il figlio), a pari profondità il
 * secondo capo. Le porte seguono: prima quella dell'oggetto, poi quella dell'altro.
 */
export function primaryTarget(l: MapLink, tree: TreeResult): PrimaryBody {
  let child = l.primaryFor;
  if (child !== l.a && child !== l.b) {
    const depth = new Map<string, number>();
    const q: Array<[string, number]> = tree.roots.map((r) => [r, 0]);
    for (const [r] of q) depth.set(r, 0);
    for (let i = 0; i < q.length; i++) {
      const [id, d] = q[i];
      for (const k of tree.children.get(id) ?? []) if (!depth.has(k)) { depth.set(k, d + 1); q.push([k, d + 1]); }
    }
    const da = depth.get(l.a) ?? -1, db = depth.get(l.b) ?? -1;
    child = da > db ? l.a : l.b;
  }
  return child === l.a
    ? { node_id: l.a, other_node: l.b, node_port: l.aPort, other_port: l.bPort }
    : { node_id: l.b, other_node: l.a, node_port: l.bPort, other_port: l.aPort };
}

/** La correzione «add» dietro una linea a mano: stessa coppia di nodi (per id canonico), la più recente. */
export function findManualOverride<T extends Pick<LinkOverrideRow, "id" | "action" | "a_node" | "b_node">>(
  rows: readonly T[], l: Pick<MapLink, "a" | "b">, canonical: Readonly<Record<string, string>>,
): T | null {
  const canon = (id: string) => canonical[id] ?? id;
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const want = pair(l.a, l.b);
  let best: T | null = null;
  for (const r of rows) {
    if (r.action !== "add" || pair(canon(r.a_node), canon(r.b_node)) !== want) continue;
    if (!best || r.id > best.id) best = r;
  }
  return best;
}

export interface AddableLinked {
  id: string;
  name: string;
  type: string;
  /** Spuntato all'apertura: gli apparati sì, gli host no (come «Aggiungi tutti gli apparati collegati»). */
  checked: boolean;
}

/** I collegati non ancora nella mappa, niente client, per «Aggiungi collegati ▸»; ordine per nome. */
export function addableLinked(model: TopologyModel, nodeId: string, visible: ReadonlySet<string>): AddableLinked[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const ids = [...new Set(missingNeighbors(model, nodeId, visible).map((l) => (l.a === nodeId ? l.b : l.a)))];
  return ids
    .map((id) => byId.get(id)!)
    .filter((n) => !!n && nodeClass(n) !== "client")
    .sort((a, b) => a.name.localeCompare(b.name, "it") || (a.id < b.id ? -1 : 1))
    .map((n) => ({ id: n.id, name: n.name, type: n.type, checked: n.kind === "device" }));
}

/** Gli apparati da rileggere per «Aggiorna VM»: chi ha letto le VM di quell'hypervisor; senza VM, l'apparato stesso. */
export function refreshVmDeviceIds(vms: readonly MapVm[], hypervisorNodeId: string): number[] {
  const ids = new Set<number>();
  for (const v of vms) {
    if (v.hypervisorNodeId !== hypervisorNodeId) continue;
    const m = /^vm:(\d+):/.exec(v.id);
    if (m) ids.add(Number(m[1]));
  }
  if (ids.size === 0) {
    const m = /^dev:(\d+)$/.exec(hypervisorNodeId);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

export type VmMenuKey = "add" | "details";

/** Il tasto destro su una VM dell'hypervisor espanso (spec §11.5): aggiungerla alla mappa passo passo, vederne i dettagli. */
export function vmMenuItems(c: { canEditMap: boolean; inMap: boolean }): Array<MenuItem<VmMenuKey>> {
  const out: Array<MenuItem<VmMenuKey>> = [];
  if (c.canEditMap) out.push(c.inMap ? { key: "add", label: "✓ nella mappa", disabled: true } : { key: "add", label: "Aggiungi alla mappa" });
  out.push({ key: "details", label: "Dettagli" });
  return out;
}
