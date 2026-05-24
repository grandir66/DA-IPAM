/**
 * GET /api/software
 *
 * Vista globale aggregata di TUTTI i software del tenant deduplicati per
 * `(name, version)` con conteggio host e count CVE associate.
 * Sorgenti: wazuh_software + software_inventory (probe) + estrazione
 * best-effort da vuln_findings.nvt_name (Greenbone).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getAggregatedSoftware,
  type AggregatedSoftwareOpts,
  type SoftwareSource,
} from "@/lib/db-tenant";

const SourceEnum = z.enum(["Wazuh", "Probe", "Greenbone"]);

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sources: z.string().optional(),
  search: z.string().max(200).optional(),
  hasVulns: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["name", "host_count", "vuln_count", "latest_seen_at"]).default("host_count"),
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
  const sources = q.sources
    ? (q.sources
        .split(",")
        .map((s) => s.trim())
        .filter((s) => SourceEnum.safeParse(s).success) as SoftwareSource[])
    : undefined;

  const opts: AggregatedSoftwareOpts = {
    page: q.page,
    pageSize: q.pageSize,
    sources,
    search: q.search,
    hasVulns:
      q.hasVulns === "true" ? true : q.hasVulns === "false" ? false : undefined,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
  };

  return withTenantFromSession(() => {
    try {
      const { data, total } = getAggregatedSoftware(opts);
      return NextResponse.json({
        data,
        total,
        page: opts.page,
        pageSize: opts.pageSize,
        totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
      });
    } catch (e) {
      console.error("[api/software] errore:", e);
      return NextResponse.json(
        { error: "Errore nel recupero dei software" },
        { status: 500 },
      );
    }
  });
}
