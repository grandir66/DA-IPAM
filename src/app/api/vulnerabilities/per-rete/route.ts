/**
 * GET /api/vulnerabilities/per-rete
 *
 * Rilievi per rete e gravità (09/11/2026, dall'Overview di Nety): alimenta le barre «rilievi per
 * rete» in testata della pagina Vulnerabilità. Stessa deduplica della vista per host.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { barreReteDiSerie } from "@/lib/rilievi/barre-di-serie";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(() => {
    try {
      return NextResponse.json({ reti: barreReteDiSerie() });
    } catch (e) {
      console.error("[vulnerabilita] rilievi per rete:", e);
      return NextResponse.json({ error: "Errore nel conteggio dei rilievi per rete" }, { status: 500 });
    }
  });
}
