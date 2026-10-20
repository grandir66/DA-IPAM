import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { rispostaIpPrecedenti, rispostaOGuasto } from "@/lib/hosts/pulizia-server";

/** Gli IP che il MAC dell'host ha avuto prima di quello attuale, dallo storico e dall'archivio (piano 2026-10-20, Task 4). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const { id } = await params;
    const r = rispostaOGuasto("IP precedenti", "Errore nella lettura degli IP precedenti", () => rispostaIpPrecedenti(id));
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
