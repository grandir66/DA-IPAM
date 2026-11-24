/**
 * Ingresso e uscita della rotta GET /api/topology/tavola (spec tavola §2), senza DB: il sito letto dalla query e la
 * scelta dei nodi e dei collegamenti che toccano il sito dal modello della mappa già calcolato.
 */
import type { MapNode, TopologyModel } from "@/lib/topology/model-types";

/** Il «sito» 0 raccoglie gli apparati senza sede: su un'istanza senza sedi definite la tavola non resta vuota. */
export const SENZA_SEDE = 0;

export function nelSito(n: Pick<MapNode, "siteId">, sito: number): boolean {
  return sito === SENZA_SEDE ? n.siteId === null : n.siteId === sito;
}

/** `site` assente = il primo sito (`data: null`); presente deve essere un id numerico; 0 = «Senza sede». */
export function parseSitoTavola(v: string | null): { ok: true; data: number | null } | { ok: false; error: string } {
  if (v === null || v.trim() === "") return { ok: true, data: null };
  if (!/^\d+$/.test(v.trim())) return { ok: false, error: "Sito non valido: serve l'id numerico della sede" };
  const n = Number(v.trim());
  return Number.isSafeInteger(n) && n >= 0 ? { ok: true, data: n } : { ok: false, error: "Sito non valido: serve l'id numerico della sede" };
}

interface Ubicazione { id: number; name: string; parent_id: number | null }

/** Il nome di ogni armadio usato dai nodi, col percorso dentro la sede (la sede, in cima, non si ripete). */
export function nomiArmadi(nodi: readonly Pick<MapNode, "rackId">[], ubicazioni: readonly Ubicazione[]): Array<{ id: number; name: string }> {
  const perId = new Map(ubicazioni.map((u) => [u.id, u]));
  const usati = [...new Set(nodi.flatMap((n) => (n.rackId === null ? [] : [n.rackId])))];
  return usati.flatMap((id) => {
    const nomi: string[] = [];
    const visti = new Set<number>();
    for (let u = perId.get(id); u && u.parent_id !== null && perId.has(u.parent_id) && !visti.has(u.id); u = perId.get(u.parent_id)) {
      visti.add(u.id);
      nomi.unshift(u.name);
    }
    return nomi.length > 0 ? [{ id, name: nomi.join(" › ") }] : [];
  });
}

/** Gli apparati del sito (id numerici), i collegamenti che li toccano e i nodi che servono a nominarne i capi. */
export function ritagliaSito(model: Pick<TopologyModel, "nodes" | "links" | "sites">, sito: number) {
  const apparati = model.nodes.filter((n) => n.kind === "device" && !n.hidden && nelSito(n, sito));
  const dentro = new Set(apparati.map((n) => n.id));
  const collegamenti = model.links.filter((l) => dentro.has(l.a) || dentro.has(l.b));
  const servono = new Set([...dentro, ...collegamenti.flatMap((l) => [l.a, l.b])]);
  return {
    deviceIds: apparati.map((n) => n.refId),
    nodi: model.nodes.filter((n) => servono.has(n.id)),
    collegamenti,
    siti: [
      ...model.sites.map((s) => ({ id: s.locationId, name: s.name })).sort((a, b) => a.name.localeCompare(b.name, "it")),
      ...(model.nodes.some((n) => n.kind === "device" && !n.hidden && n.siteId === null) ? [{ id: SENZA_SEDE, name: "Senza sede" }] : []),
    ],
  };
}
