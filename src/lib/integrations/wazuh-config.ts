/**
 * Configurazione integrazione Wazuh (hub-level).
 *
 * Wazuh è singolo per il deployment Domarc (da-wazuh.domarc.it). Tutti i tenant
 * vedono solo i propri agent dopo il matching ip/mac/hostname nel sync.
 *
 * Credenziali: utente RBAC read-only creato in dashboard Wazuh ("da-ipam").
 * Password cifrata AES-GCM via lib/crypto.ts.
 */
import { getSetting, setSetting } from "../db-hub";
import { encrypt, safeDecrypt } from "../crypto";

export interface WazuhConfig {
  enabled: boolean;
  url: string;          // es. https://da-wazuh.domarc.it:55000
  username: string;     // utente RBAC read-only
  password: string;     // plaintext lato applicativo, cifrato a riposo
  verifyTls: boolean;   // false se cert self-signed
}

const KEY_ENABLED    = "integration_wazuh_enabled";
const KEY_URL        = "integration_wazuh_url";
const KEY_USERNAME   = "integration_wazuh_username";
const KEY_PASSWORD   = "integration_wazuh_password_encrypted";
const KEY_VERIFY_TLS = "integration_wazuh_verify_tls";

export function getWazuhConfig(): WazuhConfig {
  const passwordEnc = getSetting(KEY_PASSWORD);
  const password = passwordEnc ? (safeDecrypt(passwordEnc) ?? "") : "";
  return {
    enabled:   getSetting(KEY_ENABLED) === "1",
    url:       getSetting(KEY_URL) ?? "",
    username:  getSetting(KEY_USERNAME) ?? "",
    password,
    verifyTls: getSetting(KEY_VERIFY_TLS) === "1",
  };
}

export function setWazuhConfig(cfg: Partial<WazuhConfig>): void {
  if (cfg.enabled !== undefined)   setSetting(KEY_ENABLED, cfg.enabled ? "1" : "0");
  if (cfg.url !== undefined)       setSetting(KEY_URL, cfg.url.trim());
  if (cfg.username !== undefined)  setSetting(KEY_USERNAME, cfg.username.trim());
  if (cfg.password !== undefined && cfg.password !== "") {
    setSetting(KEY_PASSWORD, encrypt(cfg.password));
  }
  if (cfg.verifyTls !== undefined) setSetting(KEY_VERIFY_TLS, cfg.verifyTls ? "1" : "0");
}

export function isWazuhConfigured(): boolean {
  const cfg = getWazuhConfig();
  return Boolean(cfg.enabled && cfg.url && cfg.username && cfg.password);
}

/** Versione safe per UI: non espone la password decifrata. */
export function getWazuhConfigPublic(): Omit<WazuhConfig, "password"> & { passwordSet: boolean } {
  const { password, ...rest } = getWazuhConfig();
  return { ...rest, passwordSet: password.length > 0 };
}
