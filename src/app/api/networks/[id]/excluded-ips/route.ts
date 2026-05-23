import { NextResponse } from "next/server";
import { getExcludedIps, removeFromExcludedIps, addToExcludedIps, getNetworkById } from "@/lib/db";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    const networkId = Number(id);
    const network = getNetworkById(networkId);
    if (!network) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    return NextResponse.json({ excluded_ips: getExcludedIps(networkId) });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const networkId = Number(id);
    let body: { ip?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.ip) return NextResponse.json({ error: "ip richiesto" }, { status: 400 });
    const removed = removeFromExcludedIps(networkId, body.ip);
    return NextResponse.json({ removed });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const networkId = Number(id);
    let body: { ip?: string; reason?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.ip) return NextResponse.json({ error: "ip richiesto" }, { status: 400 });
    addToExcludedIps(networkId, body.ip, body.reason ?? "manual", adminCheck.user?.name ?? adminCheck.user?.email ?? null);
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
