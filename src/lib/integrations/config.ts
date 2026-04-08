import { getSetting, setSetting } from "../db-hub";
import type { ComponentConfig, IntegrationComponent, IntegrationMode } from "./types";

const DEFAULTS: Record<IntegrationComponent, ComponentConfig> = {
  librenms: {
    mode: "disabled",
    url: "",
    apiToken: "",
    containerName: "da-librenms",
  },
  loki: {
    mode: "disabled",
    url: "",
    apiToken: "",
    containerName: "da-loki",
  },
  graylog: {
    mode: "disabled",
    url: "",
    apiToken: "",
    username: "admin",
    password: "",
    containerName: "da-graylog",
  },
};

export function getIntegrationConfig(component: IntegrationComponent): ComponentConfig {
  const modeRaw = getSetting(`integration_${component}_mode`) as IntegrationMode | null;
  const url = getSetting(`integration_${component}_url`) ?? "";
  const apiToken = getSetting(`integration_${component}_api_token`) ?? "";
  const containerName = getSetting(`integration_${component}_container_name`) ?? DEFAULTS[component].containerName ?? "";

  const base: ComponentConfig = {
    mode: modeRaw ?? "disabled",
    url,
    apiToken,
    containerName,
  };

  if (component === "graylog") {
    base.username = getSetting("integration_graylog_username") ?? "admin";
    base.password = getSetting("integration_graylog_password") ?? "";
  }

  // Password admin salvata dopo installazione managed (librenms, graylog)
  const adminPassword = getSetting(`integration_${component}_admin_password`) ?? "";
  if (adminPassword) base.adminPassword = adminPassword;

  return base;
}

export function setIntegrationConfig(component: IntegrationComponent, cfg: Partial<ComponentConfig>): void {
  if (cfg.mode !== undefined) setSetting(`integration_${component}_mode`, cfg.mode);
  if (cfg.url !== undefined) setSetting(`integration_${component}_url`, cfg.url);
  if (cfg.apiToken !== undefined) setSetting(`integration_${component}_api_token`, cfg.apiToken);
  if (cfg.containerName !== undefined) setSetting(`integration_${component}_container_name`, cfg.containerName);
  if (cfg.adminPassword !== undefined) setSetting(`integration_${component}_admin_password`, cfg.adminPassword);
  if (component === "graylog") {
    if (cfg.username !== undefined) setSetting("integration_graylog_username", cfg.username);
    if (cfg.password !== undefined) setSetting("integration_graylog_password", cfg.password);
  }
}
