/**
 * Le parole della pianificazione «Per device», senza database: le usa anche il pannello nel browser
 * (`components/scansioni/quando-device.tsx`). Il resto sta in `pianificazione.ts`, che legge il database.
 */
import type { Pianificazione } from "./pianificazione";

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** «ogni domenica alle 02:00»: la riga della pianificazione e la pagina Schedulazioni. Pura. */
export function quandoInParole(p: Pick<Pianificazione, "frequenza" | "giorno" | "ora">): string {
  if (p.frequenza === "giornaliera") return `ogni giorno alle ${p.ora}`;
  if (p.frequenza === "settimanale") return `ogni ${GIORNI[p.giorno ?? 0]} alle ${p.ora}`;
  return `ogni mese il giorno ${p.giorno} alle ${p.ora}`;
}
