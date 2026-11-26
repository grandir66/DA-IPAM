/**
 * Il blocco di un indirizzo, dal lato dell'applicazione: chi è bloccato adesso e chi non si blocca mai
 * (Protezione, tappa 5; piano §4.5). Modulo puro. L'esecutore rifiuta già NetBird, la macchina e il gateway;
 * qui si aggiungono i «sempre ammessi» del filtro e l'elenco «mai bloccati» scelto da una persona.
 */
import { RETE_NETBIRD, inElenco } from "./anteprima";
import { inRete } from "./sistemi";

export interface Bloccato {
  indirizzo: string;
  /** Secondi che restano; `null` se nft non lo dice. */
  restano: number | null;
}

/** I bloccati dall'uscita di `nft -j list table inet daipam_blocco` (set `bloccati4` e `bloccati6`). */
export function leggiBloccati(json: string): Bloccato[] {
  let dati: unknown;
  try {
    dati = JSON.parse(json);
  } catch {
    return [];
  }
  const righe = (dati as { nftables?: unknown[] })?.nftables;
  if (!Array.isArray(righe)) return [];
  const bloccati: Bloccato[] = [];
  for (const r of righe) {
    const set = (r as { set?: { name?: string; elem?: unknown[] } })?.set;
    if (!set || !/^bloccati[46]$/.test(set.name ?? "") || !Array.isArray(set.elem)) continue;
    for (const e of set.elem) {
      const dentro = (e as { elem?: { val?: unknown; expires?: unknown } })?.elem;
      const val = dentro?.val ?? e;
      if (typeof val === "string") bloccati.push({ indirizzo: val, restano: typeof dentro?.expires === "number" ? dentro.expires : null });
    }
  }
  return bloccati.sort((a, b) => a.indirizzo.localeCompare(b.indirizzo, undefined, { numeric: true }));
}

export interface ContestoBlocco {
  /** I «sempre ammessi» del filtro. */
  sempre: readonly string[];
  /** L'elenco «mai bloccati». */
  mai: readonly string[];
  /** Gli indirizzi di questa macchina. */
  nostri: ReadonlySet<string>;
  /** Chi sta chiedendo il blocco. */
  chiamante: string | null;
}

/** Perché questo indirizzo non si blocca; `null` = si può. */
export function motivoNonBloccabile(indirizzo: string, c: ContestoBlocco): string | null {
  if (indirizzo.includes("/")) return "Si blocca un indirizzo, non una rete.";
  if (inRete(indirizzo, RETE_NETBIRD)) return "È della rete NetBird/DA-Link: non si blocca mai.";
  if (c.nostri.has(indirizzo)) return "È un indirizzo di questa macchina.";
  if (c.chiamante && c.chiamante === indirizzo) return "È l'indirizzo da cui stai lavorando: ti chiuderesti fuori.";
  if (inElenco(indirizzo, c.sempre)) return "È fra i «sempre ammessi» del filtro.";
  if (inElenco(indirizzo, c.mai)) return "È nell'elenco «mai bloccati».";
  return null;
}

/** Le durate che la pagina offre, in secondi. Chiuse: la rotta non accetta altro. */
export const DURATE_BLOCCO: Readonly<Record<string, number>> = { "1 ora": 3600, "24 ore": 86400, "7 giorni": 604800 };
