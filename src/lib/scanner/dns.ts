import dns from "dns";

const defaultResolver = new dns.promises.Resolver({ timeout: 5000, tries: 2 });

// Initialize DNS servers from system config
try {
  const systemServers = dns.getServers();
  if (systemServers.length > 0) {
    defaultResolver.setServers(systemServers);
    console.log("[DNS] Using system DNS servers:", systemServers);
  }
} catch (e) {
  console.warn("[DNS] Failed to get system DNS servers:", e);
}

function getResolver(dnsServer?: string | null): dns.promises.Resolver {
  const server = dnsServer?.trim();
  if (server) {
    const r = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
    r.setServers([server]);
    return r;
  }
  return defaultResolver;
}

export async function reverseDns(ip: string, dnsServer?: string | null): Promise<string | null> {
  const resolver = getResolver(dnsServer);
  try {
    const hostnames = await resolver.reverse(ip);
    if (hostnames.length > 0) {
      console.log(`[DNS] Reverse ${ip} → ${hostnames[0]}`);
      return hostnames[0];
    }
    return null;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // ENOTFOUND/ENODATA are expected for IPs without PTR records
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      console.log(`[DNS] Reverse lookup failed for ${ip}: ${err.code} ${err.message}`);
    }
    return null;
  }
}

export async function forwardDns(hostname: string, dnsServer?: string | null): Promise<string[]> {
  const resolver = getResolver(dnsServer);
  try {
    const addresses = await resolver.resolve4(hostname);
    if (addresses.length > 0) {
      console.log(`[DNS] Forward ${hostname} → ${addresses.join(", ")}`);
    }
    return addresses;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      console.log(`[DNS] Forward lookup failed for ${hostname}: ${err.code} ${err.message}`);
    }
    return [];
  }
}
