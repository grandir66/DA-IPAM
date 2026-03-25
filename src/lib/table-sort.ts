import { ipToLong } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

/**
 * Confronto generico per ordinamento tabelle (stringhe it, numeri, null in coda).
 */
export function compareUnknown(a: unknown, b: unknown, dir: SortDirection): number {
  const mul = dir === "asc" ? 1 : -1;

  if (a == null && b == null) return 0;
  if (a == null) return 1 * mul;
  if (b == null) return -1 * mul;

  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : (a < b ? -1 : 1) * mul;
  }

  const sa = String(a);
  const sb = String(b);

  // IPv4: confronto numerico se entrambe sembrano IPv4
  const ipA = /^\d{1,3}(\.\d{1,3}){3}$/.test(sa);
  const ipB = /^\d{1,3}(\.\d{1,3}){3}$/.test(sb);
  if (ipA && ipB) {
    const la = ipToLong(sa);
    const lb = ipToLong(sb);
    return la === lb ? 0 : (la < lb ? -1 : 1) * mul;
  }

  const c = sa.localeCompare(sb, "it", { sensitivity: "base", numeric: true });
  return c * mul;
}

/** ORDER BY sicuro per query subnet paginata (solo chiavi whitelist). */
export function sqlOrderByNetworks(sortKey: string | undefined, sortDir: SortDirection | undefined): string {
  const map: Record<string, string> = {
    name: "n.name",
    cidr: "n.cidr",
    vlan_id: "n.vlan_id",
    location: "COALESCE(n.location, '')",
    total_hosts: "COALESCE(h.total_hosts, 0)",
    online_count: "COALESCE(h.online_count, 0)",
    offline_count: "COALESCE(h.offline_count, 0)",
    last_scan: "last_scan",
  };
  const col = sortKey && map[sortKey] ? map[sortKey] : "n.name";
  const d = sortDir === "desc" ? "DESC" : "ASC";
  return `${col} ${d}`;
}

/** ORDER BY sicuro per lease DHCP paginati. */
export function sqlOrderByDhcpLeases(sortKey: string | undefined, sortDir: SortDirection | undefined): string {
  const map: Record<string, string> = {
    ip_address: "d.ip_address",
    mac_address: "d.mac_address",
    hostname: "COALESCE(d.hostname, '')",
    source_type: "d.source_type",
    device_name: "COALESCE(nd.name, '')",
    network_name: "COALESCE(n.name, '')",
    status: "COALESCE(d.status, '')",
    last_synced: "d.last_synced",
  };
  const col = sortKey && map[sortKey] ? map[sortKey] : "d.last_synced";
  const d = sortDir === "desc" ? "DESC" : "ASC";
  return `${col} ${d}`;
}
