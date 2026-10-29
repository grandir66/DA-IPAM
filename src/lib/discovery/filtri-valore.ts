/**
 * Filtri sul valore di una cella della tabella Discovery (Riccardo, 29/10): dal menu del
 * tasto destro «Mostra solo questo valore» / «Escludi questo valore». Modulo puro: lo usa
 * `app/(dashboard)/discovery/page.tsx`, che passa il testo della cella (lo stesso del CSV).
 *
 * Più filtri si sommano (tutti devono valere). Il valore vuoto è un valore come gli altri:
 * «mostra solo le righe senza nome» è un filtro utile.
 */
export interface FiltroValore {
  colonna: string;
  valore: string;
  /** true = nasconde le righe con questo valore. */
  escludi: boolean;
}

/** Il filtro «dati acquisiti»: tutti, solo con inventario letto dall'apparato, solo senza. */
export type FiltroAcquisizione = "" | "acquisiti" | "non_acquisiti";

/** Colonne che non si filtrano per valore: «Profilo» è un punteggio interno, non un testo. */
const NON_FILTRABILI = new Set(["profilo"]);

export function colonnaFiltrabile(colonna: string): boolean {
  return !NON_FILTRABILI.has(colonna);
}

/** Aggiunge un filtro; uno uguale (stessa colonna e valore) prende il posto del vecchio. */
export function aggiungiFiltroValore(filtri: readonly FiltroValore[], nuovo: FiltroValore): FiltroValore[] {
  return [...filtri.filter((f) => !(f.colonna === nuovo.colonna && f.valore === nuovo.valore)), nuovo];
}

export function togliFiltroValore(filtri: readonly FiltroValore[], indice: number): FiltroValore[] {
  return filtri.filter((_, i) => i !== indice);
}

/** La riga passa tutti i filtri? `testo(colonna)` dà il testo della cella. */
export function passaFiltriValore(filtri: readonly FiltroValore[], testo: (colonna: string) => string): boolean {
  return filtri.every((f) => (testo(f.colonna).trim() === f.valore.trim()) !== f.escludi);
}

export function passaFiltroAcquisizione(filtro: FiltroAcquisizione, h: { device_acquired?: boolean }): boolean {
  if (filtro === "acquisiti") return h.device_acquired === true;
  if (filtro === "non_acquisiti") return h.device_acquired !== true;
  return true;
}

/** Il valore come si legge nel menu e nell'etichetta del filtro: corto, e «(vuoto)» se non c'è. */
export function valoreLeggibile(valore: string, max = 40): string {
  const v = valore.trim();
  if (!v || v === "—") return "(vuoto)";
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}
