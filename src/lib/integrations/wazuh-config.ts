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

  /**
   * ID delle regole locali degli apparati (MikroTik, firewall, VPN) da
   * raccogliere. Servono perche' quei decoder non emettono gruppi di esito:
   * gli id sono specifici della singola installazione Wazuh, non del prodotto.
   */
  deviceRuleIds: string[];

  // Endpoint di stato delle repliche/archivio immutabile (cruscotto salute,
  // fase 2). Servizio separato dalla Manager API: espone GET /status con
  // bearer token dedicato. TLS opzionale con SPKI pinning (TOFU), come lo
  // scanner-edge.
  immutableStoreUrl: string;              // es. https://da-wazuh.domarc.it:9100
  immutableStoreToken: string;            // plaintext lato applicativo, cifrato a riposo
  immutableStoreCertPin: string | null;   // sha256/<base64>, null = nessun pinning
}

const KEY_ENABLED       = "integration_wazuh_enabled";
const KEY_URL           = "integration_wazuh_url";
const KEY_USERNAME      = "integration_wazuh_username";
const KEY_PASSWORD      = "integration_wazuh_password_encrypted";
const KEY_VERIFY_TLS    = "integration_wazuh_verify_tls";
const KEY_IDX_URL       = "integration_wazuh_indexer_url";
const KEY_IDX_USERNAME  = "integration_wazuh_indexer_username";
const KEY_IDX_PASSWORD  = "integration_wazuh_indexer_password_encrypted";
const KEY_DEVICE_RULES  = "integration_wazuh_device_rule_ids";
const KEY_IMMUTABLE_URL      = "integration_immutable_store_url";
const KEY_IMMUTABLE_TOKEN    = "integration_immutable_store_token_encrypted";
const KEY_IMMUTABLE_CERT_PIN = "integration_immutable_store_cert_pin";

export function getWazuhConfig(): WazuhConfig {
  const passwordEnc = getSetting(KEY_PASSWORD);
  const idxPasswordEnc = getSetting(KEY_IDX_PASSWORD);
  const immutableTokenEnc = getSetting(KEY_IMMUTABLE_TOKEN);
  return {
    enabled:         getSetting(KEY_ENABLED) === "1",
    url:             getSetting(KEY_URL) ?? "",
    username:        getSetting(KEY_USERNAME) ?? "",
    password:        passwordEnc ? (safeDecrypt(passwordEnc) ?? "") : "",
    verifyTls:       getSetting(KEY_VERIFY_TLS) === "1",
    indexerUrl:      getSetting(KEY_IDX_URL) ?? "",
    indexerUsername: getSetting(KEY_IDX_USERNAME) ?? "",
    indexerPassword: idxPasswordEnc ? (safeDecrypt(idxPasswordEnc) ?? "") : "",
    deviceRuleIds: (getSetting(KEY_DEVICE_RULES) ?? "")
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter(Boolean),
    immutableStoreUrl:     getSetting(KEY_IMMUTABLE_URL) ?? "",
    immutableStoreToken:   immutableTokenEnc ? (safeDecrypt(immutableTokenEnc) ?? "") : "",
    immutableStoreCertPin: getSetting(KEY_IMMUTABLE_CERT_PIN) ?? null,
  };
}

export function setWazuhConfig(cfg: Partial<WazuhConfig>): void {
  if (cfg.deviceRuleIds !== undefined) {
    setSetting(KEY_DEVICE_RULES, cfg.deviceRuleIds.join(","));
  }
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
  if (cfg.immutableStoreUrl !== undefined) setSetting(KEY_IMMUTABLE_URL, cfg.immutableStoreUrl.trim());
  if (cfg.immutableStoreToken !== undefined && cfg.immutableStoreToken !== "") {
    setSetting(KEY_IMMUTABLE_TOKEN, encrypt(cfg.immutableStoreToken));
  }
  if (cfg.immutableStoreCertPin !== undefined) {
    setSetting(KEY_IMMUTABLE_CERT_PIN, cfg.immutableStoreCertPin ?? "");
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

/** Versione safe per UI: non espone le password decifrate ne' il token. */
export function getWazuhConfigPublic(): Omit<WazuhConfig, "password" | "indexerPassword" | "immutableStoreToken"> & {
  passwordSet: boolean;
  indexerPasswordSet: boolean;
  immutableStoreTokenSet: boolean;
} {
  const { password, indexerPassword, immutableStoreToken, ...rest } = getWazuhConfig();
  return {
    ...rest,
    passwordSet: password.length > 0,
    indexerPasswordSet: indexerPassword.length > 0,
    immutableStoreTokenSet: immutableStoreToken.length > 0,
  };
}
