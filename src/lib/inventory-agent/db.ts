/**
 * CRUD tenant DB — inventory agent ingest.
 */
import { createHash } from "node:crypto";
import { getTenantDb, getCurrentTenantCode, getHostByIp, getHostByMac, getHostById } from "@/lib/db-tenant";
import type { ParsedGlpiInventory, ParsedGlpiSoftware } from "@/lib/inventory-agent/parse-glpi-inventory";
import { enrichHostFromInventoryAgent } from "@/lib/inventory-agent/enrich-host";
import { migrateInventoryAgentSchema } from "@/lib/inventory-agent/schema";

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
  inventory_json?: string | null;
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

export interface InvAgentLicenseRow {
  id: number;
  report_id: number;
  name: string;
  full_name: string | null;
  product_id: string | null;
  license_key: string | null;
  components: string | null;
  trial: number | null;
  activation_date: string | null;
}

export interface InvAgentRuntimeRow {
  id: number;
  report_id: number;
  category: "database" | "remote_mgmt" | "firewall" | "process";
  name: string;
  version: string | null;
  status: string | null;
  port: number | null;
  user_name: string | null;
  command_line: string | null;
  is_active: number | null;
}

function matchHostId(parsed: ParsedGlpiInventory): number | null {
  // MAC PRIMA dell'IP (fix 2026-06-23): il MAC è l'anchor STABILE del device
  // fisico, l'IP cambia col network. Con l'IP-first un device GLPI che cambiava
  // rete non veniva più riconosciuto come lo stesso host → appariva "riregistrato"
  // a ogni cambio di network. getHostByMac usa ORDER BY id (host originale) e
  // disambigua per IP se il MAC è su più host.
  if (parsed.primary_mac) {
    const h = getHostByMac(parsed.primary_mac, parsed.primary_ip ?? undefined);
    if (h) return h.id;
  }
  if (parsed.primary_ip) {
    const h = getHostByIp(parsed.primary_ip);
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
  migrateInventoryAgentSchema(d);
  const hostId = matchHostId(parsed);
  const matchStatus = hostId != null ? "matched" : "unmatched";
  const inventoryJson = JSON.stringify(parsed.profile);
  const payload_hash = createHash("sha256")
    .update(JSON.stringify({ device_id: parsed.device_id, n: parsed.software.length }))
    .digest("hex")
    .slice(0, 32);

  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO inv_agent_endpoint (
         device_id, host_id, hostname, primary_ip, primary_mac,
         os_family, os_name, os_version, agent_tag, inventory_json, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(device_id) DO UPDATE SET
         host_id = COALESCE(excluded.host_id, inv_agent_endpoint.host_id),
         hostname = excluded.hostname,
         primary_ip = excluded.primary_ip,
         primary_mac = excluded.primary_mac,
         os_family = excluded.os_family,
         os_name = excluded.os_name,
         os_version = excluded.os_version,
         agent_tag = excluded.agent_tag,
         inventory_json = excluded.inventory_json,
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
      inventoryJson,
    );

    const rep = d
      .prepare(
        `INSERT INTO inv_agent_report (
           device_id, host_id, match_status, apps_count, payload_hash, agent_version, inventory_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.device_id,
        hostId,
        matchStatus,
        parsed.software.length,
        payload_hash,
        parsed.agent_version,
        inventoryJson,
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

    const insLic = d.prepare(
      `INSERT INTO inv_agent_license (
         report_id, name, full_name, product_id, license_key, components, trial, activation_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const lic of parsed.profile.licenses) {
      insLic.run(
        reportId,
        lic.name,
        lic.full_name,
        lic.product_id,
        lic.license_key,
        lic.components,
        lic.trial === true ? 1 : lic.trial === false ? 0 : null,
        lic.activation_date,
      );
    }

    const insRt = d.prepare(
      `INSERT INTO inv_agent_runtime (
         report_id, category, name, version, status, port, user_name, command_line, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const rt of parsed.profile.runtime) {
      insRt.run(
        reportId,
        rt.category,
        rt.name,
        rt.version,
        rt.status,
        rt.port,
        rt.user_name,
        rt.command_line,
        rt.is_active === true ? 1 : rt.is_active === false ? 0 : null,
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

  const result = tx();
  if (result.hostId != null) {
    enrichHostFromInventoryAgent(result.hostId, parsed);
  }
  return result;
}

export function getInvAgentByHostId(hostId: number): InvAgentEndpointRow | undefined {
  const d = db();
  migrateInventoryAgentSchema(d);

  const direct = d
    .prepare("SELECT * FROM inv_agent_endpoint WHERE host_id = ? ORDER BY last_seen_at DESC LIMIT 1")
    .get(hostId) as InvAgentEndpointRow | undefined;
  if (direct) return direct;

  const host = getHostById(hostId);
  if (!host?.ip) return undefined;

  const byIp = d
    .prepare(
      `SELECT * FROM inv_agent_endpoint
       WHERE primary_ip = ?
       ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .get(host.ip) as InvAgentEndpointRow | undefined;

  if (byIp && !byIp.host_id) {
    d.prepare("UPDATE inv_agent_endpoint SET host_id = ? WHERE device_id = ?").run(hostId, byIp.device_id);
    d.prepare(
      "UPDATE inv_agent_report SET host_id = ? WHERE device_id = ? AND (host_id IS NULL OR host_id = ?)",
    ).run(hostId, byIp.device_id, hostId);
    return { ...byIp, host_id: hostId };
  }

  return byIp;
}

/** Ricollega endpoint GLPI Agent a host (es. dopo promozione a device). */
export function linkInvAgentEndpointToHost(hostId: number): boolean {
  const row = getInvAgentByHostId(hostId);
  return row != null;
}

export function getCurrentInvAgentInventory(hostId: number): {
  endpoint: InvAgentEndpointRow | null;
  software: InvAgentSoftwareRow[];
  licenses: InvAgentLicenseRow[];
  runtime: InvAgentRuntimeRow[];
  profile: ParsedGlpiInventory["profile"] | null;
  process_count: number;
} {
  const endpoint = getInvAgentByHostId(hostId);
  if (!endpoint?.last_report_id) {
    return {
      endpoint: endpoint ?? null,
      software: [],
      licenses: [],
      runtime: [],
      profile: parseProfileJson(endpoint?.inventory_json),
      process_count: parseProfileJson(endpoint?.inventory_json)?.process_count ?? 0,
    };
  }
  const reportId = endpoint.last_report_id;
  const software = db()
    .prepare("SELECT * FROM inv_agent_software WHERE report_id = ? ORDER BY name COLLATE NOCASE")
    .all(reportId) as InvAgentSoftwareRow[];
  const licenses = db()
    .prepare("SELECT * FROM inv_agent_license WHERE report_id = ? ORDER BY name COLLATE NOCASE")
    .all(reportId) as InvAgentLicenseRow[];
  const runtime = db()
    .prepare(
      `SELECT * FROM inv_agent_runtime WHERE report_id = ?
       ORDER BY CASE category
         WHEN 'remote_mgmt' THEN 1 WHEN 'database' THEN 2 WHEN 'firewall' THEN 3 ELSE 4 END,
         name COLLATE NOCASE`,
    )
    .all(reportId) as InvAgentRuntimeRow[];
  const profile = parseProfileJson(endpoint.inventory_json);
  return {
    endpoint,
    software,
    licenses,
    runtime,
    profile,
    process_count: profile?.process_count ?? runtime.filter((r) => r.category === "process").length,
  };
}

/** @deprecated Usare getCurrentInvAgentInventory */
export function getCurrentInvAgentSoftware(hostId: number) {
  const data = getCurrentInvAgentInventory(hostId);
  return {
    endpoint: data.endpoint,
    software: data.software,
    profile: data.profile,
  };
}

function parseProfileJson(raw: string | null | undefined): ParsedGlpiInventory["profile"] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedGlpiInventory["profile"];
  } catch {
    return null;
  }
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
