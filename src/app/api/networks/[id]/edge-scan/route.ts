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

const postSchema = z.object({
  profile: z.enum(["fast", "balanced", "deep"]).optional(),
  sync_hosts: z.boolean().optional(),
  sync_credentials: z.boolean().optional(),
  run_arp: z.boolean().optional(),
});

const scheduleSchema = z.object({
  enabled: z.boolean(),
  interval_minutes: z.number().int().min(60).max(10080),
  profile: z.enum(["fast", "balanced", "deep"]),
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
    return NextResponse.json(status);
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

    const result = await saveEdgeSubnetSchedule(networkId, {
      enabled: body.enabled,
      intervalMinutes: body.interval_minutes,
      profile: body.profile,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    const status = await loadEdgeSubnetStatus(networkId);
    return NextResponse.json({ ok: true, ...status });
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

    const status = await loadEdgeSubnetStatus(networkId);
    return NextResponse.json({ ok: true, ...status });
  });
}
