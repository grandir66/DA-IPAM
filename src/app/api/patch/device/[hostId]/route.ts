/**
 * GET /api/patch/device/[hostId]
 *
 * Dettaglio device-first per il modulo Patch:
 *   - Header host: id, hostname, ip, custom_name, os_info, os_family,
 *     winrmValidated, lastProbeStatus, lastProbeAt
 *   - software[]: lista software_inventory dell'ultimo scan ok (diretto via
 *     host_id, fallback via device IP-mapping). Per ogni software:
 *       softwareId, name, version, publisher, source, chocoId, cpe,
 *       cves: [{ cveId, cvssScore, severity, source: 'wazuh'|'patch_cve_target' }],
 *       patchable: true se ha almeno una CVE E ha choco_id
 *
 * Strategia CVE→software (single query con LEFT JOIN, no N+1):
 *   1. wazuh_vuln per (host_id) tramite wazuh_agent, match per package_name
 *      (LIKE prefix case-insensitive su software.name) → source='wazuh'
 *   2. patch_cve_target su software_id diretto → source='patch_cve_target'
 *
 * Limite difensivo: la query di unione viene capata a 2000 righe lato SQL
 * (DISTINCT software+CVE pair). Oltre, l'UI dovrà passare a paginazione,
 * per ora i payload sono attesi sotto soglia (max ~500 software × ~10 CVE).
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const MAX_SOFTWARE_CVE_ROWS = 2000;

interface HostHeaderRow {
  id: number;
  ip: string | null;
  hostname: string | null;
  custom_name: string | null;
  os_info: string | null;
  os_family: string | null;
  winrm_validated: number;
  last_probe_status: string | null;
  last_probe_at: string | null;
}

interface SoftwareCveRow {
  software_id: number;
  name: string;
  version: string | null;
  publisher: string | null;
  source: string;
  choco_id: string | null;
  cpe: string | null;
  cve_id: string | null;
  cve_severity: string | null;
  cve_cvss: number | null;
  cve_source: string | null;
}

interface SoftwareItem {
  // softwareId è null per pacchetti che esistono SOLO in wazuh_software (senza FK su
  // software_inventory). In quel caso choco_id/cpe restano null e il bottone "Patch"
  // resta disabilitato (l'utente può usare "Pin manuale" per associare).
  softwareId: number | null;
  name: string;
  version: string | null;
  publisher: string | null;
  source: string | null;
  chocoId: string | null;
  cpe: string | null;
  cves: Array<{
    cveId: string;
    cvssScore: number | null;
    severity: string | null;
    source: string;
  }>;
  patchable: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hostId: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { hostId: rawHostId } = await params;
    const hostId = Number(rawHostId);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json(
        { error: "hostId non valido" },
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
      // 1) Header host (404 se non esiste / non Windows)
      const headerSql = `
        WITH winrm_status AS (
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
          h.id, h.ip, h.hostname, h.custom_name, h.os_info, h.os_family,
          CASE
            WHEN COALESCE(ws.winrm_validated, 0) = 1 THEN 1
            WHEN awa.has_ad = 1 THEN 1
            ELSE 0
          END AS winrm_validated,
          lp.last_probe_status, lp.last_probe_at
        FROM hosts h
        CROSS JOIN ad_winrm_available awa
        LEFT JOIN winrm_status ws ON ws.host_id = h.id
        LEFT JOIN last_probe lp ON lp.host_id = h.id
        WHERE h.id = ?
          AND LOWER(h.os_family) = 'windows'
      `;
      const header = db.prepare(headerSql).get(hostId) as
        | HostHeaderRow
        | undefined;

      if (!header) {
        return NextResponse.json(
          { error: "Host non trovato o non Windows" },
          { status: 404 }
        );
      }

      // 2) Ultimo scan_id ok per host (diretto OR via device IP-mapping)
      const scanRow = db
        .prepare(
          `
          SELECT MAX(id) AS scan_id FROM (
            SELECT ss.id AS id
              FROM software_scans ss
             WHERE ss.status = 'ok' AND ss.host_id = ?
            UNION ALL
            SELECT ss.id AS id
              FROM software_scans ss
              INNER JOIN network_devices nd ON nd.id = ss.device_id
              INNER JOIN hosts h ON h.ip = nd.host
             WHERE ss.status = 'ok' AND ss.device_id IS NOT NULL AND h.id = ?
          )
        `
        )
        .get(hostId, hostId) as { scan_id: number | null } | undefined;

      const lastScanId = scanRow?.scan_id ?? null;

      const software: SoftwareItem[] = [];
      // Dedup chiave: lower(name) + "|" + (version || "")
      const dedupKey = (name: string, version: string | null) =>
        `${name.toLowerCase()}|${version ?? ""}`;
      const seenSoftware = new Map<string, SoftwareItem>();

      if (lastScanId !== null) {
        // 3) Single query: software_inventory + LEFT JOIN CVE da 2 source
        // Source A (wazuh): match per package_name LIKE name+'%' su agent dell'host
        // Source B (patch_cve_target): match diretto su software_id
        const sql = `
          WITH host_agents AS (
            SELECT agent_id FROM wazuh_agent WHERE host_id = ?
          ),
          software_cve_pairs AS (
            -- A: CVE da wazuh_vuln matchate per package_name (prefix LIKE)
            SELECT
              si.id        AS software_id,
              si.name      AS name,
              si.version   AS version,
              si.publisher AS publisher,
              si.source    AS source,
              psm.choco_id AS choco_id,
              psm.cpe      AS cpe,
              wv.cve       AS cve_id,
              wv.severity  AS cve_severity,
              COALESCE(wv.cvss3_score, wv.cvss2_score) AS cve_cvss,
              'wazuh'      AS cve_source
            FROM software_inventory si
            LEFT JOIN patch_software_meta psm ON psm.software_id = si.id
            LEFT JOIN wazuh_vuln wv
              ON wv.agent_id IN (SELECT agent_id FROM host_agents)
             AND LOWER(wv.package_name) LIKE LOWER(si.name) || '%'
            WHERE si.scan_id = ?

            UNION ALL

            -- B: CVE da patch_cve_target su software_id diretto
            SELECT
              si.id        AS software_id,
              si.name      AS name,
              si.version   AS version,
              si.publisher AS publisher,
              si.source    AS source,
              psm.choco_id AS choco_id,
              psm.cpe      AS cpe,
              pct.cve_id   AS cve_id,
              NULL         AS cve_severity,
              NULL         AS cve_cvss,
              'patch_cve_target' AS cve_source
            FROM software_inventory si
            LEFT JOIN patch_software_meta psm ON psm.software_id = si.id
            INNER JOIN patch_cve_target pct ON pct.software_id = si.id
            WHERE si.scan_id = ?
          )
          SELECT * FROM software_cve_pairs
          ORDER BY name ASC, software_id ASC, cve_id ASC
          LIMIT ?
        `;

        const rows = db
          .prepare(sql)
          .all(hostId, lastScanId, lastScanId, MAX_SOFTWARE_CVE_ROWS) as SoftwareCveRow[];

        // Group by software_id in JS
        const bySoftware = new Map<number, SoftwareItem>();
        // Dedup CVE per software (chiave cveId+source)
        const cveSeen = new Map<number, Set<string>>();

        for (const r of rows) {
          let item = bySoftware.get(r.software_id);
          if (!item) {
            item = {
              softwareId: r.software_id,
              name: r.name,
              version: r.version,
              publisher: r.publisher,
              source: r.source,
              chocoId: r.choco_id,
              cpe: r.cpe,
              cves: [],
              patchable: false,
            };
            bySoftware.set(r.software_id, item);
            cveSeen.set(r.software_id, new Set());
          }
          if (r.cve_id) {
            const key = `${r.cve_id}|${r.cve_source ?? ""}`;
            const seen = cveSeen.get(r.software_id)!;
            if (!seen.has(key)) {
              seen.add(key);
              item.cves.push({
                cveId: r.cve_id,
                cvssScore: r.cve_cvss,
                severity: r.cve_severity,
                source: r.cve_source ?? "unknown",
              });
            }
          }
        }

        for (const item of bySoftware.values()) {
          item.patchable = item.cves.length > 0 && !!item.chocoId;
          seenSoftware.set(dedupKey(item.name, item.version), item);
        }
      }

      // 3b) Aggiungi pacchetti da wazuh_software per gli agent linkati a questo host.
      // I pacchetti wazuh-only hanno softwareId=null (no FK su patch_software_meta).
      // CVE associate via wazuh_vuln per LIKE package_name su agent dell'host.
      const wsSql = `
        WITH host_agents AS (
          SELECT agent_id FROM wazuh_agent WHERE host_id = ?
        )
        SELECT
          ws.name      AS name,
          ws.version   AS version,
          ws.vendor    AS publisher,
          ws.format    AS source,
          wv.cve       AS cve_id,
          wv.severity  AS cve_severity,
          COALESCE(wv.cvss3_score, wv.cvss2_score) AS cve_cvss
        FROM wazuh_software ws
        INNER JOIN host_agents ha ON ha.agent_id = ws.agent_id
        LEFT JOIN wazuh_vuln wv
          ON wv.agent_id = ws.agent_id
         AND LOWER(wv.package_name) LIKE LOWER(ws.name) || '%'
         AND (wv.package_version IS NULL OR ws.version IS NULL OR wv.package_version = ws.version)
        ORDER BY ws.name ASC, ws.version ASC
        LIMIT ?
      `;
      const wsRows = db.prepare(wsSql).all(hostId, MAX_SOFTWARE_CVE_ROWS) as Array<{
        name: string;
        version: string | null;
        publisher: string | null;
        source: string | null;
        cve_id: string | null;
        cve_severity: string | null;
        cve_cvss: number | null;
      }>;

      for (const r of wsRows) {
        const key = dedupKey(r.name, r.version);
        let item = seenSoftware.get(key);
        if (!item) {
          item = {
            softwareId: null, // wazuh-only: nessuna FK su patch_software_meta
            name: r.name,
            version: r.version,
            publisher: r.publisher,
            source: r.source ? `wazuh-agent (${r.source})` : "wazuh-agent",
            chocoId: null,
            cpe: null,
            cves: [],
            patchable: false,
          };
          seenSoftware.set(key, item);
        }
        if (r.cve_id) {
          const cveKey = `${r.cve_id}|wazuh`;
          if (!item.cves.some((c) => `${c.cveId}|${c.source}` === cveKey)) {
            item.cves.push({
              cveId: r.cve_id,
              cvssScore: r.cve_cvss,
              severity: r.cve_severity,
              source: "wazuh",
            });
          }
        }
      }

      for (const item of seenSoftware.values()) {
        item.patchable = item.cves.length > 0 && !!item.chocoId;
        software.push(item);
      }

      // Ordine per N CVE desc, poi name asc
      software.sort((a, b) => {
        if (b.cves.length !== a.cves.length) {
          return b.cves.length - a.cves.length;
        }
        return a.name.localeCompare(b.name);
      });

      return NextResponse.json(
        {
          hostId: header.id,
          ip: header.ip,
          hostname: header.hostname,
          customName: header.custom_name,
          osInfo: header.os_info,
          osFamily: header.os_family,
          winrmValidated: header.winrm_validated === 1,
          lastProbeStatus: header.last_probe_status,
          lastProbeAt: header.last_probe_at,
          lastScanId,
          software,
        },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/device/:id GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero del device" },
        { status: 500 }
      );
    }
  });
}
