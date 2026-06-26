/** Helper condivisi per UI DHCP Kea. */
import type { DhcpSubnet } from "@/lib/network-services/client";

export function dhcpField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

export function optionDataValue(subnet: DhcpSubnet, name: string): string {
  const opts = subnet["option-data"] ?? [];
  const hit = opts.find((o) => o.name === name);
  return hit?.data ?? "";
}

export function parsePoolRange(subnet: DhcpSubnet): { start: string; end: string } {
  const pool = subnet.pools?.[0]?.pool ?? "";
  const m = pool.match(/^(.+?)\s*-\s*(.+)$/);
  if (!m) return { start: "", end: "" };
  return { start: m[1].trim(), end: m[2].trim() };
}

export function normalizeMac(mac: string): string {
  return mac.trim().toLowerCase().replace(/-/g, ":");
}
