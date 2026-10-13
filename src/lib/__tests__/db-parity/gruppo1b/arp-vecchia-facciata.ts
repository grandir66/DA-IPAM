/**
 * Copia CONGELATA delle funzioni del dominio «ARP, vicini, rotte e porte» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit e1fd38b, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale, salvo
 * i moduli presi con `import("./x")` o `require("./x")`, che puntano a `@/lib/x` perché la copia vive
 * in un'altra cartella; non si modifica. Generata dal parser di TypeScript, con gli
 * aiutanti locali che usava.
 */
import { getDb } from "@/lib/db";
import type { MacIpMappingSource } from "@/lib/db-tenant";
import { macToHex, normalizeMac } from "@/lib/utils";

export function markHostsOffline(networkId: number, onlineIps: string[], scannedIps?: string[]): void {
  if (scannedIps?.length) {
    const onlineSet = new Set(onlineIps);
    const toOffline = scannedIps.filter((ip) => !onlineSet.has(ip));
    if (toOffline.length === 0) return;
    const ph = toOffline.map(() => "?").join(",");
    getDb().prepare(
      `UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND ip IN (${ph})`
    ).run(networkId, ...toOffline);
    return;
  }
  if (onlineIps.length === 0) {
    getDb().prepare(
      "UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND status = 'online'"
    ).run(networkId);
    return;
  }
  const placeholders = onlineIps.map(() => "?").join(",");
  getDb().prepare(
    `UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND status = 'online' AND ip NOT IN (${placeholders})`
  ).run(networkId, ...onlineIps);
}

export function upsertMacIpMapping(input: {
  mac: string;
  ip: string;
  source: MacIpMappingSource;
  source_device_id?: number | null;
  network_id?: number | null;
  host_id?: number | null;
  vendor?: string | null;
  hostname?: string | null;
}): void {
  const db = getDb();
  const hex = macToHex(input.mac);
  const display = normalizeMac(input.mac);
  const now = new Date().toISOString();

  const existing = db.prepare(
    "SELECT id, ip, last_seen FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { id: number; ip: string; last_seen: string } | undefined;

  if (existing) {
    const ipChanged = existing.ip !== input.ip;
    db.prepare(`
      UPDATE mac_ip_mapping SET
        ip = ?,
        source = ?,
        source_device_id = COALESCE(?, source_device_id),
        network_id = COALESCE(?, network_id),
        host_id = COALESCE(?, host_id),
        vendor = COALESCE(?, vendor),
        hostname = COALESCE(?, hostname),
        last_seen = ?,
        previous_ip = CASE WHEN ? = 1 THEN ? ELSE previous_ip END
      WHERE mac_normalized = ?
    `).run(
      input.ip,
      input.source,
      input.source_device_id ?? null,
      input.network_id ?? null,
      input.host_id ?? null,
      input.vendor ?? null,
      input.hostname ?? null,
      now,
      ipChanged ? 1 : 0,
      ipChanged ? existing.ip : null,
      hex
    );
    if (ipChanged) {
      db.prepare(
        "INSERT INTO mac_ip_history (mac_normalized, ip, source) VALUES (?, ?, ?)"
      ).run(hex, input.ip, input.source);
    }
  } else {
    db.prepare(`
      INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id, vendor, hostname, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hex,
      display,
      input.ip,
      input.source,
      input.source_device_id ?? null,
      input.network_id ?? null,
      input.host_id ?? null,
      input.vendor ?? null,
      input.hostname ?? null,
      now,
      now
    );
  }
}

export function getMacIpMappings(opts?: {
  network_id?: number;
  source?: import("@/lib/db").MacIpMappingSource;
  q?: string;
  limit?: number;
}): import("@/types").MacIpMapping[] {
  let sql = `
    SELECT m.*, n.name as network_name, nd.name as source_device_name
    FROM mac_ip_mapping m
    LEFT JOIN networks n ON n.id = m.network_id
    LEFT JOIN network_devices nd ON nd.id = m.source_device_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (opts?.network_id) {
    sql += " AND m.network_id = ?";
    params.push(opts.network_id);
  }
  if (opts?.source) {
    sql += " AND m.source = ?";
    params.push(opts.source);
  }
  if (opts?.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    const qNorm = `%${opts.q.trim().replace(/[:-]/g, "")}%`;
    sql += " AND (m.mac_display LIKE ? OR m.mac_normalized LIKE ? OR m.ip LIKE ? OR m.hostname LIKE ?)";
    params.push(q, qNorm, q, q);
  }
  sql += " ORDER BY m.last_seen DESC";
  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  return getDb().prepare(sql).all(...params) as import("@/types").MacIpMapping[];
}

export function upsertMacPortEntries(deviceId: number, entries: { mac: string; port_name: string; vlan: number | null; port_status: "up" | "down" | null; speed: string | null }[]): void {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM mac_port_entries WHERE device_id = ?");
  const stmt = db.prepare(
    `INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const replaceAll = db.transaction((items: typeof entries) => {
    deleteStmt.run(deviceId);
    for (const entry of items) {
      stmt.run(deviceId, entry.mac, entry.port_name, entry.vlan, entry.port_status, entry.speed);
    }
  });

  replaceAll(entries);
}

export function upsertNeighbors(
  deviceId: number,
  neighbors: Array<{
    localPort: string;
    remoteDevice: string;
    remotePort: string;
    protocol: string;
    remoteIp?: string;
    remoteMac?: string;
    remotePlatform?: string;
  }>
): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM device_neighbors WHERE device_id = ?");
  // OR IGNORE: vedi nota in db-tenant.ts — duplicati di chiave nello stesso
  // batch LLDP/CDP non devono interrompere la persistenza dei vicini.
  const ins = db.prepare(`
    INSERT OR IGNORE INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    del.run(deviceId);
    for (const n of neighbors) {
      ins.run(deviceId, n.localPort, n.remoteDevice, n.remotePort, n.protocol, n.remoteIp ?? null, n.remoteMac ?? null, n.remotePlatform ?? null);
    }
  })();

  // Attribution v2: i vicini LLDP/CDP appena scritti sono evidenza per gli host remoti
  try {
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    const touched = db.prepare(
      `SELECT DISTINCT h.id FROM hosts h
       JOIN device_neighbors dn ON dn.device_id = ?
        AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac)
          OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))`
    ).all(deviceId) as Array<{ id: number }>;
    for (const t of touched) recomputeAttributionSafe(t.id, "scan");
  } catch (e) {
    console.error("[attribution] recompute da neighbors fallito:", e);
  }
}

export function upsertRoutes(
  deviceId: number,
  routes: Array<{
    destination: string;
    gateway: string | null;
    interface_name: string | null;
    protocol: string;
    metric?: number;
    distance?: number;
    active: boolean;
  }>
): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM routing_table WHERE device_id = ?");
  const ins = db.prepare(`
    INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, metric, distance, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    del.run(deviceId);
    for (const r of routes) {
      ins.run(deviceId, r.destination, r.gateway ?? null, r.interface_name ?? null, r.protocol, r.metric ?? null, r.distance ?? null, r.active ? 1 : 0);
    }
  })();
}
