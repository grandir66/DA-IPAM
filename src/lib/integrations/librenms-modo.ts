/**
 * LibreNMS solo locale (passo 5 del piano di solidità, 16/10; decisione di
 * Riccardo: LibreNMS è integrato e locale, sempre).
 *
 * - Modo nuovo `appliance`: LibreNMS messo dall'installatore dell'appliance.
 *   Accettato ovunque si accetta `managed`; per le chiamate vale come `external`.
 * - `external` sparisce dalla scelta in pagina per LibreNMS, ma le righe che ce
 *   l'hanno restano leggibili e funzionanti: **nessuna migrazione automatica**.
 *   Si passa ad `appliance` solo con «Converti», che chiede conferma
 *   (`POST /api/integrations/librenms/converti`, solo admin).
 *
 * Pura, senza import lato server: la usano la rotta, la scheda client e le prove.
 */
import type { IntegrationComponent, IntegrationMode } from "./types";

/** Modi che si possono scrivere in configurazione, per componente. */
export function modiAccettati(component: IntegrationComponent): readonly IntegrationMode[] {
  // `external` resta accettato anche per LibreNMS: lo scrive ancora l'installatore
  // dell'appliance (Deploy-Appliance `connect.sh`) e lo rimanda «Salva» su una riga
  // esistente. Toglierlo romperebbe le installazioni che ci sono.
  return component === "librenms"
    ? ["disabled", "managed", "appliance", "external"]
    : ["disabled", "managed", "external"];
}

/** Motivo per cui il modo non si può scrivere per quel componente, o null se va bene. */
export function rifiutoModo(component: IntegrationComponent, mode: IntegrationMode | undefined): string | null {
  if (mode === undefined) return null;
  if (modiAccettati(component).includes(mode)) return null;
  if (mode === "appliance") {
    return "La modalità «Installato dall'appliance» vale solo per LibreNMS";
  }
  return `Modalità non valida per ${component}`;
}

export const CONFERMA_CONVERSIONE_LIBRENMS =
  "Convertire LibreNMS da «Istanza esterna» a «Installato dall'appliance»?\n\n" +
  "Confermalo solo se questo LibreNMS è quello installato dall'appliance su questa macchina. " +
  "Cambia soltanto la modalità: indirizzo, token e grafici restano come sono. " +
  "Dopo, «Istanza esterna» non si potrà più scegliere.";

export type EsitoConversione =
  | { ok: true; da: "external"; a: "appliance" }
  | { ok: false; status: 409; error: string };

/**
 * Se la configurazione attuale si può convertire in `appliance`. Solo da
 * `external` (gli altri modi non hanno niente da convertire) e solo con un
 * indirizzo: senza, «installato dall'appliance» sarebbe una dichiarazione vuota.
 */
export function conversioneInAppliance(cfg: { mode: IntegrationMode; url: string }): EsitoConversione {
  if (cfg.mode === "appliance") {
    return { ok: false, status: 409, error: "LibreNMS è già «Installato dall'appliance»" };
  }
  if (cfg.mode !== "external") {
    return {
      ok: false,
      status: 409,
      error: "Si converte solo una configurazione «Istanza esterna»",
    };
  }
  if (!cfg.url.trim()) {
    return {
      ok: false,
      status: 409,
      error: "LibreNMS non ha un indirizzo: configuralo prima di convertirlo",
    };
  }
  return { ok: true, da: "external", a: "appliance" };
}
