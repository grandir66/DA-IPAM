import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAdIntegrationById, getDb } from "@/lib/db";
import { toHubExport } from "@/lib/ad/health/export";
import {
  ensureAdHealthSchema,
  getFindings,
  getRunById,
  type AdHealthRunRow,
} from "@/lib/ad/health/persist";
import type { HealthScore } from "@/lib/ad/health/types";

const QuerySchema = z.object({
  runId: z.coerce.number().int().positive(),
});

function scoreFromRun(run: AdHealthRunRow): HealthScore | null {
  if (run.scoreGlobal == null) return null;
  return {
    global: run.scoreGlobal,
    stale: run.scoreStale ?? 0,
    privileged: run.scorePrivileged ?? 0,
    trust: run.scoreTrust ?? 0,
    anomaly: run.scoreAnomaly ?? 0,
  };
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "domain";
}

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      runId: searchParams.get("runId"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parametro runId non valido", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { runId } = parsed.data;
    const db = getDb();
    ensureAdHealthSchema(db);
    const run = getRunById(db, runId);
    if (!run) {
      return NextResponse.json({ error: "Run non trovato" }, { status: 404 });
    }

    const score = scoreFromRun(run);
    if (!score) {
      return NextResponse.json({ error: "Run senza score (ancora in corso o fallito)" }, { status: 409 });
    }

    const integration = getAdIntegrationById(run.integrationId);
    if (!integration) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }

    const findings = getFindings(db, run.id);
    const payload = toHubExport({
      domainFqdn: integration.domain,
      score,
      findings,
    });

    const filename = `ad-health-${safeFilenamePart(integration.domain)}-${runId}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
