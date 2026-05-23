/**
 * GET /api/hosts/[id]/vulnerabilities
 *
 * Findings CVE per un host, UNIFICATI tra le sorgenti:
 *   - Greenbone / scanner-edge (vuln_findings + vuln_scan_runs + vuln_scanners)
 *   - Wazuh agent (wazuh_vuln via wazuh_agent.host_id)
 *
 * Dedupe per `cve_id` (oppure `nvt_oid` quando CVE assente). Per ogni gruppo
 * teniamo il rilevamento più recente come `scanned_at`, max severity, max
 * cvss_score, e accumulo le fonti come array `sources`. Coerenza UI: il
 * conteggio rollup è sui finding *deduplicati* → header e tabella sempre allineati.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";

interface SeverityRollup {
  Critical: number;
  High: number;
  Medium: number;
  Low: number;
  Log: number;
}

const EMPTY: SeverityRollup = { Critical: 0, High: 0, Medium: 0, Low: 0, Log: 0 };

interface UnifiedFinding {
  id: string;            // key sintetica (cve_id o nvt_oid o synthesis)
  cve_id: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
  severity: string;
  port: string | null;
  service: string | null;
  nvt_oid: string | null;
  nvt_name: string | null;
  description: string | null;
  scanned_at: string;
  sources: string[];     // ["Greenbone", "Wazuh"] etc — fonti che hanno rilevato la stessa CVE
}

const SEVERITY_RANK: Record<string, number> = {
  Critical: 4, High: 3, Medium: 2, Low: 1, Log: 0,
};

function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
}

/** Wazuh severity può essere "Critical|High|Medium|Low|Untriaged" — mappa Untriaged a Low. */
function normalizeSeverity(raw: string | null | undefined): string {
  if (!raw) return "Low";
  const s = raw.trim();
  if (s === "Critical" || s === "High" || s === "Medium" || s === "Low") return s;
  return "Low";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  const { id } = await ctx.params;
  const hostId = Number(id);
  if (!Number.isFinite(hostId) || hostId <= 0) {
    return NextResponse.json({ error: "id non valido" }, { status: 400 });
  }

  return await withTenantFromSession(() => {
    const code = getCurrentTenantCode() ?? "DEFAULT";
    const db = getTenantDb(code);

    // ─── Step 1: Greenbone / scanner-edge — dedupe per (cve_id|nvt_oid, port) ──
    // Includiamo TUTTI gli scan_run del host: per ogni gruppo teniamo MAX(scanned_at).
    // Lo scanner_name viene dal join con vuln_scanners (best-effort).
    const greenboneRows = db
      .prepare(
        `SELECT f.id, f.cve_id, MAX(f.cvss_score) AS cvss_score, f.cvss_vector,
                f.severity, f.port, f.service, f.nvt_oid, f.nvt_name,
                f.description, MAX(f.scanned_at) AS scanned_at,
                COALESCE(s.name, 'Greenbone') AS source
           FROM vuln_findings f
           LEFT JOIN vuln_scan_runs r ON r.id = f.scan_run_id
           LEFT JOIN vuln_scanners s ON s.id = r.scanner_id
          WHERE f.host_id = ?
            AND f.severity IN ('Critical','High','Medium','Low')
          GROUP BY COALESCE(f.cve_id, ''), COALESCE(f.nvt_oid, ''), COALESCE(f.port, '')`,
      )
      .all(hostId) as Array<{
        id: number; cve_id: string | null; cvss_score: number | null;
        cvss_vector: string | null; severity: string; port: string | null;
        service: string | null; nvt_oid: string | null; nvt_name: string | null;
        description: string | null; scanned_at: string; source: string;
      }>;

    // ─── Step 2: Wazuh — CVE registrate per l'agent collegato a questo host ──
    const wazuhRows = db
      .prepare(
        `SELECT v.cve, COALESCE(v.cvss3_score, v.cvss2_score) AS cvss_score,
                v.severity, v.package_name, v.package_version,
                v.detection_time AS scanned_at,
                a.agent_id AS agent_id
           FROM wazuh_vuln v
           JOIN wazuh_agent a ON a.agent_id = v.agent_id
          WHERE a.host_id = ?
            AND v.status IN ('VALID','PENDING')`,
      )
      .all(hostId) as Array<{
        cve: string; cvss_score: number | null; severity: string | null;
        package_name: string | null; package_version: string | null;
        scanned_at: string | null; agent_id: string;
      }>;

    // ─── Step 3: merge per (cve_id | nvt_oid) — accumulo sources ─────────────
    const merged = new Map<string, UnifiedFinding>();

    for (const g of greenboneRows) {
      const key = g.cve_id ?? g.nvt_oid ?? `nvt:${g.id}`;
      const sev = normalizeSeverity(g.severity);
      const existing = merged.get(key);
      if (existing) {
        existing.severity = maxSeverity(existing.severity, sev);
        existing.cvss_score = Math.max(existing.cvss_score ?? 0, g.cvss_score ?? 0) || existing.cvss_score;
        if (g.scanned_at > existing.scanned_at) existing.scanned_at = g.scanned_at;
        if (!existing.sources.includes(g.source)) existing.sources.push(g.source);
      } else {
        merged.set(key, {
          id: key,
          cve_id: g.cve_id,
          cvss_score: g.cvss_score,
          cvss_vector: g.cvss_vector,
          severity: sev,
          port: g.port,
          service: g.service,
          nvt_oid: g.nvt_oid,
          nvt_name: g.nvt_name,
          description: g.description,
          scanned_at: g.scanned_at,
          sources: [g.source],
        });
      }
    }

    for (const w of wazuhRows) {
      const key = w.cve;
      const sev = normalizeSeverity(w.severity);
      if (!["Critical", "High", "Medium", "Low"].includes(sev)) continue;
      const existing = merged.get(key);
      const pkgLabel = w.package_name
        ? `${w.package_name}${w.package_version ? " " + w.package_version : ""}`
        : null;
      if (existing) {
        existing.severity = maxSeverity(existing.severity, sev);
        existing.cvss_score = Math.max(existing.cvss_score ?? 0, w.cvss_score ?? 0) || existing.cvss_score;
        if (w.scanned_at && w.scanned_at > existing.scanned_at) existing.scanned_at = w.scanned_at;
        if (!existing.sources.includes("Wazuh")) existing.sources.push("Wazuh");
        if (!existing.nvt_name && pkgLabel) existing.nvt_name = `Pacchetto: ${pkgLabel}`;
      } else {
        merged.set(key, {
          id: key,
          cve_id: w.cve,
          cvss_score: w.cvss_score,
          cvss_vector: null,
          severity: sev,
          port: null,
          service: pkgLabel,
          nvt_oid: null,
          nvt_name: pkgLabel ? `Pacchetto: ${pkgLabel}` : null,
          description: null,
          scanned_at: w.scanned_at ?? new Date().toISOString(),
          sources: ["Wazuh"],
        });
      }
    }

    // ─── Step 4: rollup (sui finding deduplicati, non sui raw) ───────────────
    const rollup: SeverityRollup = { ...EMPTY };
    for (const f of merged.values()) {
      if (f.severity in rollup) rollup[f.severity as keyof SeverityRollup]++;
    }

    // Ordine: severity DESC, poi cvss DESC, poi scanned_at DESC
    const findings = Array.from(merged.values()).sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 0;
      const sb = SEVERITY_RANK[b.severity] ?? 0;
      if (sa !== sb) return sb - sa;
      const ca = a.cvss_score ?? 0;
      const cb = b.cvss_score ?? 0;
      if (ca !== cb) return cb - ca;
      return b.scanned_at.localeCompare(a.scanned_at);
    }).slice(0, 200);

    // Last scan info: massimo scanned_at fra tutti i finding (cross-source)
    const lastScannedAt = findings.length > 0
      ? findings.reduce((acc, f) => (f.scanned_at > acc ? f.scanned_at : acc), findings[0].scanned_at)
      : null;

    return NextResponse.json({
      host_id: hostId,
      last_run: lastScannedAt
        ? {
            id: 0,
            started_at: lastScannedAt,
            finished_at: lastScannedAt,
            finding_count: findings.length,
          }
        : null,
      severity_rollup: rollup,
      findings,
    });
  });
}
