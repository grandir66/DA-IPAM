import { NextResponse } from "next/server";
import {
  getHostById,
  updateHost,
  deleteHost,
  setHostDetectCredential,
  deleteHostDetectCredential,
  type HostDetectCredentialRole,
} from "@/lib/db";
import { HostUpdateSchema } from "@/lib/validators";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
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
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const hostId = Number(id);
    const body = await request.json();
    const parsed = HostUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { detect_credentials: detectCreds, ...hostFields } = parsed.data;
    const host = updateHost(hostId, hostFields);
    if (!host) {
      return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
    }
    if (detectCreds) {
      const roles: HostDetectCredentialRole[] = ["windows", "linux", "ssh", "snmp"];
      for (const role of roles) {
        if (!(role in detectCreds)) continue;
        const cid = detectCreds[role];
        if (cid === null) deleteHostDetectCredential(hostId, role);
        else setHostDetectCredential(hostId, role, cid);
      }
    }
    const full = getHostById(hostId);
    return NextResponse.json(full ?? host);
  } catch (error) {
    console.error("Error updating host:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento dell'host" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deleted = deleteHost(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting host:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione dell'host" }, { status: 500 });
  }
}
