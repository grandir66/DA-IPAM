/**
 * Pagina Scansioni VA: GET legge profili e reti dalla sonda; POST lancia o salva su più reti.
 * Come il pannello VA Scan: leggere basta la sessione, lanciare e salvare chiedono l'amministratore.
 */
import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { lanciaSuReti, lancioSchema, leggiQuadroScansioni } from "@/lib/vuln/scansioni-va";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => NextResponse.json(await leggiQuadroScansioni()));
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = lancioSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Body JSON non valido", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const esito = await lanciaSuReti(parsed.data, adminCheck.user.name || adminCheck.user.email || `utente ${adminCheck.user.id ?? "?"}`);
    if (!esito.ok) return NextResponse.json({ ok: false, error: esito.error }, { status: esito.status });
    return NextResponse.json(esito);
  });
}
