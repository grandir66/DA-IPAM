import { NextResponse } from "next/server";
import { getHostById, updateHost, deleteHost, getDb } from "@/lib/db";
import { scriviClassificazione } from "@/lib/classification/scrivi";
import { HostUpdateSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const host = getHostById(Number(id));
      if (!host) {
        return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
      }
      return NextResponse.json(host);
    } catch (error) {
      console.error("Error fetching host:", error);
      return NextResponse.json({ error: "Errore nel recupero dell'host" }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const hostId = Number(id);
    const body = await request.json();
    // `detect_credentials` (pin per ruolo) è superato dalla 2d: lo schema lo rifiuta con un 400.
    const parsed = HostUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    // La classificazione passa dal punto unico (scrive anche sull'apparato abbinato); il resto da updateHost.
    const { classification, ...resto } = parsed.data;
    const host = updateHost(hostId, resto);
    if (!host) {
      return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
    }
    if (classification !== undefined && classification !== "") {
      scriviClassificazione(getDb(), { hostId }, classification, { manuale: true });
    }
    const full = getHostById(hostId);
    return NextResponse.json(full ?? host);
    } catch (error) {
      console.error("Error updating host:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento dell'host" }, { status: 500 });
    }
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const excludedBy = adminCheck.user?.name ?? adminCheck.user?.email ?? null;
      const deleted = deleteHost(Number(id), { reason: "host_deleted", excludedBy });
      if (!deleted) {
        return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting host:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione dell'host" }, { status: 500 });
    }
  });
}
