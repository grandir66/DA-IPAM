import { getSetting, setSetting } from "../db-hub";
import { encrypt, safeDecrypt } from "../crypto";
import { isInternalIntegrationUrl } from "./public-url";

// Segreti integrazioni (token/password) cifrati AES-GCM at-rest in hub settings.
const CIPHERTEXT_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;
/** true se `v` è nel formato ciphertext AES-GCM (`iv:tag:enc`). */
export function isCiphertext(v: string): boolean {
  return CIPHERTEXT_RE.test(v);
}
/** Legge un segreto: decifra se cifrato, altrimenti passa il legacy plaintext (pre-cifratura). */
function readSecret(key: string): string {
  const raw = getSetting(key) ?? "";
  if (!raw) return "";
  return isCiphertext(raw) ? (safeDecrypt(raw) ?? "") : raw;
}
/** Scrive un segreto sempre cifrato (vuoto resta vuoto). */
function writeSecret(key: string, val: string): void {
  setSetting(key, val ? encrypt(val) : "");
}
import {
  ensureIntegrationUiUrl,
  resolveIntegrationBrowserUrl,
} from "./public-url-server";
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
  const apiToken = readSecret(`integration_${component}_api_token`);
  const containerName = getSetting(`integration_${component}_container_name`) ?? DEFAULTS[component].containerName ?? "";

  const base: ComponentConfig = {
    mode: modeRaw ?? "disabled",
    url,
    apiToken,
    containerName,
  };

  if (component === "graylog") {
    base.username = getSetting("integration_graylog_username") ?? "admin";
    base.password = readSecret("integration_graylog_password");
  }

  // Password admin salvata dopo installazione managed (librenms, graylog)
  const adminPassword = readSecret(`integration_${component}_admin_password`);
  if (adminPassword) base.adminPassword = adminPassword;

  const uiUrl = getSetting(`integration_${component}_ui_url`) ?? "";
  if (uiUrl) base.uiUrl = uiUrl;

  // Campo derivato — mai usare `url` per link browser se interno.
  base.browserUrl = resolveIntegrationBrowserUrl(component, url);

  return base;
}

export function setIntegrationConfig(component: IntegrationComponent, cfg: Partial<ComponentConfig>): void {
  if (cfg.mode !== undefined) setSetting(`integration_${component}_mode`, cfg.mode);
  if (cfg.url !== undefined) setSetting(`integration_${component}_url`, cfg.url);
  if (cfg.apiToken !== undefined) writeSecret(`integration_${component}_api_token`, cfg.apiToken);
  if (cfg.containerName !== undefined) setSetting(`integration_${component}_container_name`, cfg.containerName);
  if (cfg.adminPassword !== undefined) writeSecret(`integration_${component}_admin_password`, cfg.adminPassword);
  if (cfg.uiUrl !== undefined) {
    const v = cfg.uiUrl.trim();
    // Non persistere URL API/loopback come dashboard browser.
    setSetting(`integration_${component}_ui_url`, v && !isInternalIntegrationUrl(v) ? v : "");
  }
  if (component === "graylog") {
    if (cfg.username !== undefined) setSetting("integration_graylog_username", cfg.username);
    if (cfg.password !== undefined) writeSecret("integration_graylog_password", cfg.password);
  }

  // API loopback/Docker: garantisci ui_url browser (env / nginx / proxy).
  if (cfg.url !== undefined && isInternalIntegrationUrl(cfg.url) && cfg.uiUrl === undefined) {
    ensureIntegrationUiUrl(component, cfg.url);
  }
  // Se l'URL API diventa raggiungibile dal browser, ui_url separato non serve.
  if (cfg.url !== undefined && !isInternalIntegrationUrl(cfg.url) && cfg.uiUrl === undefined) {
    const ui = getSetting(`integration_${component}_ui_url`)?.trim();
    if (ui && isInternalIntegrationUrl(ui)) {
      setSetting(`integration_${component}_ui_url`, "");
    }
  }
}
