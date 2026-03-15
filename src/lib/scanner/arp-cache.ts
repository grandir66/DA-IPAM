import { execFile } from "child_process";
import { promisify } from "util";
import { normalizeMac } from "@/lib/utils";

const execFileAsync = promisify(execFile);

interface ArpCacheEntry {
  ip: string;
  mac: string;
}

/**
 * Read the local system ARP cache to get MAC addresses for recently-pinged hosts
 * on the local subnet. Only works for hosts on the same L2 segment.
 */
export async function readArpCache(): Promise<ArpCacheEntry[]> {
  try {
    const { stdout } = await execFileAsync("arp", ["-a"]);
    const entries: ArpCacheEntry[] = [];

    for (const line of stdout.split("\n")) {
      // macOS format: host.name (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ...
      // Linux format: host.name (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0
      const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]+)/);
      if (match && match[2] !== "(incomplete)") {
        entries.push({
          ip: match[1],
          mac: normalizeMac(match[2]),
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export async function getMacForIp(ip: string): Promise<string | null> {
  const cache = await readArpCache();
  const entry = cache.find((e) => e.ip === ip);
  return entry?.mac || null;
}
