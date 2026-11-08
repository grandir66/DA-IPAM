/**
 * Sonda trunk sul Mac del tecnico (installazione «tecnico», ADR 0037; 08/11/2026).
 *
 * Riccardo, 08/11: la lettura è accesa di serie e «l'acquisizione deve essere da resettare e
 * riabilitare ad ogni cambio cliente». Il Mac passa da un cliente all'altro, la sonda no:
 *
 * - al cambio di profilo (`auth.config`, callback jwt) si segna il profilo e «azzerare»
 *   (`segnaCambioProfiloTrunk`), senza chiamare la sonda dal login;
 * - il giro di lettura (`job.ts`) chiama `preparaTrunkTecnico` prima di leggere: azzera la sonda,
 *   accende la lettura del solo profilo scelto col cursore da capo, la spegne negli altri;
 * - se l'azzeramento fallisce (un giro della sonda in corso, sonda ferma) non si legge niente e si
 *   riprova al giro dopo: meglio un dato in ritardo che nel cliente sbagliato.
 */
import { getActiveTenants, getSetting, setSetting } from "@/lib/db-hub";
import { setTenantSetting, withTenant } from "@/lib/db-tenant";

import { AZZERA, PROFILO } from "./tecnico-profilo";

// Il segno del cambio sta in tecnico-profilo.ts: lo importa `auth.config` in modo dinamico, e
// lì non deve arrivare `db-tenant` (ADR 0002: seconda istanza sotto tsx).
export { segnaCambioProfiloTrunk } from "./tecnico-profilo";

function letturaSoloSu(profilo: string | null): void {
  for (const t of getActiveTenants()) {
    withTenant(t.codice_cliente, () => setTenantSetting("trunk_lettura", t.codice_cliente === profilo ? "1" : "0"));
  }
}

export async function preparaTrunkTecnico(
  azzeraSonda: () => Promise<unknown>,
): Promise<{ leggi: true; profilo: string } | { leggi: false; motivo: string }> {
  const profilo = getSetting(PROFILO) || null;
  if (!profilo) {
    letturaSoloSu(null);
    return { leggi: false, motivo: "nessun profilo scelto" };
  }
  if (getSetting(AZZERA) === "1") {
    letturaSoloSu(null);
    try {
      await azzeraSonda();
    } catch (e) {
      return { leggi: false, motivo: `sonda non azzerata: ${e instanceof Error ? e.message : String(e)}` };
    }
    withTenant(profilo, () => setTenantSetting("trunk_cursore", ""));
    setSetting(AZZERA, "");
  }
  letturaSoloSu(profilo);
  return { leggi: true, profilo };
}
