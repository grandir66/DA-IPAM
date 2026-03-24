import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getHostCredentials,
  addHostCredential,
  removeHostCredential,
  setHostCredentialValidated,
} from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/** GET — credenziali associate a un host. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const hostId = Number(id);
      const credentials = getHostCredentials(hostId);
      return NextResponse.json({ credentials });
    } catch (error) {
      console.error("Error fetching host credentials:", error);
      return NextResponse.json({ error: "Errore nel recupero credenziali host" }, { status: 500 });
    }
  });
}

const PostSchema = z.object({
  credential_id: z.number().int().positive(),
  protocol_type: z.enum(["ssh", "snmp", "winrm", "api"]),
  port: z.number().int().min(1).max(65535),
  validated: z.boolean().optional(),
});

/** POST — aggiunge credenziale a un host. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const hostId = Number(id);
    const body = await request.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { credential_id, protocol_type, port, validated } = parsed.data;
    addHostCredential(hostId, credential_id, protocol_type, port, { validated });
    const credentials = getHostCredentials(hostId);
    return NextResponse.json({ credentials });
    } catch (error) {
      console.error("Error adding host credential:", error);
      return NextResponse.json({ error: "Errore nell'aggiunta credenziale" }, { status: 500 });
    }
  });
}

const DeleteSchema = z.object({
  binding_id: z.number().int().positive(),
});

/** DELETE — rimuove credenziale da un host (per id binding). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const hostId = Number(id);
    const body = await request.json();
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    removeHostCredential(parsed.data.binding_id);
    const credentials = getHostCredentials(hostId);
    return NextResponse.json({ credentials });
    } catch (error) {
      console.error("Error removing host credential:", error);
      return NextResponse.json({ error: "Errore nella rimozione credenziale" }, { status: 500 });
    }
  });
}

const PatchSchema = z.object({
  binding_id: z.number().int().positive(),
  validated: z.boolean(),
});

/** PATCH — aggiorna stato validazione. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const hostId = Number(id);
    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    setHostCredentialValidated(parsed.data.binding_id, parsed.data.validated);
    const credentials = getHostCredentials(hostId);
    return NextResponse.json({ credentials });
    } catch (error) {
      console.error("Error updating host credential:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento credenziale" }, { status: 500 });
    }
  });
}
