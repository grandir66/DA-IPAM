/**
 * GET /api/patch/cve/[cveId]/hosts
 *
 * Lista host vulnerabili alla CVE indicata, deduplicati per host_id.
 * Per ogni host:
 *   - ip, hostname, os_info, os_family
 *   - winrmAvailable: true se esiste host_credentials protocol_type='winrm' validated=1
 *   - softwareInventoryAvailable: true se almeno uno scan ok
 *   - lastProbeStatus: status dell'ultima operation action='probe' (se esiste)
 *
 * NOTA F4 base: NON lancia probe automatici. Il "chocoStatus" reale richiede
 * un'azione esplicita via POST /api/patch/probe. Qui ritorniamo solo lo stato
 * dell'ultimo probe NOTO (può essere null se mai eseguito).
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

interface HostRow {
  host_id: number;
  ip: string | null;
  hostname: string | null;
  custom_name: string | null;
  os_info: string | null;
  os_family: string | null;
  winrm_validated: number;
  inventory_ok_count: number;
  last_probe_status: string | null;
  last_probe_at: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cveId: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { cveId } = await params;
    if (!cveId) {
      return NextResponse.json(
        { error: "cveId mancante" },
        { status: 400 }
      );
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      const sql = `
        WITH affected AS (
          SELECT DISTINCT wa.host_id AS host_id
            FROM wazuh_vuln wv
            INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
           WHERE wv.cve = ? AND wa.host_id IS NOT NULL
          UNION
          SELECT DISTINCT vf.host_id AS host_id
            FROM vuln_findings vf
           WHERE vf.cve_id = ? AND vf.host_id IS NOT NULL
        ),
        winrm_status AS (
          SELECT host_id, MAX(validated) AS winrm_validated
            FROM host_credentials
           WHERE protocol_type = 'winrm'
           GROUP BY host_id
        ),
        inventory_status AS (
          SELECT host_id, SUM(cnt) AS inventory_ok_count
            FROM (
              SELECT ss.host_id AS host_id, COUNT(*) AS cnt
                FROM software_scans ss
               WHERE ss.status = 'ok' AND ss.host_id IS NOT NULL
               GROUP BY ss.host_id
              UNION ALL
              SELECT h.id AS host_id, COUNT(*) AS cnt
                FROM software_scans ss
                INNER JOIN network_devices nd ON nd.id = ss.device_id
                INNER JOIN hosts h ON h.ip = nd.host
               WHERE ss.status = 'ok' AND ss.device_id IS NOT NULL
               GROUP BY h.id
            )
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
          h.id              AS host_id,
          h.ip              AS ip,
          h.hostname        AS hostname,
          h.custom_name     AS custom_name,
          h.os_info         AS os_info,
          h.os_family       AS os_family,
          COALESCE(ws.winrm_validated, 0) AS winrm_validated,
          COALESCE(inv.inventory_ok_count, 0) AS inventory_ok_count,
          lp.last_probe_status              AS last_probe_status,
          lp.last_probe_at                  AS last_probe_at
        FROM affected a
        INNER JOIN hosts h ON h.id = a.host_id
        LEFT JOIN winrm_status ws ON ws.host_id = h.id
        LEFT JOIN inventory_status inv ON inv.host_id = h.id
        LEFT JOIN last_probe lp ON lp.host_id = h.id
        ORDER BY h.ip ASC
      `;

      const rows = db.prepare(sql).all(cveId, cveId) as HostRow[];

      const items = rows.map((r) => ({
        hostId: r.host_id,
        ip: r.ip,
        hostname: r.hostname,
        customName: r.custom_name,
        osInfo: r.os_info,
        osFamily: r.os_family,
        winrmAvailable: r.winrm_validated === 1,
        softwareInventoryAvailable: r.inventory_ok_count > 0,
        lastProbeStatus: r.last_probe_status,
        lastProbeAt: r.last_probe_at,
      }));

      return NextResponse.json(
        { items },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/cve/:id/hosts GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero degli host vulnerabili" },
        { status: 500 }
      );
    }
  });
}
