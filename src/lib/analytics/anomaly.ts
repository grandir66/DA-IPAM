/**
 * Checker per l'anomaly detection.
 * Ogni funzione è pura (riceve dati, ritorna eventi da salvare) e non ha side-effect DB.
 * Il chiamante (cron job o API) è responsabile di persistere gli eventi con anomaly-db.ts.
 */

import { parseDbDate } from "@/lib/db-date";
import type {
  AnomalyType,
  AnomalySeverity,
  MacFlipDetail,
  PortChangeDetail,
  UptimeAnomalyDetail,
  LatencyAnomalyDetail,
} from "@/types";

export interface PendingAnomalyEvent {
  host_id: number | null;
  network_id: number | null;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detail_json: string | null;
}

// Input types (dati già letti dal DB dal chiamante)

export interface HostForAnomaly {
  id: number;
  ip: string;
  mac: string | null;
  vendor: string | null;
  network_id: number;
  known_host: number;
  first_seen: string | null;
  status: string;
  open_ports: string | null; // JSON
}

export interface ArpEntryForAnomaly {
  host_id: number | null;
  mac: string;
  ip: string | null;
  timestamp: string;
}

export interface ScanHistoryForAnomaly {
  host_id: number;
  scan_type: string;
  ports_open: string | null;
  timestamp: string;
}

export interface StatusHistoryEntry {
  host_id: number;
  status: string;
  response_time_ms: number | null;
  checked_at: string;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function normMac(mac: string): string {
  return mac.toUpperCase().replace(/[:\-. ]/g, "");
}

/** z-score: (x - media) / deviazione_std. Ritorna 0 se std = 0. */
function zScore(values: number[], x: number): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : (x - mean) / std;
}

/** Lo storico usa anche stringhe numeriche, l'inventario usa oggetti con la porta. */
function parsePorts(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const ports = new Set<number>();
    for (const value of parsed) {
      const raw: unknown = typeof value === "object" && value !== null && "port" in value ? value.port : value;
      const port = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
      ports.add(port);
    }
    return [...ports];
  } catch {
    return null;
  }
}

const HIGH_RISK_PORTS = new Set([22, 23, 3389, 445, 135, 139, 5985, 5986]);

// ── 1. MAC Flip ───────────────────────────────────────────────────────────────

/**
 * Rileva host per cui una entry ARP recente mostra un MAC diverso da quello registrato.
 * Esclude host visti per la prima volta (first_seen < 1 ora fa).
 */
export function checkMacFlip(
  hosts: HostForAnomaly[],
  recentArpEntries: ArpEntryForAnomaly[],
  now = Date.now(),
): PendingAnomalyEvent[] {
  const events: PendingAnomalyEvent[] = [];

  const hostByIp = new Map<string, HostForAnomaly>();
  for (const h of hosts) {
    if (h.ip) hostByIp.set(h.ip, h);
  }

  for (const arp of recentArpEntries) {
    if (!arp.ip || !arp.mac) continue;
    const host = hostByIp.get(arp.ip);
    if (!host || !host.mac) continue;

    // Ignora host visti per la prima volta nell'ultima ora
    if (host.first_seen) {
      const firstSeenMs = parseDbDate(host.first_seen).getTime();
      const ageHours = (now - firstSeenMs) / 3_600_000;
      if (ageHours < 1) continue;
    }

    if (normMac(arp.mac) !== normMac(host.mac)) {
      const detail: MacFlipDetail = {
        ip: host.ip,
        old_mac: host.mac,
        new_mac: arp.mac,
        old_vendor: host.vendor ?? null,
        new_vendor: null,
      };
      events.push({
        host_id: host.id,
        network_id: host.network_id,
        anomaly_type: "mac_flip",
        severity: "high",
        description: `MAC cambiato su ${host.ip}: ${host.mac} → ${arp.mac}`,
        detail_json: JSON.stringify(detail),
      });
    }
  }

  return events;
}

// ── 2. Nuovo host non censito ─────────────────────────────────────────────────

/**
 * Rileva host con known_host = 0 comparsi nell'ultima ora.
 * Severity alta se ha porte ad alto rischio aperte.
 */
