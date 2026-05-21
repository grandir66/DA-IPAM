/**
 * GET /api/hosts/[id]/vulnerabilities
 *
 * Findings CVE per un host. MVP: ultima scan_run + ultime 100 findings
 * (per evitare di scaricare archivi enormi in una sola call). Severity
 * rollup conteggiato sul `vuln_scan_runs` più recente che ha trovato
 * findings per questo host.
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

    // Ultimo scan_run con findings su questo host
    const lastRun = db
      .prepare(
        `SELECT r.id, r.started_at, r.finished_at, r.finding_count
           FROM vuln_scan_runs r
          WHERE r.id IN (SELECT scan_run_id FROM vuln_findings WHERE host_id = ?)
          ORDER BY COALESCE(r.finished_at, r.started_at) DESC LIMIT 1`,
      )
      .get(hostId) as
      | { id: number; started_at: string; finished_at: string; finding_count: number }
      | undefined;

    const rollup: SeverityRollup = { ...EMPTY };
    let lastRunFindings: number = 0;
    if (lastRun) {
      const rows = db
        .prepare(
          `SELECT severity, COUNT(*) AS n FROM vuln_findings
            WHERE host_id = ? AND scan_run_id = ?
            GROUP BY severity`,
        )
        .all(hostId, lastRun.id) as Array<{ severity: keyof SeverityRollup; n: number }>;
      for (const r of rows) {
        if (r.severity in rollup) rollup[r.severity] = r.n;
        lastRunFindings += r.n;
      }
    }

    const findings = db
      .prepare(
        `SELECT id, scan_run_id, ip, mac, hostname, port, service,
                cve_id, cvss_score, cvss_vector, severity,
                nvt_oid, nvt_name, description, scanned_at
           FROM vuln_findings
          WHERE host_id = ?
          ORDER BY scanned_at DESC, id DESC LIMIT 100`,
      )
      .all(hostId);

    return NextResponse.json({
      host_id: hostId,
      last_run: lastRun
        ? {
            id: lastRun.id,
            started_at: lastRun.started_at,
            finished_at: lastRun.finished_at,
            finding_count: lastRunFindings,
          }
        : null,
      severity_rollup: rollup,
      findings,
    });
  });
}
