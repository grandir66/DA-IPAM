/**
 * Thin client per il net-services bridge sulla VM dedicata (ADR-0007).
 * Tutti gli endpoint sono autenticati con Bearer token.
 * Il bridge usa TLS self-signed → bypass certificato (rete /28 internal).
 *
 * Refactor 2026-06-17: la config NON è più letta da env. Viene caricata dal
 * tenant_features.config_json (cifrato AES-GCM). Il client è una factory
 * `makeNetServicesClient(tenantCode)` che ritorna un namespace usabile.
 *
 * Per produzione cliente esterno: distribuire CA cert via NODE_EXTRA_CA_CERTS
 * e rimuovere il bypass insecureAgent.
 */
import https from "node:https";
import { getNetServicesConfig } from "./config";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export interface BridgeStatus {
  bridge: string;
  services: {
    resolver: { active: string; enabled: string; units: string };
    adblock: { active: string; enabled: string; units: string };
    dns: { active: string; enabled: string; units: string };
    dhcp: { active: string; enabled: string; units: string };
  };
}

export interface ForwardZone {
  file: string;
  zone: string;
  targets: string[];
}

export interface ResolverStatus {
  running: boolean;
  forward_zones?: ForwardZone[];
  note?: string;
  [stat: string]: unknown;
}

export interface AdBlockStats {
  running: boolean;
  num_dns_queries?: number;
  num_blocked_filtering?: number;
  avg_processing_time?: number;
  top_clients?: Array<Record<string, number>>;
  top_blocked_domains?: Array<Record<string, number>>;
  note?: string;
}

export interface AdBlockRules {
  running: boolean;
  enabled?: boolean;
  rules?: string[];
  filters_count?: number;
  note?: string;
}

export class BridgeUnavailableError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "BridgeUnavailableError";
  }
}

async function makeCall(tenantCode: string) {
  const cfg = await getNetServicesConfig(tenantCode);
  if (!cfg.enabled) {
    throw new BridgeUnavailableError(
      "Modulo Network Services non installato per questo tenant. Vai in /network-services per installarlo.",
      404,
    );
  }
  if (!cfg.configured) {
    throw new BridgeUnavailableError(
      "Modulo installato ma config mancante (apiUrl/apiToken vuoti).",
      400,
    );
  }
  return async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${cfg.apiUrl.replace(/\/$/, "")}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${cfg.apiToken}`);
    if (init.body) headers.set("Content-Type", "application/json");
    // @ts-expect-error — undici fetch types non includono agent ma a runtime lo accetta via dispatcher
    const res = await fetch(url, { ...init, headers, dispatcher: undefined, agent: insecureAgent });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      throw new BridgeUnavailableError(
        `bridge ${path} HTTP ${res.status}: ${body.slice(0, 300)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  };
}

export async function makeNetServicesClient(tenantCode: string) {
  const call = await makeCall(tenantCode);
  return {
    health: () => call<{ status: string; version: string; api: string }>("/api/v1/health"),
    status: () => call<BridgeStatus>("/api/v1/status"),

    toggle: (service: "resolver" | "adblock" | "dns" | "dhcp", enable: boolean) =>
      call<{ service: string; enable: boolean; results: unknown[] }>(
        `/api/v1/toggle/${service}?enable=${enable}`,
        { method: "POST" },
      ),

    resolverStatus: () => call<ResolverStatus>("/api/v1/resolver/status"),
    addForwardZone: (zone: string, targets: string[]) =>
      call<{ ok: boolean; zone: string; targets?: string[]; error?: string }>(
        "/api/v1/resolver/forwards",
        { method: "POST", body: JSON.stringify({ zone, targets }) },
      ),
    removeForwardZone: (zone: string) =>
      call<{ ok: boolean; zone: string }>(
        `/api/v1/resolver/forwards/${encodeURIComponent(zone)}`,
        { method: "DELETE" },
      ),

    adblockStats: () => call<AdBlockStats>("/api/v1/adblock/stats"),
    adblockRules: () => call<AdBlockRules>("/api/v1/adblock/rules"),
    addAdblockRule: (rule: string) =>
      call<{ ok: boolean; added?: boolean }>(
        "/api/v1/adblock/rules",
        { method: "POST", body: JSON.stringify({ rule }) },
      ),
    removeAdblockRule: (rule: string) =>
      call<{ ok: boolean; removed?: boolean }>(
        "/api/v1/adblock/rules",
        { method: "DELETE", body: JSON.stringify({ rule }) },
      ),
  };
}

/**
 * Probe della raggiungibilità del bridge senza credentials (per setup wizard).
 * Chiama /api/v1/health (no auth) per verificare che l'URL risponda.
 * Ritorna `{ ok: true, version }` o `{ ok: false, error }`.
 */
export async function probeBridge(
  apiUrl: string,
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const url = `${apiUrl.replace(/\/$/, "")}/api/v1/health`;
    // @ts-expect-error — runtime accepts agent on fetch
    const res = await fetch(url, { agent: insecureAgent });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; version?: string };
    return { ok: true, version: body.version ?? "unknown" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Probe della raggiungibilità + auth del bridge con token (per setup wizard).
 * Chiama /api/v1/status con Authorization Bearer. Ritorna ok se HTTP 200.
 */
export async function probeBridgeWithAuth(
  apiUrl: string,
  apiToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const url = `${apiUrl.replace(/\/$/, "")}/api/v1/status`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
      // @ts-expect-error — runtime accepts agent on fetch via dispatcher
      agent: insecureAgent,
    });
    if (res.status === 401) return { ok: false, error: "Token non valido (HTTP 401)" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
