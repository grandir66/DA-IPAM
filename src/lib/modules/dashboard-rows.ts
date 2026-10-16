/**
 * Dove porta una riga «Stato moduli» della dashboard, e cosa dice quando il
 * modulo non è attivo.
 *
 * UI-20 (piano di miglioramento, tappa 1, 12/10): prima ogni riga apriva la
 * configurazione (configHref), anche per un modulo attivo con la sua pagina, e
 * un modulo mai installato mostrava «Mai eseguita». Regola:
 *   - attivo e configurato → la sua pagina in DA-IPAM (accesso nativo),
 *     anche con la sonda in errore: le pagine native lavorano sui dati locali
 *     (findings importati, nodi in cache) e lì l'errore si vede;
 *   - attivo, configurato e con interfaccia esterna → il Launchpad, ma solo se
 *     non è in errore: il Launchpad nasconde i moduli in errore
 *     (isModuleLaunchable), quindi lì non lo si troverebbe;
 *   - non installato, non configurato o spento, esterno in errore, o senza
 *     una pagina da aprire → la sua card in Impostazioni → Moduli, con una
 *     nota quando il modulo non è attivo.
 * Un modulo non installato resta fuori dal conteggio «in errore» della card:
 * la sonda di MeshCentral, per esempio, gira anche dopo la disinstallazione
 * (i parametri di collegamento restano) e un suo errore non è un guasto.
 *
 * Parte pura: la dashboard le passa descrittore, stato (resolveModules) e
 * salute (getModulesHealth). Prove: __tests__/dashboard-rows.test.ts.
 */
import type { ModuleDescriptor, ModuleState } from "./registry";
import type { ModuleHealth } from "./health";
import { isModuleLaunchable } from "./launchable";

export const MODULI_CONFIG_HREF = "/settings?tab=moduli";
export const LAUNCHPAD_HREF = "/launchpad";
export const NOTA_NON_VERIFICATO = "Locale, non verificato";

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
  /**
   * La riga entra nel conteggio «in errore / da verificare» della card e
   * mostra l'icona di stato. false solo per un modulo non installato.
   */
  contaNegliErrori: boolean;
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
    contaNegliErrori: true,
  };
  // Nessuno stato nel registry (es. «Sistema appliance», che è solo una sonda):
  // si resta sulla configurazione, senza note.
  if (!state) return config;

  if (!state.installed) {
    return { ...config, notaStato: "Modulo non attivo", contaNegliErrori: false };
  }
  if (!state.configured) return { ...config, notaStato: "Modulo non attivo: da configurare" };
  if (!state.enabled) return { ...config, notaStato: "Modulo disattivato" };

  // Attivo ma senza niente da sondare (Patch Management, passo 4 del 16/10): la
  // colonna dell'ora lo dice, invece di «Mai eseguita».
  const notaStato = health?.verdict === "unverified" ? NOTA_NON_VERIFICATO : null;

  if (!state.uiUrl) return { ...config, notaStato };

  if (state.access === "external" || !state.uiIsInternal) {
    if (!isModuleLaunchable(state, health)) return { ...config, notaStato };
    return { href: LAUNCHPAD_HREF, apre: "launchpad", notaStato, contaNegliErrori: true };
  }
  return { href: state.uiUrl, apre: "modulo", notaStato, contaNegliErrori: true };
}
