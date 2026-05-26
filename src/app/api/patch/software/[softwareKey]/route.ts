/**
 * GET /api/patch/software/[softwareKey]
 *
 * Dettaglio software-first: dato (name, version) ritorna tutti gli host
 * Windows che hanno quel software installato + tutte le CVE associate.
 *
 * Encoding `softwareKey`:
 *   `${encodeURIComponent(name)}|${encodeURIComponent(version)}`
 *   - Se `version` è vuoto/NULL si usa la stringa speciale `__NULL__`.
 *   - Decode: split su primo `|`, decodeURIComponent.
 *
 * CVE aggregation (no N+1):
 *   1. wazuh_vuln per package_name LIKE name+'%' AND (package_version=version OR NULL)
 *      su agent di host che hanno il software → source='wazuh'
 *   2. patch_cve_target su software_id deduplicati → source='patch_cve_target'
 *
 * Host dedup via IP-unification (scan diretto + via device IP).
 *
 * Risposta:
 *   { name, version, publisher, chocoId, patchable,
 *     cves: [{ cveId, cvssScore, severity, source }],
 *     hosts: [{ hostId, hostname, ip, customName, osInfo, osFamily,
 *               winrmValidated, lastProbeStatus, lastProbeAt }] }
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const NULL_VERSION_TOKEN = "__NULL__";

interface SoftwareIdRow {
  software_id: number;
  publisher: string | null;
  choco_id: string | null;
}

interface HostDetailRow {
  host_id: number;
  ip: string | null;
  hostname: string | null;
  custom_name: string | null;
  os_info: string | null;
  os_family: string | null;
  winrm_validated: number;
  last_probe_status: string | null;
  last_probe_at: string | null;
}

interface CveAggRow {
  cve_id: string;
  cvss_score: number | null;
  severity: string | null;
  source: string;
}

function decodeSoftwareKey(
  raw: string
): { name: string; version: string | null } | null {
  if (!raw) return null;
  // Decodifica preliminare dell'intero parametro (Next già fa una pass, ma
  // se l'UI passa encodings doppi siamo difensivi).
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const sepIdx = decoded.indexOf("|");
  if (sepIdx < 0) return null;
  const namePart = decoded.slice(0, sepIdx);
  const versionPart = decoded.slice(sepIdx + 1);
  if (!namePart) return null;
  // Inner decode (caso `${encodeURIComponent(name)}|${encodeURIComponent(version)}`)
  let name: string;
  let version: string | null;
  try {
    name = decodeURIComponent(namePart);
    version =
      versionPart === NULL_VERSION_TOKEN
        ? null
        : decodeURIComponent(versionPart);
  } catch {
    return null;
  }
  if (!name) return null;
  return { name, version };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ softwareKey: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { softwareKey } = await params;
    const decoded = decodeSoftwareKey(softwareKey);
    if (!decoded) {
      return NextResponse.json(
        { error: "softwareKey non valido (atteso 'name|version' URL-encoded)" },
        { status: 400 }
      );
    }
    const { name, version } = decoded;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      // Match esatto su (LOWER(name), version) — version può essere NULL.
      const versionEq = version === null
        ? "si.version IS NULL"
        : "si.version = ?";
      const versionEqWs = version === null
        ? "ws.version IS NULL"
        : "ws.version = ?";

      // 1) Software ids da software_inventory corrispondenti + metadata.
      //    Se nessun software_inventory match, l'inventario potrebbe essere solo wazuh:
      //    in quel caso softwareIds=[] ma il software esiste comunque.
      const swIdSql = `
        SELECT DISTINCT si.id AS software_id, si.publisher AS publisher,
               psm.choco_id AS choco_id
          FROM software_inventory si
          INNER JOIN software_scans ss ON ss.id = si.scan_id
          LEFT JOIN patch_software_meta psm ON psm.software_id = si.id
         WHERE ss.status = 'ok'
           AND LOWER(si.name) = LOWER(?)
           AND ${versionEq}
      `;
      const swIdParams: unknown[] = [name];
      if (version !== null) swIdParams.push(version);

      const swRows = db.prepare(swIdSql).all(...swIdParams) as SoftwareIdRow[];

      // 1b) Verifica esistenza anche in wazuh_software (per software wazuh-only)
      const wsExistsSql = `
        SELECT ws.vendor AS vendor
          FROM wazuh_software ws
          INNER JOIN wazuh_agent wa ON wa.agent_id = ws.agent_id
          INNER JOIN hosts h ON h.id = wa.host_id
         WHERE LOWER(ws.name) = LOWER(?)
           AND ${versionEqWs}
           AND LOWER(h.os_family) = 'windows'
         LIMIT 1
      `;
      const wsExistsParams: unknown[] = [name];
      if (version !== null) wsExistsParams.push(version);
      const wsExists = db.prepare(wsExistsSql).get(...wsExistsParams) as
        | { vendor: string | null }
        | undefined;

      if (swRows.length === 0 && !wsExists) {
        return NextResponse.json(
          { error: "Software non trovato" },
          { status: 404 }
        );
      }

      const softwareIds = swRows.map((r) => r.software_id);
      const publisher =
        swRows.find((r) => r.publisher)?.publisher ?? wsExists?.vendor ?? null;
      const chocoId = swRows.find((r) => r.choco_id)?.choco_id ?? null;

      // Placeholder per IN(): se vuoto, usa '-1' per evitare SQL error
      const swIdsPlaceholders =
        softwareIds.length > 0 ? softwareIds.map(() => "?").join(",") : "-1";

      // 2) Host che hanno il software (3 fonti: scan diretto, scan via device IP, wazuh_software)
      const hostSql = `
        WITH affected AS (
          SELECT DISTINCT ss.host_id AS host_id
            FROM software_inventory si
            INNER JOIN software_scans ss ON ss.id = si.scan_id
            INNER JOIN hosts h ON h.id = ss.host_id
           WHERE ss.status = 'ok'
             AND ss.host_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
             AND si.id IN (${swIdsPlaceholders})
          UNION
          SELECT DISTINCT h.id AS host_id
            FROM software_inventory si
            INNER JOIN software_scans ss ON ss.id = si.scan_id
            INNER JOIN network_devices nd ON nd.id = ss.device_id
            INNER JOIN hosts h ON h.ip = nd.host
           WHERE ss.status = 'ok'
             AND ss.device_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
             AND si.id IN (${swIdsPlaceholders})
          UNION
          SELECT DISTINCT wa.host_id AS host_id
            FROM wazuh_software ws
            INNER JOIN wazuh_agent wa ON wa.agent_id = ws.agent_id
            INNER JOIN hosts h ON h.id = wa.host_id
           WHERE wa.host_id IS NOT NULL
             AND LOWER(h.os_family) = 'windows'
             AND LOWER(ws.name) = LOWER(?)
             AND ${versionEqWs}
        ),
        winrm_status AS (
          SELECT host_id, MAX(validated) AS winrm_validated
            FROM host_credentials
           WHERE protocol_type = 'winrm'
           GROUP BY host_id
        ),
        ad_winrm_available AS (
          SELECT CASE WHEN EXISTS(
            SELECT 1 FROM ad_integrations
             WHERE enabled = 1 AND winrm_credential_id IS NOT NULL
          ) THEN 1 ELSE 0 END AS has_ad
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
          h.id          AS host_id,
          h.ip          AS ip,
          h.hostname    AS hostname,
          h.custom_name AS custom_name,
          h.os_info     AS os_info,
          h.os_family   AS os_family,
          CASE
            WHEN COALESCE(ws.winrm_validated, 0) = 1 THEN 1
            WHEN awa.has_ad = 1 THEN 1
            ELSE 0
          END AS winrm_validated,
          lp.last_probe_status            AS last_probe_status,
          lp.last_probe_at                AS last_probe_at
        FROM affected a
        INNER JOIN hosts h ON h.id = a.host_id
        CROSS JOIN ad_winrm_available awa
        LEFT JOIN winrm_status ws ON ws.host_id = h.id
        LEFT JOIN last_probe lp ON lp.host_id = h.id
        ORDER BY h.ip ASC
      `;

      // hostSql params: softwareIds appare 2 volte (scan diretto + via device).
      // Se softwareIds è vuoto, la query usa IN(-1) — passiamo solo i param wazuh.
      const hostSqlParams: unknown[] = [];
      if (softwareIds.length > 0) {
        hostSqlParams.push(...softwareIds, ...softwareIds);
      }
      // Param wazuh branch: name + (version se non null)
      hostSqlParams.push(name);
      if (version !== null) hostSqlParams.push(version);

      const hostRows = db
        .prepare(hostSql)
        .all(...hostSqlParams) as HostDetailRow[];

      const hostIds = hostRows.map((r) => r.host_id);

      // 3) CVE aggregate (wazuh + patch_cve_target). Se nessun host, salta wazuh.
      const cveMap = new Map<string, CveAggRow>();

      if (hostIds.length > 0) {
        const hostIdsPlaceholders = hostIds.map(() => "?").join(",");
        const versionMatchWazuh = version === null
          ? ""
          : "AND (wv.package_version IS NULL OR wv.package_version = ?)";

        const wazuhSql = `
          SELECT DISTINCT
            wv.cve AS cve_id,
            COALESCE(wv.cvss3_score, wv.cvss2_score) AS cvss_score,
            wv.severity AS severity,
            'wazuh' AS source
          FROM wazuh_vuln wv
          INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
          WHERE wa.host_id IN (${hostIdsPlaceholders})
            AND LOWER(wv.package_name) LIKE LOWER(?) || '%'
            ${versionMatchWazuh}
        `;
        const wazuhParams: unknown[] = [...hostIds, name];
        if (version !== null) wazuhParams.push(version);

        const wazuhRows = db
          .prepare(wazuhSql)
          .all(...wazuhParams) as CveAggRow[];
        for (const r of wazuhRows) {
          if (!cveMap.has(r.cve_id)) cveMap.set(r.cve_id, r);
        }
      }

      // patch_cve_target: anche se nessun host, ha senso elencare la CVE associata
      const targetSql = `
        SELECT DISTINCT
          pct.cve_id AS cve_id,
          NULL       AS cvss_score,
          NULL       AS severity,
          'patch_cve_target' AS source
        FROM patch_cve_target pct
        WHERE pct.software_id IN (${swIdsPlaceholders})
      `;
      const targetRows = db
        .prepare(targetSql)
        .all(...softwareIds) as CveAggRow[];
      for (const r of targetRows) {
        // Se la CVE è già censita via wazuh (con cvss+severity reali) la teniamo
        // perché più informativa. Altrimenti la aggiungiamo.
        if (!cveMap.has(r.cve_id)) cveMap.set(r.cve_id, r);
      }

      const cves = Array.from(cveMap.values())
        .map((r) => ({
          cveId: r.cve_id,
          cvssScore: r.cvss_score,
          severity: r.severity,
          source: r.source,
        }))
        .sort((a, b) => {
          // Sort by cvss desc (null last), then cveId asc
          const sa = a.cvssScore ?? -1;
          const sb = b.cvssScore ?? -1;
          if (sb !== sa) return sb - sa;
          return a.cveId.localeCompare(b.cveId);
        });

      const hosts = hostRows.map((r) => ({
        hostId: r.host_id,
        hostname: r.hostname,
        ip: r.ip,
        customName: r.custom_name,
        osInfo: r.os_info,
        osFamily: r.os_family,
        winrmValidated: r.winrm_validated === 1,
        lastProbeStatus: r.last_probe_status,
        lastProbeAt: r.last_probe_at,
      }));

      const patchable = chocoId !== null && cves.length > 0;

      return NextResponse.json(
        {
          name,
          version,
          publisher,
          chocoId,
          patchable,
          cves,
          hosts,
        },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/software/:key GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero del dettaglio software" },
        { status: 500 }
      );
    }
  });
}
