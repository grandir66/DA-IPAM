/**
 * Executor — astrazione che disaccoppia chi orchestra (hub) da chi esegue
 * effettivamente I/O verso la rete cliente. Esiste solo l'esecuzione locale.
 *
 * L'agente Python remoto è tolto (20/10/2026, decisione 26 della spec NetBird:
 * nessuno lo usava). Un cliente rimasto con `agent_mode='remote'` nel DB non
 * ripiega in silenzio sull'hub: `getExecutor` lancia `ExecutorNotConfiguredError`
 * con la via d'uscita, e il giro di scansione si ferma con quel messaggio.
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

  if (tenant.agent_mode === "remote") {
    throw new ExecutorNotConfiguredError(
      tenantCode,
      `Il cliente '${tenantCode}' è ancora in modalità «agente remoto», che non esiste più (tolta il 20/10/2026): ` +
        "la scansione non parte, per non provarla dall'hub su reti che l'hub non vede. " +
        "Per scansionare dall'hub va riportato in modalità locale (tenants.agent_mode = 'local').",
    );
  }

  return new LocalExecutor();
}

/**
 * L'esecutore di un giro di scansione. `null` = esecuzione locale coi moduli dello
 * scanner, come prima: nessun cliente nel contesto, o cliente non trovato (avviso nel
 * log). Un cliente in modalità remota fa invece fallire il giro (vedi sopra).
 */
export function esecutorePerGiro(tenantCode: string | null | undefined): Executor | null {
  if (!tenantCode) return null;
  try {
    return getExecutor(tenantCode);
  } catch (e) {
    if (e instanceof ExecutorNotConfiguredError && getTenantByCode(tenantCode)) throw e;
    console.warn(`[Executor] getExecutor("${tenantCode}") fallito — esecuzione locale: ${(e as Error).message}`);
    return null;
  }
}

export type { HealthCheckResult, NmapPortScanOptions } from "./types";
