import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";
import { salvaDisposizione } from "@/lib/cliente/casa";

/**
 * PUT /api/vista-cliente/casa — salva la disposizione della casa della vista cliente per il
 * cliente in sessione. Solo amministratori: l'utente Cliente è in sola lettura, e il recinto
 * gli vieta comunque ogni rotta `/api`. Corpo: `{ voci: [{ id, misura, visibile }] }`.
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
      return NextResponse.json({ voci: salvaDisposizione(getDb(), voci) });
    } catch (error) {
      console.error("[vista-cliente] casa:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Disposizione non salvata" }, { status: 500 });
    }
  });
}
