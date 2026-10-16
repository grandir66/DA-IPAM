import type { ModuleKey } from "./registry";

/**
 * Testo del pulsante che, nella griglia dei moduli, apre l'interfaccia web
 * PROPRIA di un modulo (`externalUiUrl`), accanto ad «Apri» che porta alla
 * pagina di DA-IPAM.
 *
 * UI-24 (piano di miglioramento, tappa 1, 2026-10-12): il pulsante diceva
 * sempre «Interfaccia edge — scan, reti, Greenbone», anche sul riquadro di
 * MeshCentral, dove apre la console di MeshCentral. Il testo deve dire cosa
 * si apre davvero, quindi dipende dal modulo.
 */
export interface ExternalUiText {
  /** Etichetta del pulsante. */
  label: string;
  /** Suggerimento al passaggio del mouse: cosa si apre e dove. */
  title: string;
}

const TEXTS: Partial<Record<ModuleKey, ExternalUiText>> = {
  edge: {
    label: "Interfaccia edge",
    title: "Apri in una nuova scheda l'interfaccia web completa dello Scanner-Edge (scan, reti, Greenbone)",
  },
  meshcentral: {
    label: "Console MeshCentral",
    title: "Apri in una nuova scheda la console web di MeshCentral (dispositivi, agenti, controllo remoto)",
  },
};

/**
 * @param key   chiave del modulo
 * @param name  nome del modulo da mostrare quando non c'è un testo dedicato
 */
export function externalUiText(key: ModuleKey | string, name: string): ExternalUiText {
  const known = TEXTS[key as ModuleKey];
  if (known) return known;
  return {
    label: `Interfaccia ${name}`,
    title: `Apri in una nuova scheda l'interfaccia web di ${name}`,
  };
}
