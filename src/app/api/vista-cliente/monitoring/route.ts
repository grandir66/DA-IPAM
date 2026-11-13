import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";
import { salvaDisposizione } from "@/lib/cliente/casa";
import { CHIAVE_MONITORING, RIQUADRI_MONITORING } from "@/lib/cliente/monitoring-riquadri";

/**
 * PUT /api/vista-cliente/monitoring — salva la disposizione della pagina DATIA MONITORING del cliente in
 * sessione (13/11/2026). Solo amministratori, come la casa. Corpo: `{ voci: [{ id, l, a, visibile }] }`.
 */
export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    let corpo: unknown;
    try {
      corpo = await req.json();
    } catch {
      return NextResponse.json({ error: "Richiesta non leggibile" }, { status: 400 });
    }
    const voci = (corpo as { voci?: unknown } | null)?.voci;
    if (!Array.isArray(voci)) return NextResponse.json({ error: "Manca l'elenco dei riquadri" }, { status: 400 });
    try {
      return NextResponse.json({ voci: salvaDisposizione(getDb(), voci, CHIAVE_MONITORING, RIQUADRI_MONITORING) });
    } catch (error) {
      console.error("[vista-cliente] monitoring:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Disposizione non salvata" }, { status: 500 });
    }
  });
}
