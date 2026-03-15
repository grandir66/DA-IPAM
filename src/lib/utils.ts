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
