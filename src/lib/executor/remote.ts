/**
 * RemoteExecutor — implementazione dell'``Executor`` che parla con l'agente
 * Python via HTTP sopra Tailscale.
 *
 * Decisioni:
 *   - HTTP plain: Tailscale fornisce già cifratura WireGuard. TLS end-to-end
 *     è rinviato a Phase 4+ (vedi piano agenti remoti).
 *   - I metodi che lato Local accettano callback (onProgress/onLog) qui li
 *     ignorano in modo silenzioso: non sono serializzabili HTTP. La logica
 *     di progress streaming arriverà con SSE in fase successiva.
 *   - Timeout: per metodo, conservatively più alto del valore lato agente
 *     (l'agente ha il suo timeout per il subprocess nmap/snmp; aggiungiamo
 *     margine HTTP).
 */

import type {
  Executor,
} from "./index";
import { ExecutorNotConfiguredError } from "./index";
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

interface AgentErrorBody {
  error?: {
    code?: string;
    message?: string;
    retriable?: boolean;
  };
}

export class RemoteExecutorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retriable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RemoteExecutorError";
  }
}

interface RemoteOptions {
  hostname: string;
  port: number;
  token: string;
  tenantCode: string;
  /** Override per testing: alternativa a fetch globale. */
  fetchImpl?: typeof fetch;
}

const TIMEOUT_BY_METHOD: Record<string, number> = {
  healthCheck: 5_000,
  pingHost: 10_000,
  pingSweep: 120_000,
  nmapDiscoverHosts: 180_000,
  nmapPortScan: 600_000,        // due fasi (TCP+UDP) lato agente
  reverseDns: 10_000,
  forwardDns: 10_000,
  resolveDnsBatch: 120_000,
  macVendorLookup: 5_000,
};

export class RemoteExecutor implements Executor {
  readonly mode: ExecutorMode = "remote";

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly tenantCode: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RemoteOptions) {
    if (!opts.hostname) {
      throw new ExecutorNotConfiguredError(opts.tenantCode, "RemoteExecutor: hostname mancante");
    }
    if (!opts.token) {
      throw new ExecutorNotConfiguredError(opts.tenantCode, "RemoteExecutor: token mancante");
    }
    this.baseUrl = `http://${opts.hostname}:${opts.port}`;
    this.token = opts.token;
    this.tenantCode = opts.tenantCode;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutMs = TIMEOUT_BY_METHOD[method] ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        const errBody = parsed as AgentErrorBody;
        const code = errBody?.error?.code ?? `http_${res.status}`;
        const message = errBody?.error?.message ?? text.slice(0, 200) ?? `HTTP ${res.status}`;
        const retriable = errBody?.error?.retriable ?? (res.status >= 500 && res.status !== 501);
        throw new RemoteExecutorError(code, message, retriable, res.status);
      }
      return parsed as T;
    } catch (e: unknown) {
      if (e instanceof RemoteExecutorError) throw e;
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        throw new RemoteExecutorError("timeout", `Agent timeout (${timeoutMs} ms)`, true);
      }
      throw new RemoteExecutorError(
        "network_error",
        `Agent unreachable (${this.tenantCode} @ ${this.baseUrl}): ${err?.message ?? "errore di rete"}`,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ── methods ────────────────────────────────────────────────────────────

  async healthCheck(): Promise<HealthCheckResult> {
    return this.call<HealthCheckResult>("healthCheck", "/healthz");
  }

  async pingHost(ip: string, timeoutMs?: number): Promise<PingResult> {
    return this.call<PingResult>("pingHost", "/exec/ping", { ip, timeout_ms: timeoutMs ?? 2000 });
  }

  async pingSweep(
    ips: string[],
    concurrency?: number,
    _cb?: PingSweepCallbacks,
  ): Promise<PingResult[]> {
    return this.call<PingResult[]>("pingSweep", "/exec/ping-sweep", {
      ips,
      concurrency: concurrency ?? 50,
    });
  }

  async nmapDiscoverHosts(target: string, timeoutMs?: number): Promise<NmapResult[]> {
    return this.call<NmapResult[]>("nmapDiscoverHosts", "/exec/nmap-discover", {
      target,
      timeout_ms: timeoutMs ?? 90_000,
    });
  }

  async nmapPortScan(
    ip: string,
    options?: NmapPortScanOptions,
    _cb?: NmapPortScanCallbacks,
  ): Promise<NmapResult | null> {
    return this.call<NmapResult | null>("nmapPortScan", "/exec/nmap-port-scan", {
      ip,
      custom_args: options?.customArgs,
      timeout_ms: options?.timeoutMs ?? 280_000,
      skip_udp: options?.skipUdp ?? false,
      udp_ports: options?.udpPorts ?? null,
    });
  }

  async reverseDns(ip: string, dnsServer?: string | null): Promise<string | null> {
    const res = await this.call<{ reverse: string | null }>("reverseDns", "/exec/dns-reverse", {
      ip,
      dns_server: dnsServer ?? null,
    });
    return res.reverse;
  }

  async forwardDns(hostname: string, dnsServer?: string | null): Promise<string[]> {
    return this.call<string[]>("forwardDns", "/exec/dns-forward", {
      hostname,
      dns_server: dnsServer ?? null,
    });
  }

  async resolveDnsBatch(
    ips: string[],
    dnsServer: string | null | undefined,
    concurrency: number,
    _cb?: DnsBatchCallbacks,
  ): Promise<Map<string, DnsResolution>> {
    const rows = await this.call<Array<{ ip: string; resolution: DnsResolution }>>(
      "resolveDnsBatch",
      "/exec/dns-batch",
      { ips, dns_server: dnsServer ?? null, concurrency },
    );
    const out = new Map<string, DnsResolution>();
    for (const r of rows) out.set(r.ip, r.resolution);
    return out;
  }

  async macVendorLookup(_mac: string): Promise<string | null> {
    // MAC vendor lookup è puramente data-side (OUI DB): non ha senso forzarlo
    // sull'agente. Il LocalExecutor lo gestisce sull'hub. Qui torniamo null
    // — il chiamante (in Phase 3.5) farà sempre fallback al hub.
    return null;
  }
}
