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

/**
 * L'accesso automatico alle interfacce collegate (LibreNMS) entra con la
 * password admin salvata nell'hub: solo per chi è almeno admin (T3-26, SEC-6).
 */
export function puoUsareAccessoAutomatico(ruolo: unknown): boolean {
  return livelloAlmeno(ruolo, "admin");
}

/**
 * Chiavi della tabella `settings` dell'hub che contengono un segreto: password,
 * token, chiavi, valori cifrati. Si decide dal nome, e nel dubbio si nasconde:
 * le pagine aperte ai viewer leggono solo chiavi che qui non rientrano
 * (prova: `__tests__/impostazioni-viewer.test.ts`).
 */
const IMPOSTAZIONE_SEGRETA = /(password|secret|token|_key$|_key_|_pat$|_pat_|encrypted|_auth$|_auth_)/i;

export function eImpostazioneSegreta(chiave: string): boolean {
  return IMPOSTAZIONE_SEGRETA.test(chiave);
}

/** Chiave aggiunta alla vista di chi non è admin: quante chiavi segrete sono state tolte. */
export const CHIAVE_SEGRETI_NASCOSTI = "_segreti_nascosti";

/**
 * Impostazioni dell'hub per chi le legge (SEC-5): l'admin le riceve tutte; gli
 * altri senza le chiavi segrete, col conteggio di quelle tolte. Il conteggio
 * dice alla verifica dal di fuori che la maschera è passata anche dove non
 * c'erano segreti da togliere.
 */
export function impostazioniPerRuolo(impostazioni: Record<string, string>, vedeSegreti: boolean): Record<string, string> {
  if (vedeSegreti) return impostazioni;
  const out: Record<string, string> = {};
  let tolte = 0;
  for (const [k, v] of Object.entries(impostazioni)) {
    if (eImpostazioneSegreta(k)) tolte++;
    else out[k] = v;
  }
  out[CHIAVE_SEGRETI_NASCOSTI] = String(tolte);
  return out;
}
