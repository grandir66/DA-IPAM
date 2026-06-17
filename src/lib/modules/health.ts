/**
 * Layer di SALUTE dei moduli — cachato 60s per (tenantCode).
 *
 * Separato dal registry (src/lib/modules/registry.ts) così il registry resta
 * veloce (solo letture DB/settings) e le pagine non si bloccano mai sui probe.
 *
 * Strategia per modulo:
 *  - edge / librenms / wazuh → riusa getIntegrationsOverview() (classifica
 *    ok/warning/error/stale dai sync job, costo zero, nessun HTTP live).
 *  - graylog → stato derivato dalla config (nessun sync job dedicato oggi).
 *  - network_services → UNICO probe HTTP live (bridge), bounded con timeout 4s.
 *  - patch_management → modulo locale, nessun servizio esterno: ok se enabled.
 */
import { withTenant } from "@/lib/db-tenant";
import { getIntegrationsOverview } from "@/lib/integrations/dashboard-health";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getFeatureStatus } from "@/lib/patch/feature";
import { getNetServicesState } from "@/lib/network-services/feature";
import { probeBridgeWithAuth } from "@/lib/network-services/client";
import type { ModuleKey } from "./registry";

export type ModuleHealthStatus =
  | "ok"
  | "warning"
  | "error"
  | "stale"
  | "never"
  | "unknown";

export interface ModuleHealth {
  key: ModuleKey;
  status: ModuleHealthStatus;
  message: string | null;
  lastSync: string | null;
  probedAt: string;
}

const TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;

interface CacheEntry {
  value: ModuleHealth[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Invalida la cache health per un tenant (dopo import/config). */
export function invalidateModulesHealth(tenantCode: string): void {
  cache.delete(tenantCode);
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Combina due status prendendo il peggiore (per Wazuh manager+indexer). */
function worst(a: ModuleHealthStatus, b: ModuleHealthStatus): ModuleHealthStatus {
  const rank: Record<ModuleHealthStatus, number> = {
    ok: 0,
    stale: 1,
    warning: 2,
    never: 3,
    error: 4,
    unknown: 1,
  };
  return rank[a] >= rank[b] ? a : b;
}

async function compute(tenantCode: string): Promise<ModuleHealth[]> {
  const probedAt = new Date().toISOString();
  const out: ModuleHealth[] = [];

  // Overview dai sync job (richiede il tenant context).
  const overview = withTenant(tenantCode, () => getIntegrationsOverview());
  const byKey = new Map(overview.map((o) => [o.key, o]));

  // ── edge ──
  {
    const o = byKey.get("scanner_edge");
    out.push({
      key: "edge",
      status: (o?.status as ModuleHealthStatus) ?? "never",
      message: o?.message ?? (o ? null : "Scanner-Edge non configurato"),
      lastSync: o?.lastSync ?? null,
      probedAt,
    });
  }

  // ── librenms ──
  {
    const o = byKey.get("librenms");
    out.push({
      key: "librenms",
      status: (o?.status as ModuleHealthStatus) ?? "never",
      message: o?.message ?? (o ? null : "LibreNMS non configurato"),
      lastSync: o?.lastSync ?? null,
      probedAt,
    });
  }

  // ── wazuh (manager + indexer → peggiore) ──
  {
    const mgr = byKey.get("wazuh_manager");
    const idx = byKey.get("wazuh_indexer");
    if (!mgr && !idx) {
      out.push({ key: "wazuh", status: "never", message: "Wazuh non configurato", lastSync: null, probedAt });
    } else {
      const status = worst(
        (mgr?.status as ModuleHealthStatus) ?? "ok",
        (idx?.status as ModuleHealthStatus) ?? "ok",
      );
      out.push({
        key: "wazuh",
        status,
        message: mgr?.message ?? idx?.message ?? null,
        lastSync: mgr?.lastSync ?? idx?.lastSync ?? null,
        probedAt,
      });
    }
  }

  // ── graylog (no sync job: stato da config) ──
  {
    const cfg = getIntegrationConfig("graylog");
    const configured = cfg.mode !== "disabled" && !!cfg.url;
    out.push({
      key: "graylog",
      status: configured ? "ok" : "never",
      message: configured ? null : "Non configurato",
      lastSync: null,
      probedAt,
    });
  }

  // ── patch_management (modulo locale) ──
  {
    const st = await getFeatureStatus(tenantCode, "patch_management");
    out.push({
      key: "patch_management",
      status: st.enabled ? "ok" : "never",
      message: st.enabled ? "Modulo locale, nessun servizio esterno" : "Non installato",
      lastSync: null,
      probedAt,
    });
  }

  // ── network_services (unico probe live, bounded) ──
  {
    const net = await getNetServicesState(tenantCode);
    if (!net.enabled) {
      out.push({ key: "network_services", status: "never", message: "Non installato", lastSync: null, probedAt });
    } else if (!net.configured) {
      out.push({ key: "network_services", status: "warning", message: "Config mancante", lastSync: null, probedAt });
    } else {
      const probe = await withTimeout(
        probeBridgeWithAuth(net.apiUrl, net.apiToken),
        PROBE_TIMEOUT_MS,
        { ok: false as const, error: "Timeout probe bridge" },
      );
      out.push({
        key: "network_services",
        status: probe.ok ? "ok" : "error",
        message: probe.ok ? null : probe.error,
        lastSync: null,
        probedAt,
      });
    }
  }

  return out;
}

/** Stato di salute dei 6 moduli per il tenant (cache 60s). */
export async function getModulesHealth(tenantCode: string): Promise<ModuleHealth[]> {
  const now = Date.now();
  const cached = cache.get(tenantCode);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await compute(tenantCode);
  cache.set(tenantCode, { value, expiresAt: now + TTL_MS });
  return value;
}
