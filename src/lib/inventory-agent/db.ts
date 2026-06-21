/**
 * CRUD tenant DB — inventory agent ingest.
 */
import { createHash } from "node:crypto";
import { getTenantDb, getCurrentTenantCode, getHostByIp, getHostByMac } from "@/lib/db-tenant";
import type { ParsedGlpiInventory, ParsedGlpiSoftware } from "@/lib/inventory-agent/parse-glpi-inventory";

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

export interface InvAgentEndpointRow {
  device_id: string;
  host_id: number | null;
  hostname: string | null;
  primary_ip: string | null;
  primary_mac: string | null;
  os_family: string | null;
  os_name: string | null;
  os_version: string | null;
  agent_tag: string | null;
  last_report_id: number | null;
  last_seen_at: string;
  apps_count?: number | null;
  match_status?: string | null;
}

export interface InvAgentSoftwareRow {
  id: number;
  report_id: number;
  name: string;
  version: string | null;
  publisher: string | null;
  install_date: string | null;
  install_location: string | null;
  source: string | null;
  architecture: string | null;
  size_bytes: number | null;
}

function matchHostId(parsed: ParsedGlpiInventory): number | null {
  if (parsed.primary_ip) {
    const h = getHostByIp(parsed.primary_ip);
    if (h) return h.id;
  }
  if (parsed.primary_mac) {
    const h = getHostByMac(parsed.primary_mac);
    if (h) return h.id;
  }
  if (parsed.hostname) {
    const row = db()
      .prepare(
        `SELECT id FROM hosts
         WHERE lower(hostname) = lower(?) OR lower(custom_name) = lower(?)
         ORDER BY id LIMIT 1`,
      )
      .get(parsed.hostname, parsed.hostname) as { id: number } | undefined;
    if (row) return row.id;
  }
  return null;
}

export function ingestInventoryReport(parsed: ParsedGlpiInventory): {
  reportId: number;
  deviceId: string;
  hostId: number | null;
  appsCount: number;
  matchStatus: "matched" | "unmatched";
} {
  const d = db();
  const hostId = matchHostId(parsed);
  const matchStatus = hostId != null ? "matched" : "unmatched";
  const payload_hash = createHash("sha256")
    .update(JSON.stringify({ device_id: parsed.device_id, n: parsed.software.length }))
    .digest("hex")
    .slice(0, 32);

  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO inv_agent_endpoint (
         device_id, host_id, hostname, primary_ip, primary_mac,
         os_family, os_name, os_version, agent_tag, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(device_id) DO UPDATE SET
         host_id = COALESCE(excluded.host_id, inv_agent_endpoint.host_id),
         hostname = excluded.hostname,
         primary_ip = excluded.primary_ip,
         primary_mac = excluded.primary_mac,
         os_family = excluded.os_family,
         os_name = excluded.os_name,
         os_version = excluded.os_version,
         agent_tag = excluded.agent_tag,
         last_seen_at = datetime('now')`,
    ).run(
      parsed.device_id,
      hostId,
      parsed.hostname,
      parsed.primary_ip,
      parsed.primary_mac,
      parsed.os_family,
      parsed.os_name,
      parsed.os_version,
      parsed.agent_tag,
    );

    const rep = d
      .prepare(
        `INSERT INTO inv_agent_report (
           device_id, host_id, match_status, apps_count, payload_hash, agent_version
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.device_id,
        hostId,
        matchStatus,
        parsed.software.length,
        payload_hash,
        parsed.agent_version,
      );
    const reportId = Number(rep.lastInsertRowid);

    d.prepare("UPDATE inv_agent_endpoint SET last_report_id = ?, host_id = COALESCE(?, host_id) WHERE device_id = ?").run(
      reportId,
      hostId,
      parsed.device_id,
    );

    const ins = d.prepare(
      `INSERT INTO inv_agent_software (
         report_id, name, version, publisher, install_date,
         install_location, source, architecture, size_bytes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const sw of parsed.software as ParsedGlpiSoftware[]) {
      ins.run(
        reportId,
        sw.name,
        sw.version,
        sw.publisher,
        sw.install_date,
        sw.install_location,
        sw.source,
        sw.architecture,
        sw.size_bytes,
      );
    }

    return {
      reportId,
      deviceId: parsed.device_id,
      hostId,
      appsCount: parsed.software.length,
      matchStatus,
    } as const;
  });

  return tx();
}

export function getInvAgentByHostId(hostId: number): InvAgentEndpointRow | undefined {
  return db()
    .prepare("SELECT * FROM inv_agent_endpoint WHERE host_id = ? ORDER BY last_seen_at DESC LIMIT 1")
    .get(hostId) as InvAgentEndpointRow | undefined;
}

export function getCurrentInvAgentSoftware(hostId: number): {
  endpoint: InvAgentEndpointRow | null;
  software: InvAgentSoftwareRow[];
} {
  const endpoint = getInvAgentByHostId(hostId);
  if (!endpoint?.last_report_id) {
    return { endpoint: endpoint ?? null, software: [] };
  }
  const software = db()
    .prepare("SELECT * FROM inv_agent_software WHERE report_id = ? ORDER BY name COLLATE NOCASE")
    .all(endpoint.last_report_id) as InvAgentSoftwareRow[];
  return { endpoint, software };
}

export function listInvAgentEndpoints(limit = 100): InvAgentEndpointRow[] {
  return db()
    .prepare(
      `SELECT e.*, r.apps_count, r.match_status
       FROM inv_agent_endpoint e
       LEFT JOIN inv_agent_report r ON r.id = e.last_report_id
       ORDER BY e.last_seen_at DESC
       LIMIT ?`,
    )
    .all(limit) as InvAgentEndpointRow[];
}
