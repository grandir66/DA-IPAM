/**
 * Dove porta una riga «Stato moduli» della dashboard, e cosa dice quando il
 * modulo non è attivo.
 *
 * UI-20 (piano di miglioramento, tappa 1, 12/10): prima ogni riga apriva la
 * configurazione (configHref), anche per un modulo attivo con la sua pagina, e
 * un modulo mai installato mostrava «Mai eseguita». Regola:
 *   - attivo, configurato e apribile → la sua pagina in DA-IPAM (accesso
 *     nativo) o il Launchpad (interfaccia esterna);
 *   - non installato, non configurato o spento → la sua card in
 *     Impostazioni → Moduli, con una nota che lo dice;
 *   - attivo ma in errore, o senza una pagina da aprire → la configurazione,
 *     dove si vede l'errore: il Launchpad nasconde i moduli in errore
 *     (isModuleLaunchable), quindi lì non lo si troverebbe.
 *
 * Parte pura: la dashboard le passa descrittore, stato (resolveModules) e
 * salute (getModulesHealth). Prove: __tests__/dashboard-rows.test.ts.
 */
import type { ModuleDescriptor, ModuleState } from "./registry";
import type { ModuleHealth } from "./health";
import { isModuleLaunchable } from "./launchable";

export const MODULI_CONFIG_HREF = "/settings?tab=moduli";
export const LAUNCHPAD_HREF = "/launchpad";

export interface DestinazioneRigaModulo {
  href: string;
  /** Cosa apre la riga: serve al titolo del link. */
  apre: "modulo" | "launchpad" | "configurazione";
  /**
   * Testo per la colonna dell'ora quando il modulo non è attivo; null = il
   * modulo è attivo (o non ha stato nel registry) e la colonna mostra l'ora
   * dell'ultima verifica.
   */
  notaStato: string | null;
}

export function moduleRowTarget(
  desc: ModuleDescriptor | undefined,
  state: ModuleState | undefined,
  health: ModuleHealth | undefined,
): DestinazioneRigaModulo {
  const config: DestinazioneRigaModulo = {
    href: desc?.configHref ?? MODULI_CONFIG_HREF,
    apre: "configurazione",
    notaStato: null,
  };
  // Nessuno stato nel registry (es. «Sistema appliance», che è solo una sonda):
  // si resta sulla configurazione, senza note.
  if (!state) return config;

  if (!state.installed) return { ...config, notaStato: "Modulo non attivo" };
  if (!state.configured) return { ...config, notaStato: "Modulo non attivo: da configurare" };
  if (!state.enabled) return { ...config, notaStato: "Modulo disattivato" };

  if (!isModuleLaunchable(state, health) || !state.uiUrl) return config;

  if (state.access === "external" || !state.uiIsInternal) {
    return { href: LAUNCHPAD_HREF, apre: "launchpad", notaStato: null };
  }
  return { href: state.uiUrl, apre: "modulo", notaStato: null };
}
