/**
 * Stato e trigger scan VA Greenbone su scanner-edge dalla pagina subnet.
 */

import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  loadEdgeSubnetStatus,
  triggerSubnetEdgeScan,
  saveEdgeSubnetSchedule,
  removeEdgeSubnetSchedule,
  type EdgeScanProfile,
} from "@/lib/vuln/edge-subnet-bridge";
import { z } from "zod";
import { buildCron } from "@/lib/vuln/cron-builder";
import { getEdgeSchedule, deleteEdgeSchedule } from "@/lib/vuln/edge-schedule-store";

const postSchema = z.object({
  profile: z.enum(["fast", "balanced", "deep"]).optional(),
  sync_hosts: z.boolean().optional(),
  sync_credentials: z.boolean().optional(),
  run_arp: z.boolean().optional(),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]).optional(),
});

const scheduleSchema = z.object({
  enabled: z.boolean(),
  profile: z.enum(["fast", "balanced", "deep"]),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]).optional(),
  job_name: z.string().min(1).max(120),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  at_time: z.string().regex(/^\d{1,2}:\d{2}$/),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  day_of_month: z.number().int().min(1).max(28).optional(),
});

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

    let body: z.infer<typeof postSchema> = {};
    try {
      const raw = await req.json();
      body = postSchema.parse(raw);
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const result = await triggerSubnetEdgeScan(networkId, {
      profile: body.profile as EdgeScanProfile | undefined,
      syncHosts: body.sync_hosts,
      syncCredentials: body.sync_credentials,
      runArp: body.run_arp,
      targetingMode: body.targeting_mode,
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

    let body: z.infer<typeof scheduleSchema>;
    try {
      body = scheduleSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const cronExpr = buildCron({
      frequency: body.frequency,
      at: body.at_time,
      daysOfWeek: body.days_of_week,
      dayOfMonth: body.day_of_month,
    });

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
