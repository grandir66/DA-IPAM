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

/**
 * Chiave numerica per ordinare IPv4 e CIDR: "10.0.0.2" < "10.0.0.10",
 * "10.0.0.0/16" < "10.0.0.0/24". null se non è un IPv4 (hostname, vuoto).
 * Registrata come funzione SQLite `ip_sort_key` su ogni connessione tenant: prima
 * le liste paginate ordinavano IP e CIDR come testo (difetto UI-9, 2026-10-12).
 */
export function ipSortKey(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const parti = m.slice(1, 5).map(Number);
  if (parti.some((p) => p > 255)) return null;
  const ip = ((parti[0] * 256 + parti[1]) * 256 + parti[2]) * 256 + parti[3];
  return ip * 64 + (m[5] !== undefined ? Number(m[5]) : 32);
}

/**
 * ORDER BY delle liste paginate: solo chiavi ammesse, più uno spareggio sull'id
 * così a valori uguali l'ordine è stabile fra una pagina e l'altra. Ogni colonna
 * cliccabile della pagina deve stare qui (lo verifica table-sort-ip.test.ts):
 * prima "Ultimo visto" del DHCP ricadeva in silenzio su "Ultimo sync".
 */
function orderBy(
  map: Record<string, string>,
  fallback: string,
  idCol: string,
  sortKey: string | undefined,
  sortDir: SortDirection | undefined,
): string {
  const col = sortKey && map[sortKey] ? map[sortKey] : fallback;
  const d = sortDir === "desc" ? "DESC" : "ASC";
  return `${col} ${d}, ${idCol} ${d}`;
}

const NETWORK_ORDER: Record<string, string> = {
  name: "n.name",
  cidr: "ip_sort_key(n.cidr)",
  vlan_id: "n.vlan_id",
  location: "COALESCE(n.location, '')",
  total_hosts: "COALESCE(h.total_hosts, 0)",
  online_count: "COALESCE(h.online_count, 0)",
  offline_count: "COALESCE(h.offline_count, 0)",
  last_scan: "last_scan",
};
export const NETWORK_SORT_KEYS = Object.keys(NETWORK_ORDER);

/** ORDER BY sicuro per query subnet paginata. */
export function sqlOrderByNetworks(sortKey: string | undefined, sortDir: SortDirection | undefined): string {
  return orderBy(NETWORK_ORDER, "n.name", "n.id", sortKey, sortDir);
}

const DHCP_LEASE_ORDER: Record<string, string> = {
  ip_address: "ip_sort_key(d.ip_address)",
  mac_address: "d.mac_address",
  hostname: "COALESCE(d.hostname, '')",
  source_type: "d.source_type",
  device_name: "COALESCE(nd.name, '')",
  network_name: "COALESCE(n.name, '')",
  status: "COALESCE(d.status, '')",
  last_seen: "d.last_seen",
  last_synced: "d.last_synced",
};
export const DHCP_LEASE_SORT_KEYS = Object.keys(DHCP_LEASE_ORDER);

/** ORDER BY sicuro per lease DHCP paginati. */
export function sqlOrderByDhcpLeases(sortKey: string | undefined, sortDir: SortDirection | undefined): string {
  return orderBy(DHCP_LEASE_ORDER, "d.last_synced", "d.id", sortKey, sortDir);
}
