/**
 * Thin client per il net-services bridge sulla VM dedicata (ADR-0007).
 * Tutti gli endpoint sono autenticati con Bearer token.
 * Il bridge usa TLS self-signed → bypass certificato (rete /28 internal).
 *
 * Per produzione cliente esterno: distribuire CA cert via NODE_EXTRA_CA_CERTS
 * e rimuovere il bypass.
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

async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const cfg = getNetServicesConfig();
  if (!cfg.enabled) {
    throw new BridgeUnavailableError(
      "net-services bridge non configurato (manca NET_SERVICES_API_URL o NET_SERVICES_API_TOKEN in env)",
    );
  }
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
}

export const netServices = {
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
