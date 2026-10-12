import { getSetting, setSetting } from "../db-hub";
import { encrypt, safeDecrypt } from "../crypto";
import { isInternalIntegrationUrl } from "./public-url";
import { normalizeSpkiPin } from "./wazuh-config";

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
import type {
  ComponentConfig,
  IntegrationComponent,
  IntegrationMode,
  UnifiCertPinStore,
  UnifiKind,
} from "./types";

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
  // Nessun container: il controller sta dal cliente. Nasce spento.
  unifi: {
    mode: "disabled",
    url: "",
    apiToken: "",
    kind: "self_hosted",
    site: "default",
    username: "",
    password: "",
  },
};

// ── UniFi ────────────────────────────────────────────────────────────────────

const UNIFI_KINDS: readonly UnifiKind[] = ["self_hosted", "udm", "cloud"];
const KEY_UNIFI_CERT_PIN = "integration_unifi_cert_pin";

function parseUnifiKind(raw: string | null | undefined): UnifiKind {
  return UNIFI_KINDS.includes(raw as UnifiKind) ? (raw as UnifiKind) : "self_hosted";
}

/** Schema+host+porta di un URL, per capire se si sta puntando a un altro controller. */
function urlOrigin(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  try {
    return new URL(v).origin.toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

/**
 * Impronta del certificato del controller UniFi, chiave dedicata
 * `integration_unifi_cert_pin`. La scrive il client al primo collegamento
 * riuscito; dopo, un certificato diverso è un errore esplicito. Rinnovarla
 * (`clear`, oppure `set` dell'impronta nuova mostrata dall'errore) è
 * un'azione esplicita dell'amministratore, mai un effetto collaterale.
 */
export const unifiCertPinStore: UnifiCertPinStore = {
  get: () => normalizeSpkiPin(getSetting(KEY_UNIFI_CERT_PIN) ?? "") || null,
  set: (pin: string) => setSetting(KEY_UNIFI_CERT_PIN, normalizeSpkiPin(pin)),
  clear: () => setSetting(KEY_UNIFI_CERT_PIN, ""),
};

function readUnifiConfig(base: ComponentConfig): ComponentConfig {
  // Fail-closed: UniFi non ha modalità gestita; un valore vuoto o inatteso
  // nel DB vale "spento", mai "acceso per sbaglio".
  base.mode = base.mode === "external" ? "external" : "disabled";
  base.kind = parseUnifiKind(getSetting("integration_unifi_kind"));
  base.site = getSetting("integration_unifi_site")?.trim() || "default";
  base.username = getSetting("integration_unifi_username") ?? "";
  base.password = readSecret("integration_unifi_password");
  const pin = unifiCertPinStore.get();
  if (pin) base.certPin = pin;
  // Il controller è già un indirizzo da browser: i ui_url derivati servono
  // ai container interni (librenms/graylog/loki), non qui.
  base.browserUrl = /^https?:\/\//i.test(base.url) ? base.url.replace(/\/+$/, "") : "";
  return base;
}

function writeUnifiConfig(cfg: Partial<ComponentConfig>): void {
  if (cfg.mode !== undefined) setSetting("integration_unifi_mode", cfg.mode);
  if (cfg.url !== undefined) {
    const next = cfg.url.trim();
    const prev = getSetting("integration_unifi_url") ?? "";
    // Il pin vale per UN controller: un indirizzo nuovo è un primo uso nuovo,
    // altrimenti il controller giusto verrebbe rifiutato come "cambiato".
    if (urlOrigin(prev) !== urlOrigin(next)) unifiCertPinStore.clear();
    setSetting("integration_unifi_url", next);
  }
  if (cfg.kind !== undefined) setSetting("integration_unifi_kind", parseUnifiKind(cfg.kind));
  if (cfg.site !== undefined) setSetting("integration_unifi_site", cfg.site.trim());
  if (cfg.username !== undefined) setSetting("integration_unifi_username", cfg.username.trim());
  // Segreti in sola scrittura (il GET non li restituisce): un campo vuoto dal
  // modulo vuol dire "non cambiare", non "cancella".
  if (cfg.password !== undefined && cfg.password.trim() !== "") {
    writeSecret("integration_unifi_password", cfg.password);
  }
  if (cfg.apiToken !== undefined && cfg.apiToken.trim() !== "") {
    writeSecret("integration_unifi_api_token", cfg.apiToken.trim());
  }
}

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

  if (component === "unifi") return readUnifiConfig(base);

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
  if (component === "unifi") {
    writeUnifiConfig(cfg);
    return;
  }
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
