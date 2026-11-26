/**
 * Le icone che il manuale può mostrare nel testo (Riccardo, 26/11/2026: «quando parli delle voci, delle colonne e dei
 * pulsanti servirebbe il simbolo e non la descrizione»). Nelle guide si scrive `icona:<nome>` (il segno da solo) o
 * `tasto:<nome>` (il segno dentro un pulsante, come a schermo), fra apici inversi. Il disegno lo fa
 * `components/manual/icona-manuale.tsx` con le stesse icone del programma; qui c'è solo l'elenco dei nomi, così la
 * prova di copertura controlla che una guida non citi un'icona che non c'è.
 */
export const NOMI_ICONE = [
  // barra sopra gli elenchi
  "search", "filter", "columns", "download", "refresh", "x",
  // righe delle tabelle
  "more-vertical", "pencil", "external-link", "arrow-up-down", "arrow-up", "arrow-down", "copy", "eye-off",
  // colonna Profilo e azioni della riga
  "wrench", "package", "activity", "shield", "shield-check", "plus-circle", "monitor", "terminal", "link",
  "globe", "key", "trash", "file-text", "boxes", "package-plus", "check", "merge", "split",
  // menu a sinistra e menu dell'utente
  "panel-close", "panel-open", "more-horizontal", "chevron-right", "chevron-down", "lock", "menu", "moon", "sun",
  "log-out", "dashboard", "network", "book", "settings",
  // pagine dell'elenco
  "chevrons-left", "chevron-left", "chevrons-right",
] as const;

export type NomeIcona = (typeof NOMI_ICONE)[number];

const INSIEME = new Set<string>(NOMI_ICONE);

/** `icona:wrench` → { nome: "wrench", tasto: false }; `tasto:filter` → { nome: "filter", tasto: true }; altrimenti null. */
export function leggiIcona(testo: string): { nome: NomeIcona; tasto: boolean } | null {
  const m = /^(icona|tasto):([a-z-]+)$/.exec(testo.trim());
  if (!m || !INSIEME.has(m[2])) return null;
  return { nome: m[2] as NomeIcona, tasto: m[1] === "tasto" };
}
