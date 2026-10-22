/**
 * CRUD per librenms_host_map nel DB tenant.
 * Usa getTenantDb + getCurrentTenantCode perché db() è privato a db-tenant.ts.
 */
import { getTenantDb, getCurrentTenantCode, livelloSchemaLibrenms } from "../db-tenant";
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

/**
 * Recupera il mapping per tutti i NetworkDevice (router/switch).
 * Usa network_id = 0 come sentinella per distinguerli dagli Host.
 */
export function getLibreNMSMapForNetworkDevices(): LibreNMSHostMap[] {
  return db().prepare(
    "SELECT * FROM librenms_host_map WHERE network_id = 0 ORDER BY host_ip"
  ).all() as LibreNMSHostMap[];
}

export function getLibreNMSMapByDeviceIp(ip: string): LibreNMSHostMap | null {
  return db().prepare(
    "SELECT * FROM librenms_host_map WHERE network_id = 0 AND host_ip = ?"
  ).get(ip) as LibreNMSHostMap | null;
}

/** Codici di un'aggiunta rifiutata da LibreNMS (piano 2026-10-22 LibreNMS, task 1). */
export type CodiceRifiuto = "snmp_non_risponde" | "gia_presente" | "rifiutato" | "rete" | "senza_snmp";

/**
 * Il rifiuto di un'aggiunta: una riga in `librenms_rifiuto` per IP (l'ultima vince) e, se l'IP ha già una riga di mappa,
 * `last_status = 'rifiutato: …'` lì. Nessuna riga di mappa nuova. Senza lo schema della fonte (migrazione fallita) si
 * scrive solo la mappa. Restituisce se la riga del rifiuto è stata scritta.
 */
export function scriviRifiutoLibrenms(
  ip: string,
  r: { hostId?: number | null; networkDeviceId?: number | null; codice: CodiceRifiuto; motivo: string },
): boolean {
  const d = db();
  const stato = `rifiutato: ${r.motivo}`.slice(0, 500);
  d.prepare("UPDATE librenms_host_map SET last_status = ? WHERE host_ip = ?").run(stato, ip);
  if (livelloSchemaLibrenms() < 1) return false;
  d.prepare(
    `INSERT INTO librenms_rifiuto (ip, host_id, network_device_id, codice, motivo, il) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ip) DO UPDATE SET host_id = excluded.host_id, network_device_id = excluded.network_device_id,
       codice = excluded.codice, motivo = excluded.motivo, il = excluded.il`
  ).run(ip, r.hostId ?? null, r.networkDeviceId ?? null, r.codice, r.motivo.slice(0, 500));
  return true;
}

/** Un'aggiunta riuscita toglie il rifiuto di prima di quell'IP. */
export function togliRifiutoLibrenms(ip: string): void {
  if (livelloSchemaLibrenms() < 1) return;
  db().prepare("DELETE FROM librenms_rifiuto WHERE ip = ?").run(ip);
}
