/**
 * Stato e trigger scan VA Greenbone su scanner-edge dalla pagina subnet.
 *
 * Il profilo assessment è un id del catalogo dell'edge (EDG-1): qui si accetta
 * solo un id sicuro, e prima di avviare o pianificare si controlla che l'edge
 * lo abbia (`resolveAssessmentForNetwork`). L'elenco per la pagina viene da
 * `/api/integrations/scanner-edge/profiles`.
 */

import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  loadEdgeSubnetStatus,
  triggerSubnetEdgeScan,
  saveEdgeSubnetSchedule,
  removeEdgeSubnetSchedule,
  resolveAssessmentForNetwork,
  type EdgeScanProfile,
} from "@/lib/vuln/edge-subnet-bridge";
import { z } from "zod";
import { buildCron } from "@/lib/vuln/cron-builder";
import { getEdgeSchedule, deleteEdgeSchedule } from "@/lib/vuln/edge-schedule-store";
import { assessmentProfileIdSchema } from "@/lib/vuln/edge-profiles";

const postSchema = z.object({
  profile: z.enum(["fast", "balanced", "deep"]).optional(),
  sync_hosts: z.boolean().optional(),
  sync_credentials: z.boolean().optional(),
  run_arp: z.boolean().optional(),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]).optional(),
  assessment_enabled: z.boolean().optional(),
  assessment_profile_id: assessmentProfileIdSchema.nullable().optional(),
});

const scheduleSchema = z.object({
  enabled: z.boolean(),
  profile: z.enum(["fast", "balanced", "deep"]),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]).optional(),
  assessment_enabled: z.boolean().optional(),
  assessment_profile_id: assessmentProfileIdSchema.nullable().optional(),
  job_name: z.string().min(1).max(120),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  at_time: z.string().regex(/^\d{1,2}:\d{2}$/),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  day_of_month: z.number().int().min(1).max(28).optional(),
});

/** Corpo della richiesta letto e validato; un id di profilo sbagliato dice cosa c'è di sbagliato. */
async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Body JSON non valido" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const profileIssue = parsed.error.issues.find((i) => i.path[0] === "assessment_profile_id");
    return {
      ok: false,
      response: NextResponse.json(
        { error: profileIssue?.message ?? "Body JSON non valido", details: parsed.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => {
    const { id } = await params;
    const networkId = Number(id);
    if (!Number.isFinite(networkId)) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }
    const status = await loadEdgeSubnetStatus(networkId);
    return NextResponse.json({ ...status, savedSchedule: getEdgeSchedule(networkId) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const { id } = await params;
    const networkId = Number(id);
    if (!Number.isFinite(networkId)) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }

    const parsed = await parseBody(req, postSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Prima di scrivere: l'edge deve avere il profilo (anche quello già salvato).
    const assessment = await resolveAssessmentForNetwork(networkId, {
      enabled: body.assessment_enabled,
      profileId: body.assessment_profile_id,
    });
    if (!assessment.ok) {
      return NextResponse.json({ ok: false, error: assessment.error }, { status: assessment.status });
    }

    const result = await triggerSubnetEdgeScan(networkId, {
      profile: body.profile as EdgeScanProfile | undefined,
      syncHosts: body.sync_hosts,
      syncCredentials: body.sync_credentials,
      runArp: body.run_arp,
      targetingMode: body.targeting_mode,
      assessmentEnabled: assessment.enabled,
      assessmentProfileId: assessment.profileId,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    return NextResponse.json(result);
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const { id } = await params;
    const networkId = Number(id);
    if (!Number.isFinite(networkId)) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }

    const parsed = await parseBody(req, scheduleSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const cronExpr = buildCron({
      frequency: body.frequency,
      at: body.at_time,
      daysOfWeek: body.days_of_week,
      dayOfMonth: body.day_of_month,
    });

    // Una pianificazione con un profilo che l'edge non ha fallirebbe dopo ogni
    // scansione, in silenzio: si ferma qui, prima di scrivere.
    const assessment = await resolveAssessmentForNetwork(networkId, {
      enabled: body.assessment_enabled,
      profileId: body.assessment_profile_id,
    });
    if (!assessment.ok) {
      return NextResponse.json({ ok: false, error: assessment.error }, { status: assessment.status });
    }

    // Il DB prende il profilo nuovo solo dopo che l'edge l'ha accettato con
    // /networks/ensure (lo fa il bridge): il pannello calcola «Profilo assente»
    // sul DB, che deve dire quello che ha l'edge.
    const result = await saveEdgeSubnetSchedule(networkId, {
      enabled: body.enabled,
      profile: body.profile,
      targetingMode: body.targeting_mode,
      cronExpr,
      jobName: body.job_name,
      frequency: body.frequency,
      atTime: body.at_time,
      daysOfWeek: body.days_of_week,
      dayOfMonth: body.day_of_month,
      assessmentEnabled: assessment.enabled,
      assessmentProfileId: assessment.profileId,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    const status = await loadEdgeSubnetStatus(networkId);
    return NextResponse.json({ ok: true, degraded: result.degraded ?? false, warning: result.warning, ...status });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const { id } = await params;
    const networkId = Number(id);
    if (!Number.isFinite(networkId)) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }

    const result = await removeEdgeSubnetSchedule(networkId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    deleteEdgeSchedule(networkId);

    const status = await loadEdgeSubnetStatus(networkId);
    return NextResponse.json({ ok: true, ...status });
  });
}
