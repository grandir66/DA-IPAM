import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { getTenantDb } from "@/lib/db-tenant";
import { contaDaVedere, segnaVisti } from "@/lib/cambiamenti/elenco";

/** Il numero accanto ad «Apparati» nel menù: cambiamenti degli ultimi 7 giorni da vedere, rumore escluso. */
export async function GET() {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    const db = getTenantDb(await getServerTenantCode());
    return NextResponse.json({ daVedere: contaDaVedere(db) });
  });
}

/** «Visto» su uno o più cambiamenti. */
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    let chiavi: unknown;
    try {
      chiavi = ((await req.json()) as { chiavi?: unknown }).chiavi;
    } catch {
      return NextResponse.json({ error: "Richiesta non leggibile" }, { status: 400 });
    }
    if (!Array.isArray(chiavi) || chiavi.length === 0 || chiavi.length > 2000 || chiavi.some((c) => typeof c !== "string")) {
      return NextResponse.json({ error: "Elenco dei cambiamenti non valido" }, { status: 400 });
    }
    const db = getTenantDb(await getServerTenantCode());
    const utente = session.user?.name ?? session.user?.email ?? null;
    return NextResponse.json({ segnati: segnaVisti(db, chiavi as string[], utente) });
  });
}
