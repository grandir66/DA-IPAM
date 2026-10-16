import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAdIntegrationById, getDb } from "@/lib/db";
import {
  AdHealthConflictError,
  aclFromStatsJson,
  privilegeMatrixFromStatsJson,
  runAdHealthcheck,
} from "@/lib/ad/health/engine";
import {
  ensureAdHealthSchema,
  getFindings,
  getLatestOkRun,
  getLatestRun,
  reclaimStaleRunningRuns,
  type AdHealthRunRow,
} from "@/lib/ad/health/persist";
import type { HealthScore } from "@/lib/ad/health/types";

const PostBodySchema = z.object({
  integrationId: z.number().int().positive(),
  refreshSync: z.boolean().optional(),
});

const GetQuerySchema = z.object({
  integrationId: z.coerce.number().int().positive(),
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

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const { searchParams } = new URL(request.url);
    const parsed = GetQuerySchema.safeParse({
      integrationId: searchParams.get("integrationId"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parametro integrationId non valido", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { integrationId } = parsed.data;
    const integration = getAdIntegrationById(integrationId);
    if (!integration) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }

    const db = getDb();
    ensureAdHealthSchema(db);
    reclaimStaleRunningRuns(db, integrationId);

    const latest = getLatestRun(db, integrationId);
    if (!latest) {
      return NextResponse.json({
        run: null,
        score: null,
        findings: [],
        privilegeMatrix: null,
        acl: null,
        winrm: null,
        phase5: null,
        phase6: null,
        displayRunId: null,
      });
    }

    // If latest is running/error without stats, still show last successful results.
    const display =
      latest.status === "ok" && latest.statsJson
        ? latest
        : (getLatestOkRun(db, integrationId) ?? latest);

    const findings = getFindings(db, display.id);
    let winrm = null;
    let phase5 = null;
    let phase6 = null;
    if (display.statsJson) {
      try {
        const parsed = JSON.parse(display.statsJson) as {
          winrm?: unknown;
          phase5?: unknown;
          phase6?: unknown;
        };
        winrm = parsed.winrm ?? null;
        phase5 = parsed.phase5 ?? null;
        phase6 = parsed.phase6 ?? null;
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      run: latest,
      displayRunId: display.id,
      score: scoreFromRun(display),
      findings,
      privilegeMatrix: privilegeMatrixFromStatsJson(display.statsJson),
      acl: aclFromStatsJson(display.statsJson),
      winrm,
      phase5,
      phase6,
    });
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = PostBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { integrationId, refreshSync } = parsed.data;
    const integration = getAdIntegrationById(integrationId);
    if (!integration) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }
    if (!integration.enabled) {
      return NextResponse.json({ error: "Integrazione disabilitata" }, { status: 400 });
    }

    try {
      const result = await runAdHealthcheck(integrationId, { refreshSync });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof AdHealthConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
