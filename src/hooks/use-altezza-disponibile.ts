"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Righe minime sempre visibili, anche su uno schermo basso (come il kit di DA-Template). */
const ALTEZZA_MINIMA = 320;

/**
 * Altezza che resta sullo schermo sotto l'elemento, con la pagina in cima: la tabella
 * «fissa» la usa come altezza massima, così scorre lei e non la pagina, e titolo,
 * filtri e intestazioni restano dove sono (Riccardo, 20/10; regola del kit di
 * DA-Template, `.tab-corpo`). Si ricalcola quando cambia la finestra o la pagina
 * sopra la tabella (filtri aperti, barra della selezione, chip che vanno a capo).
 * `riserva`: spazio da lasciare sotto: 40 px per il margine della scheda e della pagina. Prima
 * erano 72 per la paginazione sotto la tabella, ora nella riga del titolo (Riccardo, 20/10).
 *
 * Revisione del 20/10: la posizione si misura sulla pagina vera, sommando lo scorrimento
 * della finestra e di ogni antenato (a scorrere è la finestra, non il contenitore della
 * shell); prima un wrapper `overflow-x-auto` veniva preso per la pagina e una barra
 * comparsa sopra la tabella non faceva ricalcolare niente. useLayoutEffect: niente
 * primo disegno a piena lunghezza.
 */
export function useAltezzaDisponibile(ref: RefObject<HTMLElement | null>, attivo: boolean, riserva = 40): number | null {
  const [altezza, setAltezza] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!attivo || !el) return;
    const calcola = () => {
      let scorsi = window.scrollY;
      for (let p = el.parentElement; p; p = p.parentElement) scorsi += p.scrollTop;
      // Distanza dalla cima della pagina a pagina non scorsa.
      const cima = el.getBoundingClientRect().top + scorsi;
      setAltezza(Math.max(ALTEZZA_MINIMA, Math.floor(window.innerHeight - cima - riserva)));
    };
    calcola();
    const ro = new ResizeObserver(calcola);
    // Cambia l'altezza di qualcosa sopra la tabella → cambia la pagina.
    ro.observe(document.body);
    // Una tabella dentro una scheda si misura quando diventa visibile.
    ro.observe(el);
    window.addEventListener("resize", calcola);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", calcola);
    };
  }, [ref, attivo, riserva]);
  return altezza;
}
