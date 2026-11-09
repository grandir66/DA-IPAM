import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getProveCellaMatrice } from "@/lib/db-tenant";

/** Elenco delle prove di una cella rete × rete. */
export async function GET(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  const sp = new URL(request.url).searchParams;
  const a = Number(sp.get("sorgente"));
  const b = Number(sp.get("bersaglio"));
  if (!Number.isInteger(a) || a <= 0 || !Number.isInteger(b) || b <= 0) {
    return NextResponse.json({ error: "Cella non valida" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    try {
      return NextResponse.json({ righe: getProveCellaMatrice(a, b) });
    } catch (e) {
      console.error("[segmentazione] cella:", e);
      return NextResponse.json({ error: "Errore nel recupero della cella" }, { status: 500 });
    }
  });
}
