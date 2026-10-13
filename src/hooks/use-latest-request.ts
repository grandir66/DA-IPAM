"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Una richiesta nuova annulla quella in corso (UI-6, analisi 2026-10-12): senza,
 * la risposta di una ricerca vecchia che arriva tardi sostituisce quella giusta.
 * Si annulla anche all'uscita dalla pagina.
 *
 * Uso:
 *   const nextSignal = useLatestRequest();
 *   const signal = nextSignal();
 *   const r = await fetchJson(url, { signal });
 *   if (signal.aborted) return; // superata: non toccare lo stato
 */
export function useLatestRequest(): () => AbortSignal {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => () => ref.current?.abort(), []);
  return useCallback(() => {
    ref.current?.abort();
    const ac = new AbortController();
    ref.current = ac;
    return ac.signal;
  }, []);
}
