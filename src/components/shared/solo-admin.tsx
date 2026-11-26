"use client";

import type { ReactNode } from "react";
import { useEAdmin } from "@/hooks/use-e-admin";

/**
 * Mostra i figli solo a un amministratore (26/11/2026). Chi è in sola lettura vedeva pulsanti che cambiano dati
 * (Nuovo, Elimina, Sincronizza, Salva…) attivi, e il server poi li rifiutava: il giro delle guide del manuale ne ha
 * trovati in una ventina di pagine. Il server resta il confine (`requireAdmin`); questo toglie solo il pulsante.
 * `altrimenti` è quello che vede chi non è amministratore (di solito niente).
 */
export function SoloAdmin({ children, altrimenti = null }: { children: ReactNode; altrimenti?: ReactNode }) {
  return <>{useEAdmin() ? children : altrimenti}</>;
}
