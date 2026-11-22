import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { andamentoTraffico } from "@/lib/traffico/insieme";
import { ipValido } from "@/lib/traffico/sonde";

const CHIAVE_RETE = /^(\d{1,9}|esterno|diffusione|nessuna)$/;

/** GET /api/traffico/andamento?rete=&host= — il volume delle ultime 24 ore, un punto per ora (UTC):
 * tutta la rete, una rete, oppure un host. */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const q = new URL(req.url).searchParams;
    const rete = q.get("rete") ?? "";
    const host = q.get("host") ?? "";
    if (rete && !CHIAVE_RETE.test(rete)) return NextResponse.json({ error: "Rete non valida" }, { status: 400 });
    if (host && !ipValido(host)) return NextResponse.json({ error: "Indirizzo non valido" }, { status: 400 });
    try {
      return NextResponse.json(andamentoTraffico({ rete: rete || undefined, host: host || undefined }), { headers: NO_STORE });
    } catch (e) {
      console.error("[traffico] andamento:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero dell'andamento" }, { status: 500 });
    }
  });
}
