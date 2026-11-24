/**
 * La ricerca della tavola: cosa corrisponde a un testo, nell'ordine in cui si vede (righe dall'alto, porte da sinistra).
 * Un apparato trovato per nome o IP è un risultato solo; le sue porte non si ripetono. Logica pura.
 */
import { ordina } from "./righe";
import type { ApparatoComposto, PortaComposta } from "./tipi";

/** `porta` null = il risultato è l'apparato intero. */
export interface Trovato { nodo: string; porta: string | null }

function portaCorrisponde(p: PortaComposta, q: string): boolean {
  return p.nome.toLowerCase() === q
    || [p.destinazione, p.letta?.nomeClient, p.letta?.ipClient].some((s) => (s ?? "").toLowerCase().includes(q));
}

export function cercaInTavola(apparati: readonly ApparatoComposto[], testo: string): Trovato[] {
  const q = testo.trim().toLowerCase();
  if (q.length < 2) return [];
  return ordina(apparati).flatMap((a): Trovato[] =>
    a.nome.toLowerCase().includes(q) || (a.ip ?? "").includes(q)
      ? [{ nodo: a.nodo, porta: null }]
      : a.porte.filter((p) => portaCorrisponde(p, q)).map((p) => ({ nodo: a.nodo, porta: p.id })));
}
