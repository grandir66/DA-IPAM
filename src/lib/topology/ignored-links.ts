/**
 * «Collegamenti ignorati» nella pagina «Dati della mappa» (revisione finale della fase 2b): un «Ignora»
 * dal tasto destro nasconde una linea in tutte le mappe, e da qui si annulla con «Ripristina» (DELETE
 * /api/topology/links/[id]). Logica pura: quali righe, con che parole.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { MapNode } from "@/lib/topology/model-types";

/** Il dialogo di «Ignora» dice dove si annulla. */
export const IGNORA_SI_ANNULLA = "Si annulla dalla pagina «Dati della mappa», elenco «Collegamenti ignorati», con «Ripristina».";

/** Chi non è admin vede l'elenco in sola lettura, con il perché. */
export const SOLO_ADMIN_RIPRISTINA = "Sola lettura: solo un amministratore può ripristinare un collegamento ignorato.";

export interface IgnoredOverride {
  id: number;
  action: string;
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
  created_by: string | null;
  created_at: string;
}

export interface IgnoredLinkRow {
  id: number;
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  by: string;
  when: string;
}

function quando(x: string): string {
  const d = parseDbDate(x);
  if (Number.isNaN(d.getTime())) return "data non leggibile";
  return d.toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Le correzioni «ignora», le più recenti prima, con i nomi degli oggetti (passando dall'id canonico:
 * un host poi promosso ad apparato si chiama col nome di oggi) e le porte in parole.
 */
export function ignoredLinkRows(
  rows: readonly IgnoredOverride[],
  model: { nodes: readonly Pick<MapNode, "id" | "name">[]; canonical: Readonly<Record<string, string>> },
): IgnoredLinkRow[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n.name]));
  const nome = (id: string): string => byId.get(model.canonical[id] ?? id) ?? `oggetto non più nella mappa (${id})`;
  const porta = (p: string): string => (p.trim() ? `porta ${p.trim()}` : "porta non indicata");
  return rows
    .filter((r) => r.action === "ignore")
    .sort((x, y) => y.id - x.id)
    .map((r) => ({
      id: r.id, a: nome(r.a_node), aPort: porta(r.a_port), b: nome(r.b_node), bPort: porta(r.b_port),
      by: r.created_by?.trim() || "sconosciuto", when: quando(r.created_at),
    }));
}
