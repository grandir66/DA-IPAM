import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { esternoTraffico, PER, type Per } from "@/lib/traffico/esterno";

const PERIODI = [1, 7, 30];

/** GET /api/traffico/esterno?giorni=&per=&pagina=&cerca= — con chi fuori parlano gli host: per destinazione,
 * paese, fornitore o host. Paese e fornitore vengono dall'archivio locale, mai da una richiesta fuori. */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const q = new URL(req.url).searchParams;
    const giorni = Number(q.get("giorni") ?? 1);
    const per = q.get("per") ?? "destinazione";
    const pagina = Number(q.get("pagina") ?? 1);
    if (!PERIODI.includes(giorni)) return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });
    if (!(PER as readonly string[]).includes(per)) return NextResponse.json({ error: "Vista non valida" }, { status: 400 });
    try {
      return NextResponse.json(
        esternoTraffico({ giorni, per: per as Per, pagina: Number.isFinite(pagina) ? pagina : 1, cerca: (q.get("cerca") ?? "").slice(0, 80) }),
        { headers: NO_STORE },
      );
    } catch (e) {
      console.error("[traffico] verso l'esterno:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero delle destinazioni esterne" }, { status: 500 });
    }
  });
}
