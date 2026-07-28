import { NextResponse } from "next/server";
import { getAllCredentials, createCredential } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";
import { requireAdminOrOnboarding, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET() {
  return withTenantFromSession(async () => {
    try {
      const credentials = getAllCredentials();
      const masked = credentials.map((c) => ({
        ...c,
        encrypted_username: c.encrypted_username ? "●●●●●●●●" : null,
        encrypted_password: c.encrypted_password ? "●●●●●●●●" : null,
        // SNMPv3: le chiavi sono write-only, mai restituite (nemmeno mascherate
        // col valore reale) — solo un indicatore di presenza. auth_protocol/
        // priv_protocol/security_level non sono segreti: passano invariati,
        // servono alla UI per precompilare la select in modifica.
        encrypted_auth_key: c.encrypted_auth_key ? "●●●●●●●●" : null,
        encrypted_priv_key: c.encrypted_priv_key ? "●●●●●●●●" : null,
      }));
      // v0.2.642 audit perf UI7: cache client 60s + SWR 5min su credenziali
      // mascherate (sono read-mostly, mutate solo dalla UI Settings).
      return NextResponse.json(masked, {
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      });
    } catch (error) {
      console.error("Error fetching credentials:", error);
      return NextResponse.json({ error: "Errore nel recupero delle credenziali" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
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
        // v2c (community string) resta obbligatoria SOLO se non si sta
        // configurando SNMPv3 (security_level assente = credenziale v2c
        // legacy). Con security_level impostato la password non serve: le
        // combinazioni auth/priv incoerenti sono rifiutate da buildV3Options
        // al momento dell'uso, non qui (permette salvataggi incrementali).
        if (!data.security_level && !data.password?.trim()) {
          return NextResponse.json({ error: "Community string richiesta per credenziali SNMP v2c (oppure imposta security_level per SNMPv3)" }, { status: 400 });
        }
      }

      const credential = createCredential({
        name: data.name,
        credential_type: data.credential_type,
        encrypted_username: data.username ? encrypt(data.username) : null,
        encrypted_password: data.password ? encrypt(data.password) : null,
        encrypted_auth_key: data.auth_key ? encrypt(data.auth_key) : null,
        auth_protocol: data.auth_protocol ?? null,
        encrypted_priv_key: data.priv_key ? encrypt(data.priv_key) : null,
        priv_protocol: data.priv_protocol ?? null,
        security_level: data.security_level ?? null,
      });

      return NextResponse.json({
        ...credential,
        encrypted_username: credential.encrypted_username ? "●●●●●●●●" : null,
        encrypted_password: credential.encrypted_password ? "●●●●●●●●" : null,
        encrypted_auth_key: credential.encrypted_auth_key ? "●●●●●●●●" : null,
        encrypted_priv_key: credential.encrypted_priv_key ? "●●●●●●●●" : null,
      }, { status: 201 });
    } catch (error) {
      console.error("Error creating credential:", error);
      return NextResponse.json({ error: "Errore nella creazione della credenziale" }, { status: 500 });
    }
  });
}