export function checkNewUnknownHosts(hosts: HostForAnomaly[], now = Date.now()): PendingAnomalyEvent[] {
  const events: PendingAnomalyEvent[] = [];
  const oneHourAgo = now - 3_600_000;

  for (const host of hosts) {
    if (host.known_host !== 0 || !host.first_seen) continue;
    const firstSeen = parseDbDate(host.first_seen).getTime();
    if (!(firstSeen >= oneHourAgo && firstSeen <= now)) continue;

    const ports = parsePorts(host.open_ports) ?? [];
    const hasHighRisk = ports.some((p) => HIGH_RISK_PORTS.has(p));
    const severity: AnomalySeverity = hasHighRisk ? "high" : "medium";
    const portInfo = ports.length > 0 ? ` (porte: ${ports.slice(0, 5).join(", ")})` : "";

    events.push({
      host_id: host.id,
      network_id: host.network_id,
      anomaly_type: "new_unknown_host",
      severity,
      description: `Nuovo host non censito rilevato: ${host.ip}${portInfo}`,
      detail_json: JSON.stringify({ ip: host.ip, mac: host.mac, open_ports: ports }),
    });
  }

  return events;
}

// ── 3. Port Change anomalo ────────────────────────────────────────────────────

/**
 * Confronta le porte dell'ultimo scan con gli scan precedenti dello stesso tipo.
 * Anomalia se: >= 3 porte cambiate, o rimozione/aggiunta di porte ad alto rischio.
 */
export function checkPortChanges(
  hostScans: Map<number, ScanHistoryForAnomaly[]>,
  hosts: HostForAnomaly[]
): PendingAnomalyEvent[] {
  const events: PendingAnomalyEvent[] = [];

  const hostById = new Map<number, HostForAnomaly>();
  for (const h of hosts) hostById.set(h.id, h);

  for (const [hostId, scans] of hostScans) {
    if (scans.length < 2) continue;

    const sorted = scans
      .map((scan) => ({ scan, time: parseDbDate(scan.timestamp).getTime() }))
      .filter(({ time }) => Number.isFinite(time))
      .sort((a, b) => b.time - a.time);
    const [latest, ...previous] = sorted;
    if (!latest) continue;
    const current = parsePorts(latest.scan.ports_open);
    if (!current) continue;
    const currentPorts = new Set(current);
    const baselinePorts = new Set<number>();
    let hasBaseline = false;
    for (const { scan } of previous) {
      if (scan.scan_type !== latest.scan.scan_type) continue;
      const ports = parsePorts(scan.ports_open);
      if (!ports) continue;
      hasBaseline = true;
      for (const port of ports) baselinePorts.add(port);
    }

    if (!hasBaseline || (baselinePorts.size === 0 && currentPorts.size === 0)) continue;

    const added = [...currentPorts].filter((p) => !baselinePorts.has(p));
    const removed = [...baselinePorts].filter((p) => !currentPorts.has(p));
    const totalDiff = added.length + removed.length;

    const hasHighRiskChange =
      added.some((p) => HIGH_RISK_PORTS.has(p)) ||
      removed.some((p) => HIGH_RISK_PORTS.has(p));

    if (totalDiff < 3 && !hasHighRiskChange) continue;

    const host = hostById.get(hostId);
    const severity: AnomalySeverity = hasHighRiskChange ? "high" : "medium";
    const ip = host?.ip ?? `host #${hostId}`;

    const detail: PortChangeDetail = {
      ip,
      ports_added: added,
      ports_removed: removed,
      baseline_ports: [...baselinePorts],
      current_ports: [...currentPorts],
    };

    const parts: string[] = [];
    if (added.length > 0) parts.push(`+${added.slice(0, 5).join(",")}`);
    if (removed.length > 0) parts.push(`-${removed.slice(0, 5).join(",")}`);

    events.push({
      host_id: hostId,
      network_id: host?.network_id ?? null,
      anomaly_type: "port_change",
      severity,
      description: `Cambio porte su ${ip}: ${parts.join(" ")}`,
      detail_json: JSON.stringify(detail),
    });
  }

  return events;
}

// ── 4. Uptime Anomaly ─────────────────────────────────────────────────────────

