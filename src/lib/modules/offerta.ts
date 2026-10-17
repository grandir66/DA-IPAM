import type { ModuleKey } from "./registry";
import type { ModuleHealthVerdict } from "./health";

/**
 * Offerta commerciale dei moduli (passo 4c del piano di solidità, 16/10).
 *
 * - `base`: parte del prodotto, sempre compresa (LibreNMS è integrato, non un'opzione);
 * - `opzione`: modulo opzionale, potenzialmente a pagamento.
 *
 * Opzioni decise da Riccardo il 16/10: MDM, Patch/Chocolatey, MeshCentral, Wazuh,
 * Zabbix. MDM non ha una voce nel catalogo dei moduli (`MODULE_DESCRIPTORS`): non se
 * ne inventa una qui; quando l'avrà, nascerà come `opzione`.
 *
 * Il pannello Zabbix in sola lettura (passo 7.4) è un'opzione **fuori dal catalogo**
 * (`OFFERTA_PANNELLO_ZABBIX`): una voce nel catalogo entrerebbe nei moduli e nella
 * salute del segnale verso DA-Link, che il proxy Zabbix lo conosce già come `zbx`.
 *
 * Pura e senza import lato server: la usano il registry, i componenti client
 * (griglia della Launchpad, tab «Moduli») e le prove.
 */
export type Offerta = "base" | "opzione";

/** Offerta di ogni voce del catalogo. `Record` completo: una voce nuova deve dichiararla. */
export const OFFERTA_MODULO: Readonly<Record<ModuleKey, Offerta>> = {
  edge: "base",
  patch_management: "opzione",
  network_services: "base",
  librenms: "base",
  graylog: "base",
  wazuh: "opzione",
  meshcentral: "opzione",
  inventory_agent: "base",
  nis2_inventory: "base",
  unifi: "base",
  appliance: "base",
};

/** Il pannello Zabbix in sola lettura: opzione, fuori dal catalogo dei moduli. */
export const OFFERTA_PANNELLO_ZABBIX: Offerta = "opzione";

/** Le opzioni che hanno un diritto: le voci del catalogo più il pannello Zabbix. */
export type ChiaveOpzione = ModuleKey | "zabbix";

/** Etichetta mostrata accanto al nome di un modulo opzionale. */
export const ETICHETTA_OPZIONE = "Opzione";

/**
 * Come si presenta un modulo opzionale:
 * non acquistato · acquistato da configurare · spento · attivo · guasto.
 */
export type StatoOfferta = "non_acquistato" | "da_configurare" | "spento" | "attivo" | "guasto";

export const ETICHETTA_STATO_OFFERTA: Readonly<Record<StatoOfferta, string>> = {
  non_acquistato: "Non acquistato",
  da_configurare: "Acquistato, da configurare",
  spento: "Spento",
  attivo: "Attivo",
  guasto: "Guasto",
};

/**
 * Il diritto a un modulo opzionale. La fonte sarà la licenza consegnata da
 * DA-Link (tappa B), che oggi non esiste: fino ad allora **ogni opzione vale come
 * acquistata**, così nessuna installazione esistente (hub, cliente A, pilota)
 * perde un modulo o cambia comportamento. Non leggere qui impostazioni o variabili
 * d'ambiente per «simulare» la licenza: un `false` per sbaglio spegnerebbe un
 * modulo in uso.
 */
export function opzioneAcquistata(key: ChiaveOpzione): boolean {
  void key;
  return true;
}

export interface IngressoStatoOfferta {
  /** Diritto al modulo (oggi sempre true: vedi `opzioneAcquistata`). */
  acquistato: boolean;
  /** Configurazione minima presente (`ModuleState.configured`). */
  configured: boolean;
  /** Acceso adesso (`ModuleState.enabled`). */
  enabled: boolean;
  /** Verdetto di salute, se la sonda ha già risposto. */
  verdict?: ModuleHealthVerdict | null;
}

/**
 * Stato di presentazione di un modulo opzionale. Solo presentazione: non blocca
 * niente e non decide se un modulo gira.
 *
 * Ordine: senza diritto → «non acquistato» (prima di tutto: un'opzione non
 * acquistata non deve mostrare errori di salute); un `fail` → «guasto» (anche
 * acceso a metà, come vuole la salute del passo 4); senza configurazione → «da
 * configurare»; spento o `off` → «spento»; il resto (ok, degradato, locale non
 * verificato, salute non ancora arrivata) → «attivo».
 */
export function statoOfferta(i: IngressoStatoOfferta): StatoOfferta {
  if (!i.acquistato) return "non_acquistato";
  if (i.verdict === "fail") return "guasto";
  if (!i.configured) return "da_configurare";
  if (!i.enabled || i.verdict === "off") return "spento";
  return "attivo";
}
