/**
 * Una mappa salvata letta attraverso gli id canonici del modello (revisione
 * finale I5). Le mappe salvano id grezzi («host:N»): quando quell'host viene
 * promosso ad apparato o fuso in un altro oggetto, il suo id sparisce dai nodi
 * e la mappa lo dava «non più presente». Qui membri, partenze, ritocchi e testa
 * passano dall'id canonico; «non più presente» è solo un id senza nodo e senza
 * alias. `renames` dice cosa riscrivere alla prossima modifica della mappa (la
 * lettura non scrive). Logica pura.
 */
import type { SavedTweak } from "@/lib/topology/tree-layout";

export interface StoredMapView {
  members: string[];
  roots: string[];
  tweaks: SavedTweak[];
  head: string | null;
}

export interface ResolvedMapView {
  /** Membri con un nodo, per id canonico, senza doppi, nell'ordine salvato. */
  visible: string[];
  /** Id salvati che non hanno né un nodo né un alias. */
  missing: string[];
  /** Partenze per id canonico (anche quelle senza nodo: le filtra chi le usa). */
  roots: string[];
  tweaks: SavedTweak[];
  head: string | null;
  renames: Array<{ from: string; to: string }>;
}

export function resolveMapView(stored: StoredMapView, nodeIds: Set<string>, canonical: Record<string, string>): ResolvedMapView {
  const canon = (id: string): string => canonical[id] ?? id;
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  const visible = uniq(stored.members.map(canon).filter((id) => nodeIds.has(id)));
  const missing = uniq(stored.members.filter((id) => !nodeIds.has(canon(id))));
  const tweaks = new Map<string, SavedTweak>();
  for (const t of stored.tweaks) {
    const id = canon(t.nodeId);
    if (!tweaks.has(id) || t.nodeId === id) tweaks.set(id, { ...t, nodeId: id });
  }
  const head = stored.head !== null && nodeIds.has(canon(stored.head)) ? canon(stored.head) : null;
  const all = [...stored.members, ...stored.roots, ...stored.tweaks.map((t) => t.nodeId), ...(stored.head ? [stored.head] : [])];
  const renames = uniq(all.filter((id) => canon(id) !== id)).map((id) => ({ from: id, to: canon(id) }));
  return { visible, missing, roots: uniq(stored.roots.map(canon)), tweaks: [...tweaks.values()], head, renames };
}
