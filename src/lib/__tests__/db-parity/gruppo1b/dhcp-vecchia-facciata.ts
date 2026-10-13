/**
 * Copia CONGELATA delle funzioni del dominio «DHCP» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit b159204, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale; non si
 * modifica. Generata dal parser di TypeScript, con gli aiutanti locali che usava.
 */
import { getDb } from "@/lib/db";
import type { DhcpLease } from "@/lib/db";
import { normalizeMacForStorage } from "@/lib/utils";
import { getNetworkById } from "@/lib/db-tenant";
import type { AdDhcpLease } from "@/lib/db-tenant";
import { resolveDhcpLeaseForHost, resolveAdDhcpLeaseForHost, inferIpAssignment } from "@/lib/ip-assignment";

export function upsertDhcpLease(input: {
  source_type: "mikrotik" | "windows" | "cisco" | "other";
  source_device_id: number;
  source_name?: string | null;
  server_name?: string | null;
  scope_id?: string | null;
  scope_name?: string | null;
  ip_address: string;
  mac_address: string;
  hostname?: string | null;
  status?: string | null;
  lease_start?: string | null;
  lease_expires?: string | null;
  description?: string | null;
  host_id?: number | null;
  network_id?: number | null;
  dynamic_lease?: number | null;
  last_seen?: string | null;
}): void {
  const db = getDb();
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  // v0.2.659: aggiunto last_seen.
  db.prepare(`INSERT INTO dhcp_leases
    (source_type, source_device_id, source_name, server_name, scope_id, scope_name,
     ip_address, mac_address, hostname, status, lease_start, lease_expires, description,
     dynamic_lease, last_seen, host_id, network_id, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_device_id, ip_address) DO UPDATE SET
      source_name = excluded.source_name,
      server_name = excluded.server_name,
      scope_id = excluded.scope_id,
      scope_name = excluded.scope_name,
      mac_address = excluded.mac_address,
      hostname = excluded.hostname,
      status = excluded.status,
      lease_start = excluded.lease_start,
      lease_expires = excluded.lease_expires,
      description = excluded.description,
      dynamic_lease = COALESCE(excluded.dynamic_lease, dhcp_leases.dynamic_lease),
      last_seen = COALESCE(excluded.last_seen, dhcp_leases.last_seen),
      host_id = COALESCE(excluded.host_id, dhcp_leases.host_id),
      network_id = COALESCE(excluded.network_id, dhcp_leases.network_id),
      last_synced = datetime('now')
  `).run(
    input.source_type,
    input.source_device_id,
    input.source_name ?? null,
    input.server_name ?? null,
    input.scope_id ?? null,
    input.scope_name ?? null,
    input.ip_address,
    macNorm,
    input.hostname ?? null,
    input.status ?? null,
    input.lease_start ?? null,
    input.lease_expires ?? null,
    input.description ?? null,
    input.dynamic_lease ?? null,
    input.last_seen ?? null,
    input.host_id ?? null,
    input.network_id ?? null
  );
}

export function syncIpAssignmentsForNetwork(networkId: number): number {
  const network = getNetworkById(networkId);
  if (!network) return 0;
  const rows = getDb().prepare(`SELECT id, ip, mac FROM hosts WHERE network_id = ?`).all(networkId) as {
    id: number;
    ip: string;
    mac: string | null;
  }[];
  if (rows.length === 0) return 0;
  const dhcpLeases = getDb().prepare(`SELECT * FROM dhcp_leases WHERE network_id = ?`).all(networkId) as DhcpLease[];
  const ips = rows.map((r) => r.ip);
  const placeholders = ips.map(() => "?").join(",");
  const adLeasesByIp = getDb()
    .prepare(`SELECT * FROM ad_dhcp_leases WHERE ip_address IN (${placeholders})`)
    .all(...ips) as AdDhcpLease[];
  const byIpAd = new Map<string, AdDhcpLease>();
  for (const a of adLeasesByIp) {
    if (!byIpAd.has(a.ip_address)) byIpAd.set(a.ip_address, a);
  }
  const needsFullAdForMac = rows.some((h) => !!h.mac?.trim() && !byIpAd.get(h.ip));
  const adAllRows = needsFullAdForMac
    ? (getDb().prepare(`SELECT * FROM ad_dhcp_leases`).all() as AdDhcpLease[])
    : [];
  const stmt = getDb().prepare(`UPDATE hosts SET ip_assignment = ?, updated_at = datetime('now') WHERE id = ?`);
  let n = 0;
  for (const h of rows) {
    const dhcpLease = resolveDhcpLeaseForHost(h.ip, h.mac, dhcpLeases);
    const adLease = resolveAdDhcpLeaseForHost(h.ip, h.mac, byIpAd, adAllRows);
    const next = inferIpAssignment(dhcpLease, adLease);
    stmt.run(next, h.id);
    n++;
  }
  return n;
}

export function deleteDhcpLeasesByDevice(deviceId: number): number {
  const r = getDb().prepare("DELETE FROM dhcp_leases WHERE source_device_id = ?").run(deviceId);
  return r.changes;
}
