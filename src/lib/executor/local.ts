/**
 * LocalExecutor — implementazione `Executor` che gira nello stesso processo dell'hub.
 *
 * Delega ai moduli scanner/devices esistenti senza alterarne la firma. Usato per:
 *   - tutti i tenant con `agent_mode='local'` (DEFAULT, dev, demo)
 *   - test e ambienti in cui non c'è (ancora) un agente remoto
 *
 * In Phase 3 verrà affiancato da `RemoteExecutor` con la stessa interfaccia ma
 * invocazioni HTTP verso un agente Python via Tailscale.
 */

import fs from "fs";
import path from "path";
import { pingHost, pingSweep } from "@/lib/scanner/ping";
import { nmapDiscoverHosts, nmapPortScan } from "@/lib/scanner/nmap";
import { reverseDns, forwardDns, resolveDnsBatch } from "@/lib/scanner/dns";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import type { Executor } from "./index";

function readHubVersion(): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

const HUB_VERSION = readHubVersion();
import type {
  DnsBatchCallbacks,
  DnsResolution,
  HealthCheckResult,
  NmapPortScanCallbacks,
  NmapPortScanOptions,
  NmapResult,
  PingResult,
  PingSweepCallbacks,
} from "./types";

export class LocalExecutor implements Executor {
  readonly mode = "local" as const;

  async healthCheck(): Promise<HealthCheckResult> {
    return { ok: true, version: HUB_VERSION, mode: this.mode };
  }

  pingHost(ip: string, timeoutMs?: number): Promise<PingResult> {
    return pingHost(ip, timeoutMs);
  }

  pingSweep(ips: string[], concurrency?: number, cb?: PingSweepCallbacks): Promise<PingResult[]> {
    return pingSweep(ips, concurrency, cb?.onProgress);
  }

  nmapDiscoverHosts(target: string, timeoutMs?: number): Promise<NmapResult[]> {
    return nmapDiscoverHosts(target, timeoutMs);
  }

  nmapPortScan(
    ip: string,
    options?: NmapPortScanOptions,
    cb?: NmapPortScanCallbacks,
  ): Promise<NmapResult | null> {
    return nmapPortScan(ip, options?.customArgs, options?.timeoutMs, {
      skipUdp: options?.skipUdp,
      udpPorts: options?.udpPorts,
      onLog: cb?.onLog,
    });
  }

  reverseDns(ip: string, dnsServer?: string | null): Promise<string | null> {
    return reverseDns(ip, dnsServer);
  }

  forwardDns(hostname: string, dnsServer?: string | null): Promise<string[]> {
    return forwardDns(hostname, dnsServer);
  }

  resolveDnsBatch(
    ips: string[],
    dnsServer: string | null | undefined,
    concurrency: number,
    cb?: DnsBatchCallbacks,
  ): Promise<Map<string, DnsResolution>> {
    return resolveDnsBatch(ips, dnsServer, concurrency, cb?.onProgress);
  }

  macVendorLookup(mac: string): Promise<string | null> {
    return lookupVendor(mac);
  }
}
