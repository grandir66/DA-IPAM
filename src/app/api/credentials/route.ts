import { NextResponse } from "next/server";
import { getAllCredentials, createCredential } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";
import { requireAuth, requireAdminOrOnboarding, isAuthError } from "@/lib/api-auth";

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const credentials = getAllCredentials();
    const masked = credentials.map((c) => ({
      ...c,
      encrypted_username: c.encrypted_username ? "●●●●●●●●" : null,
      encrypted_password: c.encrypted_password ? "●●●●●●●●" : null,
    }));
    return NextResponse.json(masked);
  } catch (error) {
    console.error("Error fetching credentials:", error);
    return NextResponse.json({ error: "Errore nel recupero delle credenziali" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdminOrOnboarding();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = CredentialSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;
    if (data.credential_type === "ssh" || data.credential_type === "api" || data.credential_type === "windows" || data.credential_type === "linux") {
      if (!data.username || !data.password) {
        return NextResponse.json({ error: "Username e password richiesti" }, { status: 400 });
      }
    }
    if (data.credential_type === "snmp") {
      if (!data.password?.trim()) {
        return NextResponse.json({ error: "Community string richiesta per credenziali SNMP" }, { status: 400 });
      }
    }

    const credential = createCredential({
      name: data.name,
      credential_type: data.credential_type,
      encrypted_username: data.username ? encrypt(data.username) : null,
      encrypted_password: data.password ? encrypt(data.password) : null,
    });

    return NextResponse.json({
      ...credential,
      encrypted_username: credential.encrypted_username ? "●●●●●●●●" : null,
      encrypted_password: credential.encrypted_password ? "●●●●●●●●" : null,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating credential:", error);
    return NextResponse.json({ error: "Errore nella creazione della credenziale" }, { status: 500 });
  }
}
