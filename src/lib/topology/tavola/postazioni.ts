/**
 * Le postazioni di lavoro nella tavola (Riccardo, 25/11: «non come box, ma direttamente come testo nella casella della porta
 * relativa, non occupiamo posto inutile»): un PC non ha un telaio suo, il suo nome sta sotto la porta a cui è attaccato. Logica pura.
 */
import { canonicalizza } from "@/lib/classification/canonico";
import type { MapNode } from "@/lib/topology/model-types";

const CLASSI: ReadonlySet<string> = new Set(["workstation", "notebook", "thin_client", "tablet"]);

export function ePostazione(n: MapNode): boolean {
  return n.kind === "device" && n.proxmoxScan !== true && n.ruolo === undefined && CLASSI.has(canonicalizza(n.type).classificazione);
}
