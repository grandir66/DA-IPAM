import { NextResponse } from "next/server";
import { getCredentialById, updateCredential, deleteCredential } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { safeDecrypt } from "@/lib/crypto";
import { aggiornamentiCredenziale } from "@/lib/credentials/aggiornamenti";
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
      // for_edit=1 decifra i dati: solo admin. La lettura mascherata resta ai viewer.
      if (forEdit) {
        const adminCheck = await requireAdmin();
        if (isAuthError(adminCheck)) return adminCheck;
      }
      let username: string | null = null;
      if (forEdit && credential.encrypted_username) {
        username = safeDecrypt(credential.encrypted_username);
      }
      return NextResponse.json({
        ...credential,
        encrypted_username: credential.encrypted_username ? "●●●●●●●●" : null,
        encrypted_password: credential.encrypted_password ? "●●●●●●●●" : null,
        // SNMPv3: write-only, MAI decifrate qui — nemmeno con for_edit=1 (a
        // differenza di username, che serve precompilato in modifica). Solo
        // un indicatore booleano di presenza per la UI ("chiave già impostata").
        encrypted_auth_key: credential.encrypted_auth_key ? "●●●●●●●●" : null,
        encrypted_priv_key: credential.encrypted_priv_key ? "●●●●●●●●" : null,
        encrypted_private_key: credential.encrypted_private_key ? "●●●●●●●●" : null,
        encrypted_key_passphrase: credential.encrypted_key_passphrase ? "●●●●●●●●" : null,
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

      // Segreti vuoti o assenti = non modificare (tappa 1): prima `password: ""`
      // cancellava il segreto. Dettaglio in src/lib/credentials/aggiornamenti.ts.
      const updates = aggiornamentiCredenziale(parsed.data, body);

      const credential = updateCredential(Number(id), updates);
      if (!credential) {
        return NextResponse.json({ error: "Credenziale non trovata" }, { status: 404 });
      }

      return NextResponse.json({
        ...credential,
        encrypted_username: credential.encrypted_username ? "●●●●●●●●" : null,
        encrypted_password: credential.encrypted_password ? "●●●●●●●●" : null,
        encrypted_auth_key: credential.encrypted_auth_key ? "●●●●●●●●" : null,
        encrypted_priv_key: credential.encrypted_priv_key ? "●●●●●●●●" : null,
        encrypted_private_key: credential.encrypted_private_key ? "●●●●●●●●" : null,
        encrypted_key_passphrase: credential.encrypted_key_passphrase ? "●●●●●●●●" : null,
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
