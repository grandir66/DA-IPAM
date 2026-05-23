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
  url: string;          // es. https://da-wazuh.domarc.it:55000  (Manager REST API)
  username: string;     // utente RBAC read-only (es. "da-ipam")
  password: string;     // plaintext lato applicativo, cifrato a riposo
  verifyTls: boolean;   // false se cert self-signed

  // OpenSearch (indexer) — fonte CVE in Wazuh 4.8+. Bound spesso su 127.0.0.1.
  indexerUrl: string;       // es. https://da-wazuh.domarc.it:9200
  indexerUsername: string;  // utente OS read-only (es. "da-ipam-os")
  indexerPassword: string;  // plaintext lato applicativo, cifrato a riposo
}

const KEY_ENABLED       = "integration_wazuh_enabled";
const KEY_URL           = "integration_wazuh_url";
const KEY_USERNAME      = "integration_wazuh_username";
const KEY_PASSWORD      = "integration_wazuh_password_encrypted";
const KEY_VERIFY_TLS    = "integration_wazuh_verify_tls";
const KEY_IDX_URL       = "integration_wazuh_indexer_url";
const KEY_IDX_USERNAME  = "integration_wazuh_indexer_username";
const KEY_IDX_PASSWORD  = "integration_wazuh_indexer_password_encrypted";

export function getWazuhConfig(): WazuhConfig {
  const passwordEnc = getSetting(KEY_PASSWORD);
  const idxPasswordEnc = getSetting(KEY_IDX_PASSWORD);
  return {
    enabled:         getSetting(KEY_ENABLED) === "1",
    url:             getSetting(KEY_URL) ?? "",
    username:        getSetting(KEY_USERNAME) ?? "",
    password:        passwordEnc ? (safeDecrypt(passwordEnc) ?? "") : "",
    verifyTls:       getSetting(KEY_VERIFY_TLS) === "1",
    indexerUrl:      getSetting(KEY_IDX_URL) ?? "",
    indexerUsername: getSetting(KEY_IDX_USERNAME) ?? "",
    indexerPassword: idxPasswordEnc ? (safeDecrypt(idxPasswordEnc) ?? "") : "",
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
  if (cfg.indexerUrl !== undefined)      setSetting(KEY_IDX_URL, cfg.indexerUrl.trim());
  if (cfg.indexerUsername !== undefined) setSetting(KEY_IDX_USERNAME, cfg.indexerUsername.trim());
  if (cfg.indexerPassword !== undefined && cfg.indexerPassword !== "") {
    setSetting(KEY_IDX_PASSWORD, encrypt(cfg.indexerPassword));
  }
}

export function isWazuhConfigured(): boolean {
  const cfg = getWazuhConfig();
  return Boolean(cfg.enabled && cfg.url && cfg.username && cfg.password);
}

export function isWazuhIndexerConfigured(): boolean {
  const cfg = getWazuhConfig();
  return Boolean(cfg.indexerUrl && cfg.indexerUsername && cfg.indexerPassword);
}

/** Versione safe per UI: non espone le password decifrate. */
export function getWazuhConfigPublic(): Omit<WazuhConfig, "password" | "indexerPassword"> & {
  passwordSet: boolean;
  indexerPasswordSet: boolean;
} {
  const { password, indexerPassword, ...rest } = getWazuhConfig();
  return {
    ...rest,
    passwordSet: password.length > 0,
    indexerPasswordSet: indexerPassword.length > 0,
  };
}
