import { NextResponse } from "next/server";
import { getCredentialById, updateCredential, deleteCredential } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { encrypt, decrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const credential = getCredentialById(Number(id));
      if (!credential) {
        return NextResponse.json({ error: "Credenziale non trovata" }, { status: 404 });
      }
      const url = new URL(request.url);
      const forEdit = url.searchParams.get("for_edit") === "1";
      let username: string | null = null;
      if (forEdit && credential.encrypted_username) {
        try {
          username = decrypt(credential.encrypted_username);
        } catch { /* ignore */ }
      }
      return NextResponse.json({
        ...credential,
        encrypted_username: credential.encrypted_username ? "●●●●●●●●" : null,
        encrypted_password: credential.encrypted_password ? "●●●●●●●●" : null,
        ...(username != null ? { username } : {}),
      });
    } catch (error) {
      console.error("Error fetching credential:", error);
      return NextResponse.json({ error: "Errore nel recupero della credenziale" }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const body = await request.json();
      const parsed = CredentialSchema.partial().safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }

      const data = parsed.data;
      const updates: Record<string, unknown> = {};
      if (data.name !== undefined) updates.name = data.name;
      if (data.credential_type !== undefined) updates.credential_type = data.credential_type;
      if (data.username !== undefined) updates.encrypted_username = data.username ? encrypt(data.username) : null;
      if (data.password !== undefined) updates.encrypted_password = data.password ? encrypt(data.password) : null;

      const credential = updateCredential(Number(id), updates);
      if (!credential) {
        return NextResponse.json({ error: "Credenziale non trovata" }, { status: 404 });
      }

      return NextResponse.json({
        ...credential,
        encrypted_username: credential.encrypted_username ? "●●●●●●●●" : null,
        encrypted_password: credential.encrypted_password ? "●●●●●●●●" : null,
      });
    } catch (error) {
      console.error("Error updating credential:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
    }
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const deleted = deleteCredential(Number(id));
      if (!deleted) {
        return NextResponse.json({ error: "Credenziale non trovata" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting credential:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
    }
  });
}