/**
 * Calcola offline_rate nelle ultime 48h vs baseline (giorni 3-7).
 * Anomalia se la differenza supera il 30%.
 * Ritorna al massimo 1 evento per host.
 */
export function checkUptimeAnomaly(
  hostId: number,
  networkId: number,
  ip: string,
  history: StatusHistoryEntry[],
  now = Date.now(),
): PendingAnomalyEvent | null {
  if (history.length < 10) return null;

  const cutoff48h = now - 48 * 3_600_000;
  const cutoff7d = now - 7 * 24 * 3_600_000;
  const recent: StatusHistoryEntry[] = [];
  const baseline: StatusHistoryEntry[] = [];
  for (const entry of history) {
    const time = parseDbDate(entry.checked_at).getTime();
    if (time >= cutoff48h && time <= now) recent.push(entry);
    else if (time >= cutoff7d && time < cutoff48h) baseline.push(entry);
  }

  if (recent.length < 5 || baseline.length < 5) return null;

  const offlineRate = (arr: StatusHistoryEntry[]) =>
    arr.filter((h) => h.status === "offline").length / arr.length;

  const recentRate = offlineRate(recent);
  const baselineRate = offlineRate(baseline);
  const diff = Math.abs(recentRate - baselineRate);

  if (diff < 0.3) return null;

  const detail: UptimeAnomalyDetail = {
    ip,
    offline_rate_recent: Math.round(recentRate * 100) / 100,
    offline_rate_baseline: Math.round(baselineRate * 100) / 100,
    check_window_hours: 48,
  };

  const direction = recentRate > baselineRate ? "diminuita" : "aumentata";
  return {
    host_id: hostId,
    network_id: networkId,
    anomaly_type: "uptime_anomaly",
    severity: "low",
    description: `Disponibilità ${direction} su ${ip}: ${Math.round(recentRate * 100)}% offline (baseline ${Math.round(baselineRate * 100)}%)`,
    detail_json: JSON.stringify(detail),
  };
}

// ── 5. Latency Anomaly ────────────────────────────────────────────────────────

/**
 * Calcola z-score della latenza media recente (ultime 24h) rispetto alla baseline (24-72h).
 * Anomalia se z-score > 2.5 e baseline ha almeno 10 campioni validi.
 */
export function checkLatencyAnomaly(
  hostId: number,
  networkId: number,
  ip: string,
  history: { time: string; response_time_ms: number | null; status: string }[],
  now = Date.now(),
): PendingAnomalyEvent | null {
  const cut24h = now - 24 * 3_600_000;
  const cut72h = now - 72 * 3_600_000;
  const baseline: number[] = [];
  const recent: number[] = [];
  for (const entry of history) {
    if (entry.status !== "online" || entry.response_time_ms === null) continue;
    const time = parseDbDate(entry.time).getTime();
    if (time >= cut24h && time <= now) recent.push(entry.response_time_ms);
    else if (time >= cut72h && time < cut24h) baseline.push(entry.response_time_ms);
  }

  if (baseline.length < 10 || recent.length < 3) return null;

  const recentMean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const z = zScore(baseline, recentMean);

  if (Math.abs(z) < 2.5) return null;

  const baselineMean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  const baselineVariance = baseline.reduce((s, v) => s + (v - baselineMean) ** 2, 0) / baseline.length;
  const baselineStd = Math.sqrt(baselineVariance);

  const severity: AnomalySeverity = Math.abs(z) > 5 ? "high" : Math.abs(z) > 3.5 ? "medium" : "low";

  const detail: LatencyAnomalyDetail = {
    ip,
    current_ms: Math.round(recentMean),
    baseline_mean_ms: Math.round(baselineMean),
    baseline_stddev_ms: Math.round(baselineStd),
    z_score: Math.round(z * 100) / 100,
  };

  const direction = recentMean > baselineMean ? "aumentata" : "diminuita";
  return {
    host_id: hostId,
    network_id: networkId,
    anomaly_type: "latency_anomaly",
    severity,
    description: `Latenza ${direction} su ${ip}: ${Math.round(recentMean)}ms (baseline ${Math.round(baselineMean)}ms, z=${detail.z_score})`,
    detail_json: JSON.stringify(detail),
  };
}
