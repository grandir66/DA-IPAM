/**
 * Le macchine virtuali nella tavola (Riccardo, 24/11: «si potrebbero mettere sotto al proxmox che li contiene non come
 * oggetti separati che sono irriconducibili ad un cablaggio»). Una VM non ha porte né cavi: sta dentro il telaio del suo
 * hypervisor. Chi è VM e di chi lo dice il modello della mappa (`model.vms`); in più, un apparato i cui MAC sono tutti da VM
 * è una VM anche se nessuna lettura dice dove gira (più hypervisor: non si indovina). Logica pura.
 */
import type { MapNode, MapVm } from "@/lib/topology/model-types";
import { isRunning } from "@/lib/topology/vm-nodes";
import type { VmComposta } from "./tipi";

const IPERVISORE = /proxmox|vmware|esxi|hyper-?v/i;

/** Gli apparati con solo MAC da VM che il modello non conosce come VM né come hypervisor. */
export function vmDaiMac(nodi: readonly MapNode[], vms: readonly MapVm[], macDiHost: ReadonlyMap<number, string>, macDiVm: (m: string) => boolean): MapVm[] {
  const noti = new Set(vms.flatMap((v) => [v.nodeId, v.hypervisorNodeId]));
  return nodi.flatMap((n): MapVm[] => {
    if (n.kind !== "device" || noti.has(n.id) || n.proxmoxScan || n.type.toLowerCase() === "hypervisor" || IPERVISORE.test(n.vendor ?? "")) return [];
    const mac = n.fusedHostIds.flatMap((h) => macDiHost.get(h) ?? []);
    if (mac.length === 0 || !mac.every(macDiVm)) return [];
    return [{ id: `vm:${n.id}`, name: n.name, status: "", ips: n.mgmtIp ? [n.mgmtIp] : [], hypervisorNodeId: null, nodeId: n.id, scannedAt: null }];
  });
}

/** Le VM che riguardano i nodi della tavola. */
export function vmDeiNodi(nodi: readonly MapNode[], vms: readonly MapVm[]): MapVm[] {
  const ids = new Set(nodi.map((n) => n.id));
  return vms.filter((v) => (v.hypervisorNodeId !== null && ids.has(v.hypervisorNodeId)) || (v.nodeId !== null && ids.has(v.nodeId)));
}

/** Nodo VM → il suo hypervisor fisico (un hypervisor dentro una VM sale fino al ferro); null = non noto. */
export function ferroDelleVm(vms: readonly MapVm[]): Map<string, string | null> {
  const diretto = new Map<string, string | null>();
  for (const v of vms) if (v.nodeId !== null && v.nodeId !== v.hypervisorNodeId && (diretto.get(v.nodeId) ?? null) === null) diretto.set(v.nodeId, v.hypervisorNodeId);
  const sali = (id: string): string | null => {
    const visti = new Set<string>();
    let cur: string | null = id;
    while (cur !== null && diretto.has(cur)) {
      if (visti.has(cur)) return null;
      visti.add(cur);
      cur = diretto.get(cur) ?? null;
    }
    return cur;
  };
  return new Map([...diretto.keys()].map((id) => [id, sali(id)]));
}

function scheda(nodo: string | null): string | null {
  const m = /^(dev|host):(\d+)$/.exec(nodo ?? "");
  return m ? `/${m[1] === "dev" ? "devices" : "objects"}/${m[2]}` : null;
}

/** Accese prima, poi per nome. */
export function componiVm(vms: readonly MapVm[], nodi: ReadonlyMap<string, MapNode>): VmComposta[] {
  return vms
    .map((v): VmComposta => ({
      id: v.id, nome: (v.nodeId !== null ? nodi.get(v.nodeId)?.name : undefined) ?? v.name, ip: v.ips[0] ?? null,
      accesa: v.status === "" ? null : isRunning(v.status), scheda: scheda(v.nodeId),
    }))
    .sort((a, b) => Number(a.accesa === false) - Number(b.accesa === false) || a.nome.localeCompare(b.nome, "it", { numeric: true }));
}
