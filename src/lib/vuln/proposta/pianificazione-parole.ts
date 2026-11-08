/**
 * Le parole della pianificazione «Per device», senza database: le usa anche il pannello nel browser
 * (`components/scansioni/quando-device.tsx`). Il resto sta in `pianificazione.ts`, che legge il database.
 */
import type { Pianificazione } from "./pianificazione";

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** «sab, dom dalle 22:00 alle 06:00»: la fascia di una finestra. Pura. */
export function fasciaInParole(f: { giorni: number[]; dalle: string; alle: string }): string {
  const giorni = f.giorni.length === 7 ? "ogni giorno" : [...f.giorni].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((g) => GIORNI[g].slice(0, 3)).join(", ");
  return `a finestra, ${giorni} dalle ${f.dalle} alle ${f.alle}`;
}

/** «ogni domenica alle 02:00»: la riga della pianificazione e la pagina Schedulazioni. Pura. */
export function quandoInParole(p: Pick<Pianificazione, "frequenza" | "giorno" | "ora"> & Partial<Pick<Pianificazione, "modo" | "fascia">>): string {
  if (p.modo === "finestra" && p.fascia) return fasciaInParole(p.fascia);
  if (p.frequenza === "giornaliera") return `ogni giorno alle ${p.ora}`;
  if (p.frequenza === "settimanale") return `ogni ${GIORNI[p.giorno ?? 0]} alle ${p.ora}`;
  return `ogni mese il giorno ${p.giorno} alle ${p.ora}`;
}
