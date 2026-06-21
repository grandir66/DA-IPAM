/**
 * Feature flag + ingest token lifecycle (hub tenant_features).
 */
import crypto from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { getHubDb } from "@/lib/db-hub";
import {
  getFeatureStatus,
  invalidateFeatureCache,
  isFeatureEnabled,
  setFeatureEnabled,
  setFeatureDisabled,
} from "@/lib/patch/feature";
import { registerIngestToken, revokeIngestTokensForTenant } from "@/lib/inventory-agent/auth";

export const INVENTORY_AGENT_FEATURE_KEY = "inventory_agent";

export interface InventoryAgentConfig {
  /** Token cifrato (solo per audit interno; l'admin vede il plaintext una volta alla generazione). */
  ingestTokenEnc?: string;
  generatedAt?: string;
}

export async function isInventoryAgentEnabled(tenantCode: string): Promise<boolean> {
  return isFeatureEnabled(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
}

export async function getInventoryAgentState(tenantCode: string) {
  const status = await getFeatureStatus(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
  let hasToken = false;
  if (status.configJson) {
    try {
      const cfg = JSON.parse(status.configJson) as InventoryAgentConfig;
      hasToken = Boolean(cfg.ingestTokenEnc);
    } catch {
      hasToken = false;
    }
  }
  const tokenCount = getHubDb()
    .prepare("SELECT COUNT(*) AS c FROM inventory_ingest_tokens WHERE tenant_code = ?")
    .get(tenantCode) as { c: number };
  return {
    enabled: status.enabled,
    enabledAt: status.enabledAt,
    hasToken,
    activeTokens: tokenCount.c,
  };
}

export function installInventoryAgentFeature(tenantCode: string, userId: number | null): void {
  setFeatureEnabled(tenantCode, INVENTORY_AGENT_FEATURE_KEY, userId);
  invalidateFeatureCache(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
}

export function uninstallInventoryAgentFeature(tenantCode: string): void {
  revokeIngestTokensForTenant(tenantCode);
  setFeatureDisabled(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
  getHubDb()
    .prepare(
      "UPDATE tenant_features SET config_json = NULL WHERE tenant_code = ? AND feature_key = ?",
    )
    .run(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
  invalidateFeatureCache(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
}

/** Genera nuovo token ingest: invalida i precedenti per il tenant. */
export function generateInventoryIngestToken(tenantCode: string): string {
  revokeIngestTokensForTenant(tenantCode);
  const plaintext = crypto.randomBytes(32).toString("base64url");
  registerIngestToken(tenantCode, plaintext);

  const cfg: InventoryAgentConfig = {
    ingestTokenEnc: encrypt(plaintext),
    generatedAt: new Date().toISOString(),
  };
  getHubDb()
    .prepare(
      `INSERT INTO tenant_features (tenant_code, feature_key, enabled, enabled_at, config_json)
       VALUES (?, ?, 1, datetime('now'), ?)
       ON CONFLICT(tenant_code, feature_key)
       DO UPDATE SET config_json = excluded.config_json, enabled = 1`,
    )
    .run(tenantCode, INVENTORY_AGENT_FEATURE_KEY, JSON.stringify(cfg));
  invalidateFeatureCache(tenantCode, INVENTORY_AGENT_FEATURE_KEY);
  return plaintext;
}
