import dns from "dns";

/** Cache in-process (TTL) per non ripetere le stesse query nella sessione / job. */
const DNS_CACHE_KEY = "__da_invent_dns_mem_cache__" as const;
type MemCache = {
  reverse: Map<string, { exp: number; val: string | null }>;
  forward: Map<string, { exp: number; val: string[] }>;
};

function getMemCache(): MemCache {
  const g = globalThis as Record<string, unknown>;
  if (!g[DNS_CACHE_KEY]) {
    g[DNS_CACHE_KEY] = {
      reverse: new Map(),
      forward: new Map(),
    };
  }
  return g[DNS_CACHE_KEY] as MemCache;
}

function memCacheTtlMs(): number {
  const n = parseInt(process.env.DA_INVENT_DNS_CACHE_TTL_MS || "1800000", 10);
  return Math.min(86400000, Math.max(60000, Number.isNaN(n) ? 1800000 : n));
}

function negativeCacheTtlMs(): number {
  const n = parseInt(process.env.DA_INVENT_DNS_NEGATIVE_CACHE_TTL_MS || "300000", 10);
  return Math.min(3600000, Math.max(30000, Number.isNaN(n) ? 300000 : n));
}

function revMemKey(dnsServer: string | null | undefined, ip: string): string {
  return `${dnsServer ?? ""}|${ip}`;
}

function fwdMemKey(dnsServer: string | null | undefined, hostname: string): string {
  return `${dnsServer ?? ""}|${hostname.toLowerCase()}`;
}

/** Timeout per singola query (reverse/forward). Default 2,5s — evita scan bloccati su DNS lenti. */
function getDnsTimeoutMs(): number {
  const n = parseInt(process.env.DA_INVENT_DNS_TIMEOUT_MS || "2500", 10);
  if (Number.isNaN(n) || n < 200) return 2500;
  return Math.min(30000, n);
}

function createResolver(dnsServer?: string | null): dns.promises.Resolver {
  const ms = getDnsTimeoutMs();
  const server = dnsServer?.trim();
  if (server) {
    const r = new dns.promises.Resolver({ timeout: ms, tries: 1 });
    r.setServers([server]);
    return r;
  }
  const r = new dns.promises.Resolver({ timeout: ms, tries: 1 });
  try {
    const systemServers = dns.getServers();
    if (systemServers.length > 0) r.setServers(systemServers);
  } catch {
    /* ignore */
  }
  return r;
}

/** Log server DNS solo con DA_INVENT_DNS_VERBOSE=true (mai a caricamento modulo — evita spam su ogni polling API). */
const DNS_LOG_INIT_KEY = "__da_invent_dns_verbose_logged__";
function logDnsServersIfVerbose(): void {
  if (process.env.DA_INVENT_DNS_VERBOSE !== "true") return;
  const g = globalThis as Record<string, unknown>;
  if (g[DNS_LOG_INIT_KEY]) return;
  g[DNS_LOG_INIT_KEY] = true;
  try {
    const systemServers = dns.getServers();
    if (systemServers.length > 0) {
      console.log("[DNS] Resolver, server:", systemServers.join(", "));
    }
  } catch (e) {
    console.warn("[DNS] Lettura server DNS:", e);
  }
}

/** Extra safety: Node non garantisce sempre rispetto del timeout su tutti gli OS. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

const dnsVerbose = () => process.env.DA_INVENT_DNS_VERBOSE === "true";

function getResolver(dnsServer?: string | null): dns.promises.Resolver {
  return createResolver(dnsServer);
}

export async function reverseDns(ip: string, dnsServer?: string | null): Promise<string | null> {
  const mc = getMemCache();
  const mk = revMemKey(dnsServer, ip);
  const hit = mc.reverse.get(mk);
  if (hit && Date.now() < hit.exp) return hit.val;

  const resolver = getResolver(dnsServer);
  const ms = getDnsTimeoutMs();
  try {
    const hostnames = await withTimeout(resolver.reverse(ip), ms + 500);
    if (!hostnames || hostnames.length === 0) {
      mc.reverse.set(mk, { val: null, exp: Date.now() + negativeCacheTtlMs() });
      return null;
    }
    const first = hostnames[0];
    if (dnsVerbose()) console.log(`[DNS] Reverse ${ip} → ${first}`);
    mc.reverse.set(mk, { val: first, exp: Date.now() + memCacheTtlMs() });
    return first;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      console.warn(`[DNS] Reverse lookup failed for ${ip}: ${err.code} ${err.message}`);
    }
    mc.reverse.set(mk, { val: null, exp: Date.now() + negativeCacheTtlMs() });
    return null;
  }
}

export async function forwardDns(hostname: string, dnsServer?: string | null): Promise<string[]> {
  const mc = getMemCache();
  const mk = fwdMemKey(dnsServer, hostname);
  const hit = mc.forward.get(mk);
  if (hit && Date.now() < hit.exp) return hit.val;

  const resolver = getResolver(dnsServer);
  const ms = getDnsTimeoutMs();
  try {
    const addresses = await withTimeout(resolver.resolve4(hostname), ms + 500);
    if (!addresses || addresses.length === 0) {
      mc.forward.set(mk, { val: [], exp: Date.now() + negativeCacheTtlMs() });
      return [];
    }
    if (dnsVerbose()) console.log(`[DNS] Forward ${hostname} → ${addresses.join(", ")}`);
    mc.forward.set(mk, { val: addresses, exp: Date.now() + memCacheTtlMs() });
    return addresses;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      console.warn(`[DNS] Forward lookup failed for ${hostname}: ${err.code} ${err.message}`);
    }
    mc.forward.set(mk, { val: [], exp: Date.now() + negativeCacheTtlMs() });
    return [];
  }
}

export type DnsResolution = { reverse: string | null; forward: string | null };

/**
 * Risolve PTR + (se serve) forward per molti IP in parallelo a blocchi.
 * Evita il collo di bottiglia sequenziale (centinaia di IP × secondi ciascuno).
 */
export async function resolveDnsBatch(
  ips: string[],
  dnsServer: string | null | undefined,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, DnsResolution>> {
  logDnsServersIfVerbose();
  const out = new Map<string, DnsResolution>();
  const total = ips.length;
  let completed = 0;
  const conc = Math.max(1, Math.min(64, concurrency));

  for (let i = 0; i < ips.length; i += conc) {
    const slice = ips.slice(i, i + conc);
    const results = await Promise.all(
      slice.map(async (ip) => {
        const reverse = await reverseDns(ip, dnsServer);
        let forward: string | null = null;
        if (reverse) {
          const forwardResults = await forwardDns(reverse, dnsServer);
          if (forwardResults.includes(ip)) forward = reverse;
        }
        return { ip, reverse, forward };
      })
    );
    for (const r of results) {
      out.set(r.ip, { reverse: r.reverse, forward: r.forward });
      completed++;
    }
    onProgress?.(completed, total);
  }

  return out;
}
