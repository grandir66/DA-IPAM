/**
 * GET /api/patch/software
 *
 * Lista software deduplicata per `(LOWER(name), version)`, con:
 *   - host_count: numero host distinti Windows che hanno il software installato
 *     (calcolato sia via scan diretto host_id, sia via device IP-mapping)
 *   - cve_count: CVE distinte associate (wazuh_vuln package match + patch_cve_target)
 *   - choco_id: package id Chocolatey (max in patch_software_meta per le righe deduplicate)
 *   - patchable: true se cve_count > 0 AND choco_id != NULL
 *
 * Filtri query:
 *   - limit (default 50, max 200)
 *   - offset (default 0)
 *   - search (sostringa LIKE su name, case-insensitive)
 *   - onlyWithCve=true   → solo righe con cve_count > 0
 *   - onlyPatchable=true → solo righe con patchable=true
 *
 * Risposta:
 *   { items: [{ name, version, publisher, hostCount, cveCount, chocoId, patchable }],
 *     limit, offset }
 *
 * Nota F11: host_count INCLUDE già IP-unification (scan diretto + via device IP).
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

interface SoftwareListRow {
  name: string;
  version: string | null;
  publisher: string | null;
  host_count: number;
  cve_count: number;
  choco_id: string | null;
  patchable: number;
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
    const search = (searchParams.get("search") ?? "").trim();
    const onlyWithCve = searchParams.get("onlyWithCve") === "true";
    const onlyPatchable = searchParams.get("onlyPatchable") === "true";

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      // Pipeline:
      //  - sw_host_pairs: 1 riga per (name_normalized, version, host_id) — dedup host
      //    via UNION scan diretto + via device IP-mapping (entrambi su host Windows con scan ok)
      //  - sw_dedup: dedup per (name_normalized, version), conta host_count distinti +
      //    GROUP_CONCAT software_ids per JOIN successivi
      //  - sw_choco: max choco_id da patch_software_meta tra i software_id deduplicati
      //  - sw_cve_wazuh: count CVE da wazuh_vuln per match package_name su (name,version)
      //  - sw_cve_target: count CVE da patch_cve_target sui software_id deduplicati
      const searchFilter = search ? "AND LOWER(si.name) LIKE LOWER(?)" : "";
      const searchParam = search ? `%${search}%` : null;

      const havingClauses: string[] = [];
      if (onlyWithCve) havingClauses.push("cve_count > 0");
      if (onlyPatchable)
        havingClauses.push("(choco_id IS NOT NULL AND cve_count > 0)");
      const havingSql = havingClauses.length
        ? `HAVING ${havingClauses.join(" AND ")}`
        : "";

      const sql = `
        WITH sw_host_pairs AS (
          SELECT LOWER(si.name) AS name_normalized, si.name AS name, si.version AS version,
                 si.publisher AS publisher, ss.host_id AS host_id, si.id AS software_id
            FROM software_inventory si
            INNER JOIN software_scans ss ON ss.id = si.scan_id
            INNER JOIN hosts h ON h.id = ss.host_id
           WHERE ss.status = 'ok'
             AND ss.host_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
             ${searchFilter}
          UNION ALL
          SELECT LOWER(si.name) AS name_normalized, si.name AS name, si.version AS version,
                 si.publisher AS publisher, h.id AS host_id, si.id AS software_id
            FROM software_inventory si
            INNER JOIN software_scans ss ON ss.id = si.scan_id
            INNER JOIN network_devices nd ON nd.id = ss.device_id
            INNER JOIN hosts h ON h.ip = nd.host
           WHERE ss.status = 'ok'
             AND ss.device_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
             ${searchFilter}
        ),
        sw_dedup AS (
          SELECT name_normalized,
                 MAX(name) AS name,
                 version,
                 MAX(publisher) AS publisher,
                 COUNT(DISTINCT host_id) AS host_count,
                 GROUP_CONCAT(DISTINCT software_id) AS software_ids
            FROM sw_host_pairs
           GROUP BY name_normalized, version
        ),
        sw_choco AS (
          SELECT shp.name_normalized, shp.version,
                 MAX(psm.choco_id) AS choco_id
            FROM sw_host_pairs shp
            LEFT JOIN patch_software_meta psm ON psm.software_id = shp.software_id
           WHERE psm.choco_id IS NOT NULL
           GROUP BY shp.name_normalized, shp.version
        ),
        sw_cve_wazuh AS (
          SELECT LOWER(si.name) AS name_normalized, si.version AS version,
                 COUNT(DISTINCT wv.cve) AS n
            FROM software_inventory si
            INNER JOIN software_scans ss ON ss.id = si.scan_id
            INNER JOIN wazuh_vuln wv
              ON LOWER(wv.package_name) LIKE LOWER(si.name) || '%'
             AND (wv.package_version IS NULL OR wv.package_version = si.version)
           WHERE ss.status = 'ok'
           GROUP BY LOWER(si.name), si.version
        ),
        sw_cve_target AS (
          SELECT shp.name_normalized, shp.version,
                 COUNT(DISTINCT pct.cve_id) AS n
            FROM sw_host_pairs shp
            INNER JOIN patch_cve_target pct ON pct.software_id = shp.software_id
           GROUP BY shp.name_normalized, shp.version
        )
        SELECT
          sd.name                                              AS name,
          sd.version                                           AS version,
          sd.publisher                                         AS publisher,
          sd.host_count                                        AS host_count,
          COALESCE(scw.n, 0) + COALESCE(sct.n, 0)              AS cve_count,
          sc.choco_id                                          AS choco_id,
          CASE
            WHEN sc.choco_id IS NOT NULL
             AND (COALESCE(scw.n, 0) + COALESCE(sct.n, 0)) > 0
            THEN 1 ELSE 0
          END                                                  AS patchable
        FROM sw_dedup sd
        LEFT JOIN sw_choco sc      ON sc.name_normalized = sd.name_normalized AND sc.version IS sd.version
        LEFT JOIN sw_cve_wazuh scw ON scw.name_normalized = sd.name_normalized AND scw.version IS sd.version
        LEFT JOIN sw_cve_target sct ON sct.name_normalized = sd.name_normalized AND sct.version IS sd.version
        ${havingSql}
        ORDER BY cve_count DESC, sd.name ASC, sd.version ASC
        LIMIT ? OFFSET ?
      `;

      const params: unknown[] = [];
      // searchFilter occorre 2 volte (le 2 branch UNION ALL di sw_host_pairs)
      if (searchParam) {
        params.push(searchParam);
        params.push(searchParam);
      }
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params) as SoftwareListRow[];

      const items = rows.map((r) => ({
        name: r.name,
        version: r.version,
        publisher: r.publisher,
        hostCount: r.host_count,
        cveCount: r.cve_count,
        chocoId: r.choco_id,
        patchable: r.patchable === 1,
      }));

      return NextResponse.json(
        { items, limit, offset },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/software GET] errore query:", error);
      return NextResponse.json(
        { error: "Errore nel recupero della lista software" },
        { status: 500 }
      );
    }
  });
}
