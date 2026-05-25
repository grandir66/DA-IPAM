/**
 * GET /api/patch/device
 *
 * Lista host Windows con software inventory popolato, arricchita con counter
 * CVE per severity, conteggio software installati, stato WinRM e ultimo probe.
 *
 * Filtro implicito: solo host Windows con almeno uno `software_scans` ok
 * (host_id diretto o device_id mappato via IP→hosts), perché solo per quegli
 * host il modulo Patch può ragionare su un fix concreto.
 *
 * Query params:
 *   - limit  (default 50, max 200)
 *   - offset (default 0)
 *
 * Risposta:
 *   { items: [{ hostId, ip, hostname, customName, osInfo, osFamily,
 *               softwareCount, cveCritical, cveHigh, cveMedium, cveLow, cveTotal,
 *               winrmValidated, lastProbeStatus, lastProbeAt }], limit, offset }
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

interface DeviceListRow {
  host_id: number;
  ip: string | null;
  hostname: string | null;
  custom_name: string | null;
  os_info: string | null;
  os_family: string | null;
  software_count: number;
  cve_critical: number;
  cve_high: number;
  cve_medium: number;
  cve_low: number;
  cve_total: number;
  winrm_validated: number;
  last_probe_status: string | null;
  last_probe_at: string | null;
}

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") ?? 50);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
      200
    );
    const rawOffset = Number(searchParams.get("offset") ?? 0);
    const offset =
      Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      // host_with_inventory: host (Windows) con almeno uno scan ok,
      // sia diretto (ss.host_id) sia via device IP-mapping.
      // host_cve_counts: aggregato per severity da UNION wazuh_vuln+vuln_findings.
      // software_count: SUM dei count per host (diretto + via IP mapping).
      // winrm_status: validated MAX da host_credentials protocol_type='winrm'.
      // last_probe: status/started_at dell'ultima patch_operations action='probe'.
      const sql = `
        WITH host_with_inventory AS (
          SELECT DISTINCT ss.host_id AS host_id
            FROM software_scans ss
            INNER JOIN hosts h ON h.id = ss.host_id
           WHERE ss.status = 'ok'
             AND ss.host_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
          UNION
          SELECT DISTINCT h.id AS host_id
            FROM software_scans ss
            INNER JOIN network_devices nd ON nd.id = ss.device_id
            INNER JOIN hosts h ON h.ip = nd.host
           WHERE ss.status = 'ok'
             AND ss.device_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
        ),
        host_cve_counts AS (
          SELECT cu.host_id,
            SUM(CASE WHEN LOWER(cu.severity)='critical' THEN 1 ELSE 0 END) AS cve_critical,
            SUM(CASE WHEN LOWER(cu.severity)='high'     THEN 1 ELSE 0 END) AS cve_high,
            SUM(CASE WHEN LOWER(cu.severity)='medium'   THEN 1 ELSE 0 END) AS cve_medium,
            SUM(CASE WHEN LOWER(cu.severity)='low'      THEN 1 ELSE 0 END) AS cve_low,
            COUNT(DISTINCT cu.cve_id) AS cve_total
          FROM (
            SELECT wv.cve AS cve_id, wv.severity AS severity, wa.host_id AS host_id
              FROM wazuh_vuln wv
              INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
              INNER JOIN hosts h ON h.id = wa.host_id
             WHERE wa.host_id IS NOT NULL
               AND LOWER(h.os_family) = 'windows'
            UNION ALL
            SELECT vf.cve_id AS cve_id, vf.severity AS severity, vf.host_id AS host_id
              FROM vuln_findings vf
              INNER JOIN hosts h ON h.id = vf.host_id
             WHERE vf.cve_id IS NOT NULL
               AND vf.host_id IS NOT NULL
               AND LOWER(h.os_family) = 'windows'
          ) cu
          GROUP BY cu.host_id
        ),
        software_count AS (
          SELECT host_id, SUM(cnt) AS software_count
            FROM (
              SELECT ss.host_id AS host_id, COUNT(si.id) AS cnt
                FROM software_scans ss
                INNER JOIN software_inventory si ON si.scan_id = ss.id
               WHERE ss.status = 'ok' AND ss.host_id IS NOT NULL
               GROUP BY ss.host_id
              UNION ALL
              SELECT h.id AS host_id, COUNT(si.id) AS cnt
                FROM software_scans ss
                INNER JOIN software_inventory si ON si.scan_id = ss.id
                INNER JOIN network_devices nd ON nd.id = ss.device_id
                INNER JOIN hosts h ON h.ip = nd.host
               WHERE ss.status = 'ok' AND ss.device_id IS NOT NULL
               GROUP BY h.id
            )
           GROUP BY host_id
        ),
        winrm_status AS (
          SELECT host_id, MAX(validated) AS winrm_validated
            FROM host_credentials
           WHERE protocol_type = 'winrm'
           GROUP BY host_id
        ),
        last_probe AS (
          SELECT po.host_id, po.status AS last_probe_status, po.started_at AS last_probe_at
            FROM patch_operations po
           INNER JOIN (
             SELECT host_id, MAX(id) AS max_id
               FROM patch_operations
              WHERE action = 'probe'
              GROUP BY host_id
           ) latest ON latest.host_id = po.host_id AND latest.max_id = po.id
        )
        SELECT
          h.id                                  AS host_id,
          h.ip                                  AS ip,
          h.hostname                            AS hostname,
          h.custom_name                         AS custom_name,
          h.os_info                             AS os_info,
          h.os_family                           AS os_family,
          COALESCE(sc.software_count, 0)        AS software_count,
          COALESCE(hcc.cve_critical, 0)         AS cve_critical,
          COALESCE(hcc.cve_high, 0)             AS cve_high,
          COALESCE(hcc.cve_medium, 0)           AS cve_medium,
          COALESCE(hcc.cve_low, 0)              AS cve_low,
          COALESCE(hcc.cve_total, 0)            AS cve_total,
          COALESCE(ws.winrm_validated, 0)       AS winrm_validated,
          lp.last_probe_status                  AS last_probe_status,
          lp.last_probe_at                      AS last_probe_at
        FROM host_with_inventory hwi
        INNER JOIN hosts h ON h.id = hwi.host_id
        LEFT JOIN host_cve_counts hcc ON hcc.host_id = h.id
        LEFT JOIN software_count sc ON sc.host_id = h.id
        LEFT JOIN winrm_status ws ON ws.host_id = h.id
        LEFT JOIN last_probe lp ON lp.host_id = h.id
        WHERE LOWER(h.os_family) = 'windows'
        ORDER BY cve_critical DESC, cve_high DESC, h.hostname ASC
        LIMIT ? OFFSET ?
      `;

      const rows = db.prepare(sql).all(limit, offset) as DeviceListRow[];

      const items = rows.map((r) => ({
        hostId: r.host_id,
        ip: r.ip,
        hostname: r.hostname,
        customName: r.custom_name,
        osInfo: r.os_info,
        osFamily: r.os_family,
        softwareCount: r.software_count,
        cveCritical: r.cve_critical,
        cveHigh: r.cve_high,
        cveMedium: r.cve_medium,
        cveLow: r.cve_low,
        cveTotal: r.cve_total,
        winrmValidated: r.winrm_validated === 1,
        lastProbeStatus: r.last_probe_status,
        lastProbeAt: r.last_probe_at,
      }));

      return NextResponse.json(
        { items, limit, offset },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/device GET] errore query:", error);
      return NextResponse.json(
        { error: "Errore nel recupero della lista device" },
        { status: 500 }
      );
    }
  });
}
