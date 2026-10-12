/** Integrazioni con un container Docker gestibile (install/action/logs). */
export type ContainerIntegrationComponent = "librenms" | "loki" | "graylog";

/**
 * Tutte le integrazioni con configurazione hub `integration_<nome>_*`.
 * `unifi` non ha container: il controller sta dal cliente e si legge via API.
 */
export type IntegrationComponent = ContainerIntegrationComponent | "unifi";

/** Famiglia del controller UniFi: sceglie autenticazione e percorsi API. */
export type UnifiKind = "self_hosted" | "udm" | "cloud";

/** "managed" = Docker locale gestito da DA-INVENT; "external" = istanza esterna configurata manualmente */
export type IntegrationMode = "managed" | "external" | "disabled";

export interface ContainerStatus {
  running: boolean;
  name: string;
  image: string;
  uptime?: string;
  health?: string;
}

export type InstallPhase =
  | "idle"
  | "pulling"
  | "creating"
  | "starting"
  | "waiting"
  | "done"
  | "error";

/**
 * Cosa sta installando un job. PIU' AMPIO di IntegrationComponent, che descrive
 * i soli container della pagina Integrazioni (con mode/url/apiToken): docker e
 * meshcentral hanno un ciclo di vita proprio ma usano lo stesso job-store.
 * Prima di questo tipo, install-docker era costretto a dichiararsi "librenms"
 * come placeholder — un falso che rendeva impossibile distinguere i job.
 */
export type JobComponent = IntegrationComponent | "docker" | "meshcentral";

export interface InstallJob {
  id: string;
  component: JobComponent;
  phase: InstallPhase;
  log: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ComponentConfig {
  mode: IntegrationMode;
  url: string;
  apiToken: string;
  /** graylog external e unifi self_hosted */
  username?: string;
  password?: string;
  /** solo unifi: famiglia del controller (default self_hosted) */
  kind?: UnifiKind;
  /** solo unifi: nome interno del site (es. "default") */
  site?: string;
  /**
   * solo unifi: impronta SPKI del certificato del controller, fissata al primo
   * collegamento riuscito. In sola lettura: il PUT generico non la scrive,
   * il rinnovo è un'azione esplicita (`unifiCertPinStore` in config.ts).
   */
  certPin?: string;
  /** password admin salvata dopo l'installazione managed (librenms, graylog) */
  adminPassword?: string;
  /** URL dashboard browser (nginx LAN / proxy). Distinto dall'URL API interno. */
  uiUrl?: string;
  /** Risolto a runtime — usare per link "Apri dashboard", mai `url` se interno. */
  browserUrl?: string;
  /** nome container Docker (se managed) */
  containerName?: string;
}

/**
 * Dove sta l'impronta del certificato del controller UniFi (hub settings in
 * produzione, un oggetto in memoria nelle prove). Le impronte sono nella
 * forma canonica `sha256/<base64>` di `spkiPinFromDer`.
 */
export interface UnifiCertPinStore {
  get(): string | null;
  set(pin: string): void;
  clear(): void;
  /**
   * true se la configurazione punta ancora al controller di `origin`
   * (schema+host+porta). Il client lo chiede prima di salvare l'impronta del
   * primo uso: una sessione partita prima di un cambio d'indirizzo non fissa
   * il certificato del vecchio controller sul nuovo. Assente = nessun vincolo
   * (store in memoria, store in sola lettura della sonda).
   */
  matchesOrigin?(origin: string): boolean;
}

export interface IntegrationStatus {
  component: IntegrationComponent;
  mode: IntegrationMode;
  containerStatus?: ContainerStatus;
  configured: boolean;
  reachable?: boolean;
}
