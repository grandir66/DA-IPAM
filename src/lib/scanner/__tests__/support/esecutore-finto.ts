// Esecutore finto per far girare il vero `runDiscovery` senza rete (T3-16).
//
// Si installa sulla porta di prova di `getExecutor`
// (`Symbol.for("da-ipam.executor.override")` su globalThis), vuota in
// produzione. Le risposte hanno la forma dei tipi veri (`PingResult`,
// `NmapResult`, `DnsResolution`); i contatori dicono quante volte la scansione
// è passata di qui. Le uscite che non passano dall'esecutore (secondo passaggio
// TCP, cache ARP locale, ARP dagli apparati) stanno nella stessa porta.
import type { Executor } from "@/lib/executor";
import type { ScanIoOverride } from "@/lib/executor";
import type { DnsResolution, NmapResult, PingResult } from "@/lib/executor/types";

const CHIAVE = Symbol.for("da-ipam.executor.override");

export interface ScenarioFinto {
  /** IP che rispondono al ping (gli altri risultano spenti). */
  vivi: string[];
  /** IP che rispondono al secondo passaggio TCP (porta qualunque). */
  viviTcp?: string[];
  /** Voci della cache ARP locale. */
  arp?: Array<{ ip: string; mac: string }>;
  /** Nomi del DNS inverso per IP. */
  ptr?: Record<string, string>;
}

export interface Chiamate {
  pingHost: number;
  pingSweep: number;
  nmapDiscoverHosts: number;
  nmapPortScan: number;
  dns: number;
  tcpConnect: number;
  readArpCache: number;
  runArpPoll: number;
}

export function creaEsecutoreFinto(s: ScenarioFinto): { override: ScanIoOverride; chiamate: Chiamate } {
  const chiamate: Chiamate = {
    pingHost: 0,
    pingSweep: 0,
    nmapDiscoverHosts: 0,
    nmapPortScan: 0,
    dns: 0,
    tcpConnect: 0,
    readArpCache: 0,
    runArpPoll: 0,
  };
  const vivi = new Set(s.vivi);
  const ping = (ip: string): PingResult =>
    vivi.has(ip) ? { ip, alive: true, latency_ms: 1.2, ttl: 64 } : { ip, alive: false, latency_ms: null, ttl: null };
  const risolvi = (ip: string): DnsResolution => {
    const nome = s.ptr?.[ip] ?? null;
    return { reverse: nome, forward: nome };
  };

  const executor: Executor = {
    mode: "local",
    async healthCheck() {
      return { ok: true, mode: "local" };
    },
    async pingHost(ip) {
      chiamate.pingHost++;
      return ping(ip);
    },
    async pingSweep(ips, _concurrency, cb) {
      chiamate.pingSweep++;
      const out = ips.map(ping);
      cb?.onProgress?.(ips.length, out.filter((r) => r.alive).length);
      return out;
    },
    async nmapDiscoverHosts(target) {
      chiamate.nmapDiscoverHosts++;
      const out: NmapResult[] = s.vivi.map((ip) => ({ ip, alive: true, ports: [], os: null, mac: null }));
      return target ? out : [];
    },
    async nmapPortScan() {
      chiamate.nmapPortScan++;
      return null;
    },
    async reverseDns(ip) {
      chiamate.dns++;
      return risolvi(ip).reverse;
    },
    async forwardDns() {
      chiamate.dns++;
      return [];
    },
    async resolveDnsBatch(ips, _server, _conc, cb) {
      chiamate.dns++;
      const out = new Map<string, DnsResolution>();
      ips.forEach((ip, i) => {
        out.set(ip, risolvi(ip));
        cb?.onProgress?.(i + 1, ips.length);
      });
      return out;
    },
    async macVendorLookup() {
      return null;
    },
  };

  const viviTcp = new Set(s.viviTcp ?? []);
  const override: ScanIoOverride = {
    executor,
    async tcpConnect(host) {
      chiamate.tcpConnect++;
      return viviTcp.has(host);
    },
    async readArpCache() {
      chiamate.readArpCache++;
      return s.arp ?? [];
    },
    async runArpPoll() {
      chiamate.runArpPoll++;
      return { phase: "simulato" };
    },
  };
  return { override, chiamate };
}

export function installaEsecutoreFinto(override: ScanIoOverride): void {
  (globalThis as Record<symbol, unknown>)[CHIAVE] = override;
}

export function togliEsecutoreFinto(): void {
  delete (globalThis as Record<symbol, unknown>)[CHIAVE];
}
