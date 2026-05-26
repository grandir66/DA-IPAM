/**
 * GET /api/patch/cve
 *
 * Ritorna lista CVE deduplicate da `wazuh_vuln` + `vuln_findings`, contando
 * gli host distinti vulnerabili e segnalando se il modulo conosce già un
 * mapping (cve_id, software_id) in `patch_cve_target`.
 *
 * Filtri:
 *   - severity=critical|high|medium|low  (case-insensitive)
 *   - limit (default 50, max 200)
 *   - offset (default 0)
 *   - hasMatch=true  → solo CVE già mappate a un fix
 *
 * Risposta: { items: [{ cve_id, cvss_score, severity, title, host_count, fix_available }], limit, offset }
 *
 * NOTA: il "host_count" considera SOLO host con software_inventory popolato
 * (almeno uno scan ok), perché solo per quegli host il modulo ha un'idea
 * concreta del software installato e quindi del fix applicabile.
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

interface CveListRow {
  cve_id: string;
  cvss_score: number | null;
  severity: string | null;
  title: string | null;
  host_count: number;
  fix_available: number;
}

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { searchParams } = new URL(request.url);
    const severity = searchParams.get("severity");
    const rawLimit = Number(searchParams.get("limit") ?? 50);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
      200
    );
    const rawOffset = Number(searchParams.get("offset") ?? 0);
    const offset =
      Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const hasMatch = searchParams.get("hasMatch") === "true";

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      // UNION wazuh_vuln+vuln_findings → dedupe per cve_id, conta host distinti.
      // LEFT JOIN patch_cve_target → flag fix_available (almeno una riga).
      // host_with_inventory: host con scan diretto OR host con stesso IP di un network_device scansionato.
      const severityFilter = severity ? "WHERE LOWER(cu.severity) = LOWER(?)" : "";
      const matchFilter = hasMatch ? "HAVING fix_available = 1" : "";

      const sql = `
        WITH host_with_inventory AS (
          -- (a) Scan locale diretto su host_id
          SELECT DISTINCT ss.host_id AS host_id
            FROM software_scans ss
            INNER JOIN hosts h ON h.id = ss.host_id
           WHERE ss.status = 'ok'
             AND ss.host_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
          UNION
          -- (b) Scan locale su network_device mappato a host via IP
          SELECT DISTINCT h.id AS host_id
            FROM software_scans ss
            INNER JOIN network_devices nd ON nd.id = ss.device_id
            INNER JOIN hosts h ON h.ip = nd.host
           WHERE ss.status = 'ok'
             AND ss.device_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
          UNION
          -- (c) Inventory raccolto da Wazuh agent
          SELECT DISTINCT h.id AS host_id
            FROM wazuh_software ws
            INNER JOIN wazuh_agent wa ON wa.agent_id = ws.agent_id
            INNER JOIN hosts h ON h.id = wa.host_id
           WHERE wa.host_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
        ),
        cve_union AS (
          SELECT
            wv.cve                                          AS cve_id,
            COALESCE(wv.cvss3_score, wv.cvss2_score)        AS cvss_score,
            wv.severity                                     AS severity,
            wv.title                                        AS title,
            wa.host_id                                      AS host_id
          FROM wazuh_vuln wv
          INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
          INNER JOIN hosts h ON h.id = wa.host_id
          WHERE wa.host_id IS NOT NULL
            AND LOWER(h.os_family) = 'windows'

          UNION ALL

          SELECT
            vf.cve_id     AS cve_id,
            vf.cvss_score AS cvss_score,
            vf.severity   AS severity,
            vf.nvt_name   AS title,
            vf.host_id    AS host_id
          FROM vuln_findings vf
          INNER JOIN hosts h ON h.id = vf.host_id
          WHERE vf.cve_id IS NOT NULL
            AND vf.host_id IS NOT NULL
            AND LOWER(h.os_family) = 'windows'
        )
        SELECT
          cu.cve_id                                AS cve_id,
          MAX(cu.cvss_score)                       AS cvss_score,
          MAX(cu.severity)                         AS severity,
          MAX(cu.title)                            AS title,
          COUNT(DISTINCT cu.host_id)               AS host_count,
          CASE WHEN COUNT(pct.software_id) > 0 THEN 1 ELSE 0 END AS fix_available
        FROM cve_union cu
        INNER JOIN host_with_inventory hwi ON hwi.host_id = cu.host_id
        LEFT JOIN patch_cve_target pct ON pct.cve_id = cu.cve_id
        ${severityFilter}
        GROUP BY cu.cve_id
        ${matchFilter}
        ORDER BY cvss_score DESC NULLS LAST, cu.cve_id ASC
        LIMIT ? OFFSET ?
      `;

      const params: unknown[] = [];
      if (severity) params.push(severity);
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params) as CveListRow[];

      const items = rows.map((r) => ({
        cveId: r.cve_id,
        cvssScore: r.cvss_score,
        severity: r.severity,
        title: r.title,
        hostCount: r.host_count,
        fixAvailable: r.fix_available === 1,
      }));

      return NextResponse.json(
        { items, limit, offset },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/cve GET] errore query:", error);
      return NextResponse.json(
        { error: "Errore nel recupero della lista CVE" },
        { status: 500 }
      );
    }
  });
}
