/**
 * Entry-point per eseguire l'anomaly check manualmente (da API o cron).
 * Richiama la stessa logica di jobs.ts ma esposta come funzione importabile.
 */

import {
  checkMacFlip,
  checkNewUnknownHosts,
  checkPortChanges,
  checkUptimeAnomaly,
  checkLatencyAnomaly,
  type HostForAnomaly,
  type ScanHistoryForAnomaly,
  type StatusHistoryEntry,
} from "./anomaly";
import { insertAnomalyEvent, hasOpenAnomaly } from "./anomaly-db";
import {
  getAllHostsFlat,
  getStatusHistory,
  getHostLatencyHistory,
  getScanHistory,
  getCurrentTenantCode,
  getTenantDb,
} from "@/lib/db-tenant";

export async function runAnomalyCheckManual(networkId: number | null): Promise<number> {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  const db = getTenantDb(code);

  let created = 0;

  const allHosts = getAllHostsFlat();
  const hosts: HostForAnomaly[] = allHosts
    .filter((h) => !networkId || h.network_id === networkId)
    .map((h) => ({
      id: h.id,
      ip: h.ip,
      mac: h.mac ?? null,
      vendor: h.vendor ?? null,
      network_id: h.network_id,
      known_host: h.known_host ?? 0,
      first_seen: h.first_seen ?? null,
      status: h.status ?? "unknown",
      open_ports: (h as unknown as { open_ports?: string }).open_ports ?? null,
    }));

  if (hosts.length === 0) return 0;

  // MAC flip
  const recentArp = db.prepare(
    `SELECT host_id, mac, ip, timestamp FROM arp_entries
     WHERE timestamp >= datetime('now', '-2 hours') ORDER BY timestamp DESC`
  ).all() as { host_id: number | null; mac: string; ip: string | null; timestamp: string }[];

  for (const ev of checkMacFlip(hosts, recentArp)) {
    if (ev.host_id && hasOpenAnomaly(ev.host_id, "mac_flip", 24)) continue;
    insertAnomalyEvent(ev);
    created++;
  }

  // Nuovi host
  for (const ev of checkNewUnknownHosts(hosts)) {
    if (ev.host_id && hasOpenAnomaly(ev.host_id, "new_unknown_host", 4)) continue;
    insertAnomalyEvent(ev);
    created++;
  }

  // Port changes
  const hostScans = new Map<number, ScanHistoryForAnomaly[]>();
  for (const host of hosts.filter((h) => h.known_host === 1)) {
    const scans = getScanHistory({ host_id: host.id, limit: 3 });
    const withPorts = scans
      .filter((s) => s.ports_open != null)
      .map((s) => ({ host_id: host.id, ports_open: s.ports_open, timestamp: s.timestamp }));
    if (withPorts.length >= 2) hostScans.set(host.id, withPorts);
  }
  for (const ev of checkPortChanges(hostScans, hosts)) {
    if (ev.host_id && hasOpenAnomaly(ev.host_id, "port_change", 12)) continue;
    insertAnomalyEvent(ev);
    created++;
  }

  // Uptime + latency per known hosts
  for (const host of hosts.filter((h) => h.known_host === 1)) {
    const history = getStatusHistory(host.id, 500) as StatusHistoryEntry[];
    const uptimeEv = checkUptimeAnomaly(host.id, host.network_id, host.ip, history);
    if (uptimeEv && !hasOpenAnomaly(host.id, "uptime_anomaly", 24)) {
      insertAnomalyEvent(uptimeEv);
      created++;
    }

    const latHistory = getHostLatencyHistory(host.id, 72);
    const latEv = checkLatencyAnomaly(host.id, host.network_id, host.ip, latHistory);
    if (latEv && !hasOpenAnomaly(host.id, "latency_anomaly", 6)) {
      insertAnomalyEvent(latEv);
      created++;
    }
  }

  return created;
}
