"use client";

/**
 * Quale parte della pagina è aperta, per il «?» del manuale: il pulsante sta nel guscio, fuori dalla pagina, quindi
 * la pagina lo dichiara qui con `useParteGuida` e il pulsante lo legge con `useParteAperta` (scorre a `{#parte}`).
 */
import { useEffect, useSyncExternalStore } from "react";

let aperta: string | null = null;
const ascoltatori = new Set<() => void>();
function metti(p: string | null) {
  aperta = p;
  ascoltatori.forEach((f) => f());
}
const iscrivi = (f: () => void) => {
  ascoltatori.add(f);
  return () => { ascoltatori.delete(f); };
};

export function useParteGuida(parte: string | null): void {
  useEffect(() => {
    metti(parte);
    return () => metti(null);
  }, [parte]);
}

export function useParteAperta(): string | null {
  return useSyncExternalStore(iscrivi, () => aperta, () => null);
}
