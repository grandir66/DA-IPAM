/**
 * Decisioni di permesso pure, senza sessione né database (T3-25).
 *
 * Le rotte leggono il ruolo dalla sessione e chiedono qui: chi arriva almeno a
 * un livello, chi vede i segreti, come si maschera una configurazione per chi
 * non li vede. Un ruolo sconosciuto non arriva a nessun livello (si chiude).
 * Prove: `__tests__/politica.test.ts`.
 */
import { isUserRole, type UserRole } from "../users/permissions";
import type { ComponentConfig } from "../integrations/types";

const ORDINE: Record<UserRole, number> = { viewer: 0, admin: 1, superadmin: 2 };

/** Vero se il ruolo è conosciuto e almeno pari a `minimo`. */
export function livelloAlmeno(ruolo: unknown, minimo: UserRole): boolean {
  return isUserRole(ruolo) && ORDINE[ruolo] >= ORDINE[minimo];
}

/** Token, password e chiavi delle configurazioni si mostrano solo agli admin. */
export function puoVedereSegreti(ruolo: unknown): boolean {
  return livelloAlmeno(ruolo, "admin");
}

/** Campi di `ComponentConfig` che contengono un segreto. */
export const CAMPI_SEGRETI_INTEGRAZIONE = ["apiToken", "password", "adminPassword"] as const;

type CampoSegreto = (typeof CAMPI_SEGRETI_INTEGRAZIONE)[number];

/** Configurazione restituita al browser: per chi non vede i segreti, valori vuoti e flag «impostato». */
export type ConfigIntegrazioneVista = ComponentConfig & Partial<Record<`${CampoSegreto}Set`, boolean>>;

/**
 * Configurazione di un'integrazione per chi la legge. Con `vedeSegreti` la
 * restituisce invariata; altrimenti svuota i campi segreti e dice solo se sono
 * impostati, così la card mostra «configurato» senza ricevere il valore.
 */
export function mascheraConfigIntegrazione(cfg: ComponentConfig, vedeSegreti: boolean): ConfigIntegrazioneVista {
  if (vedeSegreti) return cfg;
  const out: ConfigIntegrazioneVista = { ...cfg };
  for (const campo of CAMPI_SEGRETI_INTEGRAZIONE) {
    out[`${campo}Set`] = !!cfg[campo];
    out[campo] = "";
  }
  return out;
}
