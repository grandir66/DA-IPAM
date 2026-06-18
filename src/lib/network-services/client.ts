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

/**
 * Transport via node:https (NON fetch): undici/`fetch` ignora l'opzione `agent`,
 * quindi il cert self-signed del bridge veniva rifiutato (DEPTH_ZERO_SELF_SIGNED_CERT).
 * `https.request` con insecureAgent rispetta rejectUnauthorized:false → funziona
 * verso il bridge TLS self-signed sulla rete interna.
 */
interface RawResp { status: number; ok: boolean; body: string; }
function httpsRequest(
  rawUrl: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<RawResp> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(rawUrl); } catch (e) { reject(e as Error); return; }
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: opts.method || "GET",
        headers: opts.headers,
        agent: insecureAgent,
        timeout: opts.timeoutMs ?? 8000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          const code = res.statusCode || 0;
          resolve({ status: code, ok: code >= 200 && code < 300, body: d });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

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

// ── DNS authoritative (PowerDNS) ──

export interface DnsZone {
  id: string;
  name: string;
  kind: string;
  serial: number;
  dnssec: boolean;
}

export interface DnsZonesResp {
  running: boolean;
  zones: DnsZone[];
  count: number;
  note?: string;
}

export interface DnsRecord {
  /** Nome FQDN della rrset (es. host1.cliente.lan.). */
  name: string;
  type: string;
  ttl: number;
  /** Valori della rrset (es. ["10.0.0.5"]). */
  contents: string[];
}

export interface DnsRecordsResp {
  running: boolean;
  zone: string;
  records: DnsRecord[];
  count: number;
  note?: string;
}

interface RawRrset {
  name: string;
  type: string;
  ttl: number;
  records?: Array<{ content: string; disabled?: boolean }>;
}

// ── DHCP (Kea, read-only) ──

export interface DhcpLease {
  /** Campi Kea grezzi (ip-address, hw-address, hostname, valid-lft, cltt, ...). */
  [field: string]: unknown;
}

export interface DhcpLeasesResp {
  running: boolean;
  leases: DhcpLease[];
  count: number;
  note?: string;
}

export interface DhcpReservation {
  [field: string]: unknown;
}

export interface DhcpReservationsResp {
  running: boolean;
  reservations: DhcpReservation[];
  count: number;
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
    const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiToken}` };
    if (init.body) headers["Content-Type"] = "application/json";
    let res: RawResp;
    try {
      res = await httpsRequest(url, {
        method: (init.method as string) || "GET",
        headers,
        body: typeof init.body === "string" ? init.body : undefined,
      });
    } catch (e) {
      throw new BridgeUnavailableError(
        `bridge ${path} unreachable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      throw new BridgeUnavailableError(
        `bridge ${path} HTTP ${res.status}: ${res.body.slice(0, 300)}`,
        res.status,
      );
    }
    return JSON.parse(res.body) as T;
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

    // ── DNS authoritative (PowerDNS): CRUD completo ──
    dnsZones: () => call<DnsZonesResp>("/api/v1/zones"),
    addDnsZone: (zone: string) =>
      call<{ ok: boolean; zone: string; created?: boolean; error?: string }>(
        "/api/v1/zones",
        { method: "POST", body: JSON.stringify({ zone }) },
      ),
    dnsRecords: async (zone: string): Promise<DnsRecordsResp> => {
      const raw = await call<{ running: boolean; zone: string; rrsets?: RawRrset[]; count?: number; note?: string }>(
        `/api/v1/zones/${encodeURIComponent(zone)}/records`,
      );
      const records: DnsRecord[] = (raw.rrsets ?? []).map((rr) => ({
        name: rr.name,
        type: rr.type,
        ttl: rr.ttl,
        contents: (rr.records ?? []).filter((r) => !r.disabled).map((r) => r.content),
      }));
      return { running: raw.running, zone: raw.zone, records, count: raw.count ?? records.length, note: raw.note };
    },
    addDnsRecord: (zone: string, name: string, type: string, contents: string[], ttl: number) =>
      call<{ ok: boolean; http?: number; error?: string; body?: string }>(
        `/api/v1/zones/${encodeURIComponent(zone)}/records`,
        { method: "POST", body: JSON.stringify({ name, type, records: contents, ttl }) },
      ),
    removeDnsRecord: (zone: string, name: string, type: string) =>
      call<{ ok: boolean; http?: number; error?: string }>(
        `/api/v1/zones/${encodeURIComponent(zone)}/records`,
        { method: "DELETE", body: JSON.stringify({ name, type }) },
      ),

    // ── DHCP (Kea): SOLO LETTURA ──
    dhcpLeases: () => call<DhcpLeasesResp>("/api/v1/leases"),
    dhcpReservations: () => call<DhcpReservationsResp>("/api/v1/reservations"),

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
    const res = await httpsRequest(url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = JSON.parse(res.body) as { status?: string; version?: string };
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
    const res = await httpsRequest(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (res.status === 401) return { ok: false, error: "Token non valido (HTTP 401)" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
