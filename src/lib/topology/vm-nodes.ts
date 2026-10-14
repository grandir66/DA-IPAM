/**
 * Le VM nella pagina (spec §11.5): il riepilogo sul riquadro dell'hypervisor
 * («N VM, M accese»), la scritta di una VM nel riquadro espanso, e la VM come
 * oggetto di una mappa passo passo. Una VM che è già un oggetto censito (stesso
 * MAC o nome, `MapVm.nodeId`) entra nella mappa come quell'oggetto; le altre
 * entrano col loro id «vm:<apparato>:<vmid>» come nodo della pagina, appeso al
 * suo hypervisor nella fascia degli attaccati. Logica pura.
 */
import { CHAR_W } from "@/lib/topology/tree-layout";
import type { MapNode, MapVm, TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";

/**
 * Revisione finale I-1: una VM non censita è un nodo della pagina, non un capo di collegamento del
 * modello. Un collegamento a mano o un principale verso di lei si salverebbe senza mai comparire: le
 * rotte lo rifiutano con queste parole, e la pagina non lo propone.
 */
export const VM_NON_COLLEGABILE =
  "Una VM non censita non si collega a mano: collega l'host o l'apparato che la rappresenta, oppure il suo hypervisor";

export function isRunning(status: string): boolean {
  return status.trim().toLowerCase() === "running";
}

export function vmSummary(vms: readonly Pick<MapVm, "status">[]): { total: number; running: number; label: string } {
  const running = vms.filter((v) => isRunning(v.status)).length;
  return { total: vms.length, running, label: `${vms.length} VM, ${running} ${running === 1 ? "accesa" : "accese"}` };
}

/** «▶ nome · IP» (■ se spenta): l'IP solo se ci sta; il nome accorciato con «…» se serve. Margine di 12 px. */
export function vmChipText(vm: Pick<MapVm, "name" | "status" | "ips">, widthPx: number): string {
  const max = Math.max(4, Math.floor((widthPx - 12) / CHAR_W));
  const head = `${isRunning(vm.status) ? "▶" : "■"} `;
  const withIp = vm.ips[0] ? `${head}${vm.name} · ${vm.ips[0]}` : null;
  if (withIp && withIp.length <= max) return withIp;
  const plain = `${head}${vm.name}`;
  return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}

/**
 * I nodi della pagina per le VM che non sono oggetti censiti e hanno il loro hypervisor; `canonical`
 * porta l'id «vm:…» di una VM censita sul suo nodo (una mappa che l'ha salvata la ritrova);
 * `parentOf` dice a quale hypervisor appendere ogni VM.
 */
export function vmNodes(model: Pick<TopologyModel, "vms">): {
  nodes: MapNode[];
  canonical: Record<string, string>;
  parentOf: Map<string, string>;
} {
  const nodes: MapNode[] = [];
  const canonical: Record<string, string> = {};
  const parentOf = new Map<string, string>();
  for (const v of [...model.vms].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (v.nodeId) { canonical[v.id] = v.nodeId; continue; }
    if (!v.hypervisorNodeId) continue;
    parentOf.set(v.id, v.hypervisorNodeId);
    nodes.push({
      id: v.id, kind: "host", refId: 0, name: v.name, type: "vm", mgmtIp: v.ips[0] ?? null, fusedHostIds: [],
      addresses: v.ips.map((ip) => ({ ip, virtual: false, hostId: null })), aliases: [], siteId: null, rackId: null,
      siteProposed: false, hidden: false, vendor: null,
    });
  }
  return { nodes, canonical, parentOf };
}

/** Le VM che l'albero ha lasciato come radici staccate si appendono al loro hypervisor, se è nell'albero. */
export function hangVmNodes(tree: TreeResult, parentOf: ReadonlyMap<string, string>): TreeResult {
  const children = new Map([...tree.children].map(([k, v]) => [k, [...v]]));
  const roots: string[] = [];
  for (const r of tree.roots) {
    const parent = parentOf.get(r);
    if (parent && children.has(parent) && (children.get(r)?.length ?? 0) === 0) children.get(parent)!.push(r);
    else roots.push(r);
  }
  return { ...tree, roots, children };
}
