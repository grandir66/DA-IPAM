/**
 * GET /api/patch/cve/[cveId]
 *
 * Dettaglio singolo CVE: cvssScore, severity, title, description, references,
 * package_name/version (da wazuh_vuln se presente), elenco match noti dal
 * modulo (`patch_cve_target`) per discriminare se esiste già un fix candidato.
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

interface WazuhDetailRow {
  cve: string;
  severity: string | null;
  cvss3_score: number | null;
  cvss2_score: number | null;
  title: string | null;
  package_name: string | null;
  package_version: string | null;
  external_references: string | null;
}

interface VulnFindingDetailRow {
  cve_id: string;
  severity: string | null;
  cvss_score: number | null;
  nvt_name: string | null;
  description: string | null;
  cvss_vector: string | null;
}

interface CveTargetRow {
  software_id: number;
  match_strategy: string;
  confidence: number;
  fix_package_manager: string | null;
  fix_package_id: string | null;
  fix_version: string | null;
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
      // Wazuh: prima riga utile (priorità per ranking severity/score)
      const wazuh = db
        .prepare(
          `SELECT cve, severity, cvss3_score, cvss2_score, title,
                  package_name, package_version, external_references
             FROM wazuh_vuln
            WHERE cve = ?
            ORDER BY COALESCE(cvss3_score, cvss2_score) DESC
            LIMIT 1`
        )
        .get(cveId) as WazuhDetailRow | undefined;

      // vuln_findings: prima riga con descrizione popolata se possibile
      const finding = db
        .prepare(
          `SELECT cve_id, severity, cvss_score, nvt_name, description, cvss_vector
             FROM vuln_findings
            WHERE cve_id = ?
            ORDER BY (CASE WHEN description IS NULL OR description = '' THEN 1 ELSE 0 END),
                     cvss_score DESC
            LIMIT 1`
        )
        .get(cveId) as VulnFindingDetailRow | undefined;

      if (!wazuh && !finding) {
        return NextResponse.json(
          { error: "CVE non trovata" },
          { status: 404 }
        );
      }

      const cvssScore =
        wazuh?.cvss3_score ?? wazuh?.cvss2_score ?? finding?.cvss_score ?? null;
      const severity = wazuh?.severity ?? finding?.severity ?? null;
      const title = wazuh?.title ?? finding?.nvt_name ?? null;
      const description = finding?.description ?? null;
      const cvssVector = finding?.cvss_vector ?? null;

      // Parse external_references se presente (Wazuh restituisce JSON o CSV)
      let references: string[] = [];
      if (wazuh?.external_references) {
        try {
          const parsed = JSON.parse(wazuh.external_references);
          if (Array.isArray(parsed)) {
            references = parsed.filter((r): r is string => typeof r === "string");
          }
        } catch {
          // Fallback: split CSV
          references = wazuh.external_references
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }

      // Matches noti dal modulo
      const matches = db
        .prepare(
          `SELECT software_id, match_strategy, confidence,
                  fix_package_manager, fix_package_id, fix_version
             FROM patch_cve_target
            WHERE cve_id = ?
            ORDER BY confidence DESC, software_id ASC`
        )
        .all(cveId) as CveTargetRow[];

      const payload = {
        cveId,
        cvssScore,
        cvssVector,
        severity,
        title,
        description,
        packageName: wazuh?.package_name ?? null,
        packageVersion: wazuh?.package_version ?? null,
        references,
        matches: matches.map((m) => ({
          softwareId: m.software_id,
          matchStrategy: m.match_strategy,
          confidence: m.confidence,
          fixPackageManager: m.fix_package_manager,
          fixPackageId: m.fix_package_id,
          fixVersion: m.fix_version,
        })),
      };

      return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error("[patch/cve/:id GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero del dettaglio CVE" },
        { status: 500 }
      );
    }
  });
}
