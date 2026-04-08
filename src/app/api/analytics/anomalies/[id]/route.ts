import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  acknowledgeAnomalyEvent,
  resolveAnomalyEvent,
  deleteAnomalyEvent,
} from "@/lib/analytics/anomaly-db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const { id } = await params;
  const eventId = Number(id);
  if (isNaN(eventId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });

  return withTenantFromSession(async () => {
    const body = (await req.json()) as { action: string; note?: string };

    if (body.action === "acknowledge") {
      const username = (session as { user?: { name?: string } }).user?.name ?? "unknown";
      const ok = acknowledgeAnomalyEvent(eventId, username);
      if (!ok) return NextResponse.json({ error: "Evento non trovato" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "resolve") {
      const ok = resolveAnomalyEvent(eventId);
      if (!ok) return NextResponse.json({ error: "Evento non trovato" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  const { id } = await params;
  const eventId = Number(id);
  if (isNaN(eventId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });

  return withTenantFromSession(async () => {
    const ok = deleteAnomalyEvent(eventId);
    if (!ok) return NextResponse.json({ error: "Evento non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
