/**
 * Configurazione del motore di notifica (hub-level, come wazuh-config).
 * Password e header di autenticazione cifrati AES-GCM via lib/crypto.
 */
import { getSetting, setSetting } from "../db-hub";
import { encrypt, safeDecrypt } from "../crypto";
import { DEFAULT_POLICY, type NotifyPolicy } from "./policy";

export const DEFAULT_RETENTION_DAYS = 30;

export interface NotificationConfig {
  enabled: boolean;

  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  /** true = TLS implicito (465); false = STARTTLS/plain (587/25). */
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  /** Destinatari separati da virgola. */
  smtpTo: string;

  webhookEnabled: boolean;
  webhookUrl: string;
  /** Valore completo dell'header Authorization, se il target lo richiede. */
  webhookAuthHeader: string;

  policy: NotifyPolicy;
  retentionDays: number;
}

const K = {
  enabled: "notify_enabled",
  smtpEnabled: "notify_smtp_enabled",
  smtpHost: "notify_smtp_host",
  smtpPort: "notify_smtp_port",
  smtpSecure: "notify_smtp_secure",
  smtpUser: "notify_smtp_user",
  smtpPassword: "notify_smtp_password_encrypted",
  smtpFrom: "notify_smtp_from",
  smtpTo: "notify_smtp_to",
  webhookEnabled: "notify_webhook_enabled",
  webhookUrl: "notify_webhook_url",
  webhookAuth: "notify_webhook_auth_encrypted",
  immediateCategories: "notify_immediate_categories",
  immediateMinLevel: "notify_immediate_min_level",
  digestIntervalMinutes: "notify_digest_interval_minutes",
  retentionDays: "notify_retention_days",
} as const;

function intSetting(key: string, fallback: number): number {
  const raw = getSetting(key);
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function getNotificationConfig(): NotificationConfig {
  const pwdEnc = getSetting(K.smtpPassword);
  const authEnc = getSetting(K.webhookAuth);
  const cats = getSetting(K.immediateCategories);
  return {
    enabled: getSetting(K.enabled) === "1",

    smtpEnabled: getSetting(K.smtpEnabled) === "1",
    smtpHost: getSetting(K.smtpHost) ?? "",
    smtpPort: intSetting(K.smtpPort, 587),
    smtpSecure: getSetting(K.smtpSecure) === "1",
    smtpUser: getSetting(K.smtpUser) ?? "",
    smtpPassword: pwdEnc ? (safeDecrypt(pwdEnc) ?? "") : "",
    smtpFrom: getSetting(K.smtpFrom) ?? "",
    smtpTo: getSetting(K.smtpTo) ?? "",

    webhookEnabled: getSetting(K.webhookEnabled) === "1",
    webhookUrl: getSetting(K.webhookUrl) ?? "",
    webhookAuthHeader: authEnc ? (safeDecrypt(authEnc) ?? "") : "",

    policy: {
      immediateCategories:
        cats != null && cats !== ""
          ? cats.split(",").map((s) => s.trim()).filter(Boolean)
          : DEFAULT_POLICY.immediateCategories,
      immediateMinLevel: intSetting(K.immediateMinLevel, DEFAULT_POLICY.immediateMinLevel),
      digestIntervalMinutes: intSetting(
        K.digestIntervalMinutes,
        DEFAULT_POLICY.digestIntervalMinutes,
      ),
    },
    retentionDays: intSetting(K.retentionDays, DEFAULT_RETENTION_DAYS),
  };
}

export function setNotificationConfig(cfg: Partial<NotificationConfig>): void {
  if (cfg.enabled !== undefined) setSetting(K.enabled, cfg.enabled ? "1" : "0");

  if (cfg.smtpEnabled !== undefined) setSetting(K.smtpEnabled, cfg.smtpEnabled ? "1" : "0");
  if (cfg.smtpHost !== undefined) setSetting(K.smtpHost, cfg.smtpHost.trim());
  if (cfg.smtpPort !== undefined) setSetting(K.smtpPort, String(cfg.smtpPort));
  if (cfg.smtpSecure !== undefined) setSetting(K.smtpSecure, cfg.smtpSecure ? "1" : "0");
  if (cfg.smtpUser !== undefined) setSetting(K.smtpUser, cfg.smtpUser.trim());
  // Stringa vuota = "non toccare", per non cancellare il segreto salvato
  if (cfg.smtpPassword !== undefined && cfg.smtpPassword !== "") {
    setSetting(K.smtpPassword, encrypt(cfg.smtpPassword));
  }
  if (cfg.smtpFrom !== undefined) setSetting(K.smtpFrom, cfg.smtpFrom.trim());
  if (cfg.smtpTo !== undefined) setSetting(K.smtpTo, cfg.smtpTo.trim());

  if (cfg.webhookEnabled !== undefined) {
    setSetting(K.webhookEnabled, cfg.webhookEnabled ? "1" : "0");
  }
  if (cfg.webhookUrl !== undefined) setSetting(K.webhookUrl, cfg.webhookUrl.trim());
  if (cfg.webhookAuthHeader !== undefined && cfg.webhookAuthHeader !== "") {
    setSetting(K.webhookAuth, encrypt(cfg.webhookAuthHeader));
  }

  if (cfg.policy?.immediateCategories !== undefined) {
    setSetting(K.immediateCategories, cfg.policy.immediateCategories.join(","));
  }
  if (cfg.policy?.immediateMinLevel !== undefined) {
    setSetting(K.immediateMinLevel, String(cfg.policy.immediateMinLevel));
  }
  if (cfg.policy?.digestIntervalMinutes !== undefined) {
    setSetting(K.digestIntervalMinutes, String(cfg.policy.digestIntervalMinutes));
  }
  if (cfg.retentionDays !== undefined) {
    setSetting(K.retentionDays, String(cfg.retentionDays));
  }
}

/** Versione senza segreti, per le API. */
export function getNotificationConfigPublic() {
  const c = getNotificationConfig();
  return {
    ...c,
    smtpPassword: c.smtpPassword ? "***" : "",
    webhookAuthHeader: c.webhookAuthHeader ? "***" : "",
  };
}

export function parseRecipients(to: string): string[] {
  return to
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
