/**
 * Executor — astrazione che disaccoppia chi orchestra (hub) da chi esegue
 * effettivamente I/O verso la rete cliente (in-process locale o agente remoto).
 *
 * In Phase 1 la factory `getExecutor()` ritorna sempre `LocalExecutor`.
 * Per i tenant marcati `agent_mode='remote'` ma con agent non configurato,
 * lanciamo un errore esplicito: in Phase 3 la stessa condizione verrà sostituita
 * dal `RemoteExecutor`.
 */

import { getTenantByCode, getFirstTenantAgent } from "@/lib/db-hub";
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

/**
 * Porta per le prove (T3-16): su `globalThis` sotto questa chiave una prova
 * può mettere un esecutore finto, con le uscite di rete che non passano
 * dall'esecutore (secondo passaggio TCP, cache ARP locale, ARP dagli apparati).
 * In produzione è vuota: nessun codice dell'applicazione la scrive, la mette
 * solo il banco `scanner/__tests__/support/esecutore-finto.ts`.
 */
const SCAN_IO_OVERRIDE_KEY = Symbol.for("da-ipam.executor.override");

export interface ScanIoOverride {
  executor: Executor;
  /** Secondo passaggio TCP della discovery (al posto di `tcpConnect`). Assente = nessuna porta risponde. */
  tcpConnect?: (host: string, port: number, timeoutMs?: number) => Promise<boolean>;
  /** Cache ARP della macchina (al posto di `arp -a`). Assente = cache vuota. */
  readArpCache?: () => Promise<Array<{ ip: string; mac: string }>>;
  /** ARP/DHCP letti dagli apparati (al posto di `runArpPoll`). Assente = non eseguito. */
  runArpPoll?: (
    networkId: number,
    options?: { onlyEnrichIps?: string[]; skipDhcpLeases?: boolean },
  ) => Promise<{ phase?: string; error?: string }>;
}

/** L'override delle prove, se presente; `null` in produzione. */
export function getScanIoOverride(): ScanIoOverride | null {
  const o = (globalThis as Record<symbol, unknown>)[SCAN_IO_OVERRIDE_KEY];
  return o && typeof o === "object" && "executor" in o ? (o as ScanIoOverride) : null;
}

export function getExecutor(tenantCode: string): Executor {
  // Porta delle prove: letta prima della ricerca del tenant (vuota in produzione).
  const override = getScanIoOverride();
  if (override) return override.executor;

  const tenant = getTenantByCode(tenantCode);
  if (!tenant) {
    throw new ExecutorNotConfiguredError(tenantCode, `Tenant '${tenantCode}' non trovato`);
  }

  const mode: ExecutorMode = tenant.agent_mode === "remote" ? "remote" : "local";

  if (mode === "remote") {
    // Fonte di verità: tabella tenant_agents (N agent per tenant). Phase 7+
    // sceglierà l'agent giusto in base a subnet_match; per ora usiamo il primo.
    const agent = getFirstTenantAgent(tenant.id);
    if (!agent) {
      throw new ExecutorNotConfiguredError(
        tenantCode,
        `Tenant '${tenantCode}' è 'remote' ma non ha agenti configurati. Aggiungine uno da /agents.`,
      );
    }
    if (!agent.token_encrypted) {
      throw new ExecutorNotConfiguredError(
        tenantCode,
        `Agente '${agent.label}' del tenant '${tenantCode}' senza token. Generane uno da /agents.`,
      );
    }
    const token = safeDecrypt(agent.token_encrypted);
    if (!token) {
      throw new ExecutorNotConfiguredError(
        tenantCode,
        `Decifratura token fallita per agente '${agent.label}'. Rigenera il token.`,
      );
    }
    return new RemoteExecutor({
      hostname: agent.hostname,
      port: agent.port,
      token,
      tenantCode,
    });
  }

  return new LocalExecutor();
}

export type { HealthCheckResult, NmapPortScanOptions } from "./types";
