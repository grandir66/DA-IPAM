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
  getLatestRun,
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
    const run = getLatestRun(db, integrationId);
    if (!run) {
      return NextResponse.json({
        run: null,
        score: null,
        findings: [],
        privilegeMatrix: null,
        acl: null,
      });
    }

    const findings = getFindings(db, run.id);
    return NextResponse.json({
      run,
      score: scoreFromRun(run),
      findings,
      privilegeMatrix: privilegeMatrixFromStatsJson(run.statsJson),
      acl: aclFromStatsJson(run.statsJson),
      winrm: (() => {
        try {
          const parsed = run.statsJson ? JSON.parse(run.statsJson) : null;
          return parsed?.winrm ?? null;
        } catch {
          return null;
        }
      })(),
      phase5: (() => {
        try {
          const parsed = run.statsJson ? JSON.parse(run.statsJson) : null;
          return parsed?.phase5 ?? null;
        } catch {
          return null;
        }
      })(),
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
