/**
 * Segno del cambio di cliente per la sonda trunk del Mac del tecnico (ADR 0037; 08/11/2026).
 * Solo impostazioni dell'hub: lo importa `auth.config` in modo dinamico (accesso e cambio di
 * profilo), e da lì non deve passare `db-tenant` (ADR 0002). Il resto sta in `tecnico.ts`.
 */
import { getSetting, setSetting } from "@/lib/db-hub";

export const PROFILO = "trunk_tecnico_profilo";
export const AZZERA = "trunk_tecnico_azzera";
const VISTA_TUTTE = "__ALL__";

export function segnaCambioProfiloTrunk(codice: string): void {
  if (!codice || codice === VISTA_TUTTE) return;
  if (getSetting(PROFILO) === codice) return; // rientro sullo stesso cliente: niente da azzerare
  setSetting(PROFILO, codice);
  setSetting(AZZERA, "1");
}
