export type IntegrationComponent = "librenms" | "loki" | "graylog";

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

export interface InstallJob {
  id: string;
  component: IntegrationComponent;
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
  /** solo per graylog */
  username?: string;
  password?: string;
  /** nome container Docker (se managed) */
  containerName?: string;
}

export interface IntegrationStatus {
  component: IntegrationComponent;
  mode: IntegrationMode;
  containerStatus?: ContainerStatus;
  configured: boolean;
  reachable?: boolean;
}
