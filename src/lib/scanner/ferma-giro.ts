import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Fermare un giro dalla bacheca. Ogni giro fermabile ha il suo `AbortController`; il segnale viaggia
 * in un `AsyncLocalStorage`, così `nmap`, `ping` e `naabu` lo prendono senza cambiare firma.
 *
 * Stato su `globalThis` con `Symbol.for`: il modulo può essere caricato due volte nello stesso
 * processo (come il lucchetto delle reti) e una seconda copia avrebbe il contesto vuoto.
 */
interface StatoFermi {
  giri: Map<string, AbortController>;
  contesto: AsyncLocalStorage<AbortSignal>;
}

const CHIAVE_STATO = Symbol.for("da-ipam.scanner.ferma-giro");

function stato(): StatoFermi {
  const g = globalThis as unknown as Record<symbol, StatoFermi | undefined>;
  return (g[CHIAVE_STATO] ??= { giri: new Map(), contesto: new AsyncLocalStorage() });
}

export const TESTO_GIRO_FERMATO = "Fermata dall'utente";

const CODICE_GIRO_FERMATO = "GIRO_FERMATO";

/** Il giro è stato fermato. Si riconosce con `isGiroFermato`: con due copie del modulo le classi sono due. */
export class GiroFermatoError extends Error {
  readonly codice = CODICE_GIRO_FERMATO;
  constructor() {
    super(TESTO_GIRO_FERMATO);
    this.name = "GiroFermatoError";
  }
}

export function isGiroFermato(e: unknown): e is GiroFermatoError {
  return typeof e === "object" && e !== null && (e as { codice?: unknown }).codice === CODICE_GIRO_FERMATO;
}

/** Rende fermabile un giro. `libera` va chiamata a giro chiuso. */
export function registraGiroFermabile(id: string): { segnale: AbortSignal; libera: () => void } {
  const controllo = new AbortController();
  const { giri } = stato();
  giri.set(id, controllo);
  return {
    segnale: controllo.signal,
    libera: () => {
      if (giri.get(id) === controllo) giri.delete(id);
    },
  };
}

/** Chiede di fermare il giro. `false` se non c'è (già chiuso, o non fermabile). */
export function fermaGiro(id: string): boolean {
  const controllo = stato().giri.get(id);
  if (!controllo) return false;
  controllo.abort();
  return true;
}

/** Esegue `fn` col segnale del giro: chi lancia un processo lo legge con `segnaleGiro`. */
export function conSegnaleGiro<T>(segnale: AbortSignal, fn: () => T): T {
  return stato().contesto.run(segnale, fn);
}

/** Il segnale del giro corrente; `undefined` fuori da un giro fermabile. */
export function segnaleGiro(): AbortSignal | undefined {
  return stato().contesto.getStore();
}

/**
 * Lancia se il giro è stato fermato. Va chiamata fra un lotto e l'altro, MAI dentro un
 * `Promise.all`: il giro si chiuderebbe e il lucchetto si libererebbe con gli altri host del lotto
 * ancora in scrittura.
 */
export function controllaFermo(): void {
  if (segnaleGiro()?.aborted) throw new GiroFermatoError();
}
