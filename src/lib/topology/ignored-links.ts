/**
 * «Collegamenti ignorati» nella pagina «Dati della mappa» (revisione finale della fase 2b): un «Ignora»
 * dal tasto destro nasconde una linea in tutte le mappe, e da qui si annulla con «Ripristina» (DELETE
 * /api/topology/links/[id]). Logica pura: quali righe, con che parole.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { SOURCE_WORDS } from "@/lib/topology/edge-look";
import type { MapLink, MapNode } from "@/lib/topology/model-types";

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
  /** La correzione non corrisponde a nessun cavo visto: non toglie niente (spec §13.9). */
  orfana: boolean;
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
  model: { nodes: readonly Pick<MapNode, "id" | "name">[]; canonical: Readonly<Record<string, string>>; correzioniOrfane?: readonly number[] },
): IgnoredLinkRow[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n.name]));
  const nome = (id: string): string => byId.get(model.canonical[id] ?? id) ?? `oggetto non più nella mappa (${id})`;
  const porta = (p: string): string => (p.trim() ? `porta ${p.trim()}` : "porta non indicata");
  return rows
    .filter((r) => r.action === "ignore")
    .sort((x, y) => y.id - x.id)
    .map((r) => ({
      id: r.id, a: nome(r.a_node), aPort: porta(r.a_port), b: nome(r.b_node), bPort: porta(r.b_port),
      by: r.created_by?.trim() || "sconosciuto", when: quando(r.created_at), orfana: (model.correzioniOrfane ?? []).includes(r.id),
    }));
}

/** Una correzione che non corrisponde a nessun cavo visto (spec §13.9, C5): si mostra, non si converte da sola (D3). */
export const ORFANA = "non corrisponde a nessun cavo visto: non toglie niente";

/** Titolo e testo del dialogo di «Ignora questo cavo…» (spec §13.9, «Testi che cambiano»). */
export function testiIgnoraCavo(a: string, aPort: string, b: string, bPort: string, fonti: string): { titolo: string; testo: string } {
  const p = (x: string) => x.trim() || "porta non nota";
  return {
    titolo: `Ignorare il cavo ${a} · ${p(aPort)} ↔ ${b} · ${p(bPort)}?`,
    testo: `Questo cavo sparisce da tutte le mappe, anche se le letture continuano a vederlo (${fonti}). Gli altri cavi fra ${a} e ${b}, se ci sono, restano. I dati letti non si toccano.`,
  };
}

/** `linea`: è il cavo che oggi regge la linea sulla mappa. Ignorarlo toglie la linea: lo si dice accanto, non si preseleziona. */
export interface CavoDaScegliere { aPort: string; bPort: string; parole: string; linea: boolean }

/**
 * «Scegli il cavo da ignorare…» per una correzione orfana: i cavi fra i due oggetti — in T1 la linea e gli «Altri cavi
 * visti» — con le porte orientate come la correzione (a_node, b_node), per scriverne una nuova al posto dell'orfana.
 */
export function caviFra(model: { links: readonly MapLink[]; canonical: Readonly<Record<string, string>> }, aNode: string, bNode: string): CavoDaScegliere[] {
  const a = model.canonical[aNode] ?? aNode, b = model.canonical[bNode] ?? bNode;
  const l = model.links.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (!l) return [];
  const dritto = l.a === a;
  const verso = (p: string, q: string) => (dritto ? { aPort: p, bPort: q } : { aPort: q, bPort: p });
  const fonti = (s: readonly MapLink["source"][]) => s.map((x) => SOURCE_WORDS[x]).join(" + ");
  return [
    { ...verso(l.aPort, l.bPort), parole: `la linea sulla mappa · ${fonti(l.sources)}`, linea: true },
    ...(l.altriCavi ?? []).map((c) => ({ ...verso(c.aPort, c.bPort), parole: `altro cavo visto · ${fonti(c.sources)}`, linea: false })),
  ];
}
