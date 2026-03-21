import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ========================
// IP / CIDR Utilities
// ========================

export function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function longToIp(n: number): string {
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ].join(".");
}

export function parseCidr(cidr: string): { network: string; prefix: number; networkLong: number; broadcastLong: number; total: number } {
  const [ip, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const networkLong = (ipToLong(ip) & mask) >>> 0;
  const broadcastLong = (networkLong | ~mask) >>> 0;
  const total = broadcastLong - networkLong + 1;

  return {
    network: longToIp(networkLong),
    prefix,
    networkLong,
    broadcastLong,
    total,
  };
}

export function getAllHostIps(cidr: string): string[] {
  const { networkLong, broadcastLong, prefix } = parseCidr(cidr);

  if (prefix >= 31) {
    // /31 and /32 - return all IPs
    const ips: string[] = [];
    for (let i = networkLong; i <= broadcastLong; i++) {
      ips.push(longToIp(i));
    }
    return ips;
  }

  // Exclude network and broadcast addresses
  const ips: string[] = [];
  for (let i = networkLong + 1; i < broadcastLong; i++) {
    ips.push(longToIp(i));
  }
  return ips;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const { networkLong, broadcastLong } = parseCidr(cidr);
  const ipLong = ipToLong(ip);
  return ipLong >= networkLong && ipLong <= broadcastLong;
}

/** Verifica se due CIDR si sovrappongono (range overlap). */
export function cidrOverlaps(cidr1: string, cidr2: string): boolean {
  const a = parseCidr(cidr1);
  const b = parseCidr(cidr2);
  return a.networkLong <= b.broadcastLong && b.networkLong <= a.broadcastLong;
}

export function subnetMaskFromPrefix(prefix: number): string {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return longToIp(mask);
}

export function normalizeMac(mac: string): string {
  return mac.replace(/[:-]/g, "").toUpperCase().replace(/(.{2})/g, "$1:").slice(0, -1);
}

/** Canonical hex-only form per confronto MAC (ignora : - .) */
export function macToHex(mac: string): string {
  return (mac || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase().padEnd(12, "0").slice(0, 12);
}

/** Normalizza nome porta per match (es. "Port 1" e "Port1" → "port1") */
export function normalizePortNameForMatch(name: string): string {
  return (name || "").replace(/\s+/g, "").toLowerCase();
}

export function formatIpSort(ip: string): string {
  return ip.split(".").map((p) => p.padStart(3, "0")).join(".");
}

const IPV4_FULL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIpv4(s: string): boolean {
  const m = s.match(IPV4_FULL);
  if (!m) return false;
  return [m[1], m[2], m[3], m[4]].every((o) => {
    const n = parseInt(o, 10);
    return n >= 0 && n <= 255;
  });
}

/**
 * Espande notazione breve IPv4: `192.168.40.1,2,3,4,5` → cinque indirizzi (stesso /24).
 * Supporta anche voci successive come IPv4 completi. Hostname senza virgole resta invariato.
 */
export function expandIpv4CommaShorthand(input: string): string[] {
  const trimmed = input.trim().replace(/^https?:\/\//i, "");
  const hostOnly = trimmed.split("/")[0] ?? trimmed;
  const beforePath = hostOnly.split(":")[0]?.trim() ?? "";
  if (!beforePath.includes(",")) {
    return [beforePath].filter(Boolean);
  }
  const parts = beforePath.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0]!;
  if (!isValidIpv4(first)) {
    return [beforePath];
  }
  const prefixMatch = first.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}$/);
  if (!prefixMatch) return [first];
  const prefix = prefixMatch[1]!;
  const out: string[] = [first];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (/^\d{1,3}$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 0 && n <= 255) out.push(`${prefix}${p}`);
    } else if (isValidIpv4(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Estrae solo i numeri di porta da ports_open (JSON). Supporta vecchio formato "80/tcp (http)" e nuovo "80". */
export function formatPortsDisplay(portsOpenJson: string | null): string {
  if (!portsOpenJson) return "—";
  try {
    const arr = JSON.parse(portsOpenJson) as string[];
    const nums = arr.map((x) => String(x).split("/")[0].trim());
    return nums.filter(Boolean).join(", ") || "—";
  } catch {
    return "—";
  }
}
