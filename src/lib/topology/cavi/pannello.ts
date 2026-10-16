/**
 * I testi del pannello dei dettagli per cavo (T3, spec §13.4.6, §13.8.3 punti 8-10, §13.9, §13.7.2 passo 10). Logica pura,
 * senza nomi di prodotto (prova I37): i nomi degli oggetti li dà chi chiama. Solo con la mappa nuova (`model.cavi`): con la
 * mappa di prima il pannello è quello di T1.
 */
import { speedLabel } from "@/lib/topology/edge-look";
import type { MapComputed } from "@/lib/topology/map-compute";
import type { CandidatoPorta, CavoLinea, GenereLinea, InfoCavi, MapLink, TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";

/** La parola del genere nei menu e nei dialoghi (§13.9): «cavo» dove il genere non ne ha una sua (T1, senza fili). */
export function nomeDelGenere(g: GenereLinea | undefined): string {
  switch (g) {
    case "tunnel": return "tunnel";
    case "radio": return "ponte radio";
    case "fascio": return "fascio";
    default: return "cavo";
  }
}

/** Il titolo di «Perché questo …» (§13.4.6): prima di T3, dove una linea è una coppia, «collegamento». */
export function titoloPerche(g: GenereLinea | undefined): string {
  return g === "cavo" || g === "tunnel" || g === "radio" || g === "fascio" ? `Perché questo ${nomeDelGenere(g)}` : "Perché questo collegamento";
}

/** Il collegamento con cui `nodo` è appeso nell'albero, e il suo padre. */
function padreDi(tree: Pick<TreeResult, "via">, nodo: string): string | null {
  const l = tree.via.get(nodo);
  return l ? (l.a === nodo ? l.b : l.a) : null;
}

/** Dalla radice dell'albero (la testa) fino a `nodo`, passando dai padri; `nodo` per ultimo. Vuota se il nodo non è nell'albero. */
function catena(tree: Pick<TreeResult, "via" | "roots">, nodo: string): string[] {
  const out = [nodo];
  const visti = new Set(out);
  for (let x = padreDi(tree, nodo); x !== null; x = padreDi(tree, x)) {
    if (visti.has(x)) return [];
    visti.add(x);
    out.unshift(x);
  }
  return tree.roots.includes(out[0]) ? out : [];
}

/**
 * §13.8.3 punto 10: la ★ non usata perché l'altro capo si raggiunge solo passando dal nodo stesso. `l` è una linea della
 * vista (con `primary` e `primaryFor` come li annota l'albero). Null se la ★ non c'è, se è usata o se non è questo il motivo.
 */
export function stellaNonApplicabile(l: MapLink, tree: TreeResult, nomeDi: (id: string) => string): string | null {
  if (l.primary !== "user" || !l.primaryFor || (l.primaryFor !== l.a && l.primaryFor !== l.b)) return null;
  const nodo = l.primaryFor;
  if (tree.via.get(nodo)?.id === l.id) return null;
  const altro = l.a === nodo ? l.b : l.a;
  // «altro» sta sotto «nodo» se, risalendo dai suoi padri, si passa da «nodo».
  if (!catena(tree, altro).slice(0, -1).includes(nodo)) return null;
  return `★ non applicabile: ${nomeDi(altro)} si raggiunge solo passando da ${nomeDi(nodo)}`;
}

/** §13.8.3 punto 9: una riga per partenza scartata, perché raggiungibile da un'altra. */
export function partenzeScartate(c: Pick<MapComputed<TopologyModel>, "savedRoots" | "tree">, nomeDi: (id: string) => string): string[] {
  const out: string[] = [];
  for (const r of c.savedRoots) {
    if (c.tree.roots.includes(r)) continue;
    const padre = padreDi(c.tree, r);
    const testa = catena(c.tree, r)[0];
    if (padre === null || !testa) continue; // non è nell'albero (fuori dalla mappa): non c'è niente da dire
    out.push(`${nomeDi(r)} è raggiungibile da ${nomeDi(testa)}: sta nell'albero sotto ${nomeDi(padre)}`);
  }
  return out;
}

/** «A», «A e B», «A, B e C»; oltre `max` nomi, «A, B, C e altri N». */
function elenco(nomi: readonly string[], max = 6): string {
  const mostrati = nomi.slice(0, max);
  const resto = nomi.length - mostrati.length;
  if (resto > 0) return `${mostrati.join(", ")} e altri ${resto}`;
  return mostrati.length <= 1 ? (mostrati[0] ?? "") : `${mostrati.slice(0, -1).join(", ")} e ${mostrati[mostrati.length - 1]}`;
}

/** Il testo di D2 nei dettagli (§13.8.3 punto 8), titolo e corpo. */
export function testoAnomalia(a: InfoCavi["anomalie"][number], nomeDi: (id: string) => string): { titolo: string; testo: string } {
  const porta = a.porta.trim() ? `porta ${a.porta.trim()}` : "porta non nota";
  return {
    titolo: "core che esce da uno switch di accesso",
    testo:
      `Il percorso attivo di ${nomeDi(a.nodo)} passa da ${nomeDi(a.padre)} (${porta}). ` +
      `${nomeDi(a.nodo)} ha cavi anche verso ${elenco(a.altri.map(nomeDi))}, che stanno allo stesso livello di ${nomeDi(a.padre)}. ` +
      "Di solito i core stanno sopra gli accessi: controlla le priorità dello spanning tree, o il cavo fra i due core.",
  };
}

/** L'invito in coda alla ★ di prima: è anche l'etichetta del pulsante (§13.9). */
export const INVITO_STELLA = "Scegli il cavo";

/** La ★ scelta prima che le linee fossero per cavo (§13.9): vale per il cavo migliore della coppia, mai persa in silenzio. */
export function testoStellaDiPrima(): string {
  return `★ scelta prima che le linee fossero per cavo: ora vale per il cavo migliore fra questi due apparati. ${INVITO_STELLA}`;
}

/**
 * Una ★ che non indica più nessun cavo fra i due apparati (Caso 2 del piano, revisione del Task 8): non si perde in silenzio, i
 * dettagli lo dicono. `nCavi` sono i cavi che oggi uniscono la coppia; con zero non c'è un «cavo migliore» a cui far valere la ★.
 */
export function testoStellaSenzaCollegamento(nomeA: string, nomeB: string, nCavi: number): string | null {
  return nCavi === 0 ? `★ senza collegamento: fra ${nomeA} e ${nomeB} oggi non c'è nessun cavo` : null;
}

/** §13.7.2 passo 10: i collegamenti «dalle VM» che non si disegnano, nei dettagli dell'hypervisor. */
export function righeDalleVm(righe: InfoCavi["dalleVm"][string], nomeDi: (id: string) => string): string[] {
  return righe.map((r) => `visto dalle VM anche su ${r.porta} di ${nomeDi(r.altro)} (${r.vm} VM)`);
}

const STATO_MEMBRO: Partial<Record<NonNullable<CavoLinea["stato"]>, string>> = {
  giu: "cavo giù", bloccato: "bloccato", bloccato_comune: "bloccato", instradato: "instradato", riserva_bond: "riserva",
};

/** Un membro di un fascio, porta per porta (§13.9, dialogo dell'«Ignora» e dettagli): «p1 ↔ p2 · 25G · bloccato». */
export function membroInParole(m: NonNullable<CavoLinea["fascio"]>["membri"][number]): string {
  const porta = (p: string): string => p.trim() || "porta non nota";
  // Un cavo giù è «senza velocità» (§13.10.3).
  return [`${porta(m.aPort)} ↔ ${porta(m.bPort)}`, m.stato === "giu" ? null : speedLabel(m.velocitaMbps), m.stato ? STATO_MEMBRO[m.stato] : undefined].filter(Boolean).join(" · ");
}

const GENERE_SCELTO: Readonly<Record<string, string>> = {
  cavo: "cavo", fascio: "fascio", tunnel: "tunnel", radio: "ponte radio", senza_fili: "collegamento senza fili", segmento: "segmento",
};

/** «Candidati per porta» (§13.4.6): il collegamento scelto di una porta, «cavo verso core 1». `verso` può essere un id o già un nome. */
export function sceltoInParole(s: NonNullable<CandidatoPorta["scelto"]>, nomeDi: (id: string) => string): string {
  return `${GENERE_SCELTO[s.genere] ?? "collegamento"} verso ${nomeDi(s.verso)}`;
}
