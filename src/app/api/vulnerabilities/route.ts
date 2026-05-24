/**
 * GET /api/vulnerabilities
 *
 * Vista globale aggregata di TUTTE le vulnerabilità del tenant (edge + Wazuh),
 * deduplicate per CVE-ID (fallback `nvt:${nvt_oid}`), ordinate per criticità.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getAggregatedVulnerabilities,
  type AggregatedVulnOpts,
} from "@/lib/db-tenant";

const SeverityEnum = z.enum(["Critical", "High", "Medium", "Low"]);

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  severity: z.string().optional(),
  sources: z.string().optional(),
  search: z.string().max(200).optional(),
  hasCve: z.enum(["true", "false"]).optional(),
  sortBy: z
    .enum(["severity", "cvss", "host_count", "latest_scanned_at", "cve_id"])
    .default("severity"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Parametri non validi" },
      { status: 400 },
    );
  }

  const q = parsed.data;
  const severity = q.severity
    ? (q.severity
        .split(",")
        .map((s) => s.trim())
        .filter((s) => SeverityEnum.safeParse(s).success) as Array<
        z.infer<typeof SeverityEnum>
      >)
    : undefined;
  const sources = q.sources
    ? q.sources.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const opts: AggregatedVulnOpts = {
    page: q.page,
    pageSize: q.pageSize,
    severity,
    sources,
    search: q.search,
    hasCve:
      q.hasCve === "true" ? true : q.hasCve === "false" ? false : undefined,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
  };

  return withTenantFromSession(() => {
    try {
      const { data, total, severity_rollup } =
        getAggregatedVulnerabilities(opts);
      return NextResponse.json({
        data,
        total,
        page: opts.page,
        pageSize: opts.pageSize,
        totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
        severity_rollup,
      });
    } catch (e) {
      console.error("[api/vulnerabilities] errore:", e);
      return NextResponse.json(
        { error: "Errore nel recupero delle vulnerabilità" },
        { status: 500 },
      );
    }
  });
}
