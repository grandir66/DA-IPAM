/**
 * CRUD per librenms_host_map nel DB tenant.
 * Usa getTenantDb + getCurrentTenantCode perché db() è privato a db-tenant.ts.
 */
import { getTenantDb, getCurrentTenantCode } from "../db-tenant";
import type { LibreNMSHostMap } from "@/types";

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

export function upsertLibreNMSMap(
  networkId: number,
  hostIp: string,
  librenmsDeviceId: number,
  librenmsHostname: string | null,
  lastStatus: string | null = null
): void {
  db().prepare(
    `INSERT INTO librenms_host_map (network_id, host_ip, librenms_device_id, librenms_hostname, last_synced_at, last_status)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(network_id, host_ip) DO UPDATE SET
       librenms_device_id = excluded.librenms_device_id,
       librenms_hostname   = excluded.librenms_hostname,
       last_synced_at      = datetime('now'),
       last_status         = excluded.last_status`
  ).run(networkId, hostIp, librenmsDeviceId, librenmsHostname, lastStatus);
}

export function getLibreNMSMapByIp(networkId: number, hostIp: string): LibreNMSHostMap | null {
  return db().prepare(
    "SELECT * FROM librenms_host_map WHERE network_id = ? AND host_ip = ?"
  ).get(networkId, hostIp) as LibreNMSHostMap | null;
}

export function getLibreNMSMapByDeviceId(librenmsDeviceId: number): LibreNMSHostMap | null {
  return db().prepare(
    "SELECT * FROM librenms_host_map WHERE librenms_device_id = ?"
  ).get(librenmsDeviceId) as LibreNMSHostMap | null;
}

export function getLibreNMSMapForNetwork(networkId: number): LibreNMSHostMap[] {
  return db().prepare(
    "SELECT * FROM librenms_host_map WHERE network_id = ? ORDER BY host_ip"
  ).all(networkId) as LibreNMSHostMap[];
}

export function deleteLibreNMSMap(networkId: number, hostIp: string): void {
  db().prepare(
    "DELETE FROM librenms_host_map WHERE network_id = ? AND host_ip = ?"
  ).run(networkId, hostIp);
}

export function updateLibreNMSStatus(librenmsDeviceId: number, lastStatus: string): void {
  db().prepare(
    "UPDATE librenms_host_map SET last_status = ?, last_synced_at = datetime('now') WHERE librenms_device_id = ?"
  ).run(lastStatus, librenmsDeviceId);
}
