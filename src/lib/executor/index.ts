/**
 * Executor — astrazione che disaccoppia chi orchestra (hub) da chi esegue
 * effettivamente I/O verso la rete cliente (in-process locale o agente remoto).
 *
 * In Phase 1 la factory `getExecutor()` ritorna sempre `LocalExecutor`.
 * Per i tenant marcati `agent_mode='remote'` ma con agent non configurato,
 * lanciamo un errore esplicito: in Phase 3 la stessa condizione verrà sostituita
 * dal `RemoteExecutor`.
 */

import { getTenantByCode } from "@/lib/db-hub";
import { safeDecrypt } from "@/lib/crypto";
import { LocalExecutor } from "./local";
import { RemoteExecutor } from "./remote";
import type {
  DnsBatchCallbacks,
  DnsResolution,
  ExecutorMode,
  HealthCheckResult,
  NmapPortScanCallbacks,
  NmapPortScanOptions,
  NmapResult,
  PingResult,
  PingSweepCallbacks,
} from "./types";

export interface Executor {
  readonly mode: ExecutorMode;

  healthCheck(): Promise<HealthCheckResult>;

  pingHost(ip: string, timeoutMs?: number): Promise<PingResult>;
  pingSweep(ips: string[], concurrency?: number, cb?: PingSweepCallbacks): Promise<PingResult[]>;

  nmapDiscoverHosts(target: string, timeoutMs?: number): Promise<NmapResult[]>;
  nmapPortScan(
    ip: string,
    options?: NmapPortScanOptions,
    cb?: NmapPortScanCallbacks,
  ): Promise<NmapResult | null>;

  reverseDns(ip: string, dnsServer?: string | null): Promise<string | null>;
  forwardDns(hostname: string, dnsServer?: string | null): Promise<string[]>;
  resolveDnsBatch(
    ips: string[],
    dnsServer: string | null | undefined,
    concurrency: number,
    cb?: DnsBatchCallbacks,
  ): Promise<Map<string, DnsResolution>>;

  macVendorLookup(mac: string): Promise<string | null>;
}

export class ExecutorNotConfiguredError extends Error {
  constructor(public readonly tenantCode: string, message: string) {
    super(message);
    this.name = "ExecutorNotConfiguredError";
  }
}

export function getExecutor(tenantCode: string): Executor {
  const tenant = getTenantByCode(tenantCode);
  if (!tenant) {
    throw new ExecutorNotConfiguredError(tenantCode, `Tenant '${tenantCode}' non trovato`);
  }

  const mode: ExecutorMode = tenant.agent_mode === "remote" ? "remote" : "local";

  if (mode === "remote") {
    if (!tenant.agent_hostname) {
      throw new ExecutorNotConfiguredError(
        tenantCode,
        `Tenant '${tenantCode}' è 'remote' ma manca agent_hostname. Configura da /tenants/${tenant.id}/agent.`,
      );
    }
    if (!tenant.agent_token_encrypted) {
      throw new ExecutorNotConfiguredError(
        tenantCode,
        `Tenant '${tenantCode}' è 'remote' ma manca il token. Generane uno da /tenants/${tenant.id}/agent.`,
      );
    }
    const token = safeDecrypt(tenant.agent_token_encrypted);
    if (!token) {
      throw new ExecutorNotConfiguredError(
        tenantCode,
        `Decifratura token fallita per il tenant '${tenantCode}'. Rigenera il token.`,
      );
    }
    return new RemoteExecutor({
      hostname: tenant.agent_hostname,
      port: tenant.agent_port,
      token,
      tenantCode,
    });
  }

  return new LocalExecutor();
}

export type { HealthCheckResult, NmapPortScanOptions } from "./types";
