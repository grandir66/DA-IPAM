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
import { LocalExecutor } from "./local";
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
    // Phase 3: qui verrà istanziato `RemoteExecutor` con (hostname, port, token).
    // Per ora segnaliamo lo stato non implementato in modo che i call site
    // possano essere refactorati gradualmente senza rompere i tenant `local`.
    throw new ExecutorNotConfiguredError(
      tenantCode,
      `Tenant '${tenantCode}' configurato come 'remote' ma RemoteExecutor non è ancora attivo (Phase 3).`,
    );
  }

  return new LocalExecutor();
}

export type { HealthCheckResult, NmapPortScanOptions } from "./types";
