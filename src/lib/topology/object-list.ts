/**
 * Quali nodi del modello entrano nell'elenco degli oggetti a sinistra della Topologia.
 * Decisione di Riccardo, 2026-10-15: gli apparati di rete disabilitati (network_devices.enabled = 0) non si
 * elencano. Sulla mappa restano come prima, coi loro cavi: questo filtro vale solo per l'elenco.
 */
import type { MapNode } from "@/lib/topology/model-types";

export function listedNodes<T extends Pick<MapNode, "disabled">>(nodes: readonly T[]): T[] {
  return nodes.filter((n) => n.disabled !== true);
}
