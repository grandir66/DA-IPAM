import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { elencoAnomalie, STATI_ANOMALIA, TIPI_ANOMALIA, type StatoAnomalia, type TipoAnomalia } from "@/lib/traffico/anomalie";
import { dbTraffico } from "@/lib/traffico/lettura";

/** GET /api/traffico/anomalie?stato=&tipo=&pagina= — le anomalie del traffico, le più gravi e recenti prima. */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const q = new URL(req.url).searchParams;
    const stato = q.get("stato") ?? "";
    const tipo = q.get("tipo") ?? "";
    if (stato && !STATI_ANOMALIA.includes(stato as StatoAnomalia)) return NextResponse.json({ error: "Stato non valido" }, { status: 400 });
    if (tipo && !TIPI_ANOMALIA.includes(tipo as TipoAnomalia)) return NextResponse.json({ error: "Tipo non valido" }, { status: 400 });
    const pagina = Number(q.get("pagina") ?? 1);
    try {
      return NextResponse.json(
        elencoAnomalie(dbTraffico(), {
          stato: (stato || undefined) as StatoAnomalia | undefined,
          tipo: (tipo || undefined) as TipoAnomalia | undefined,
          pagina: Number.isFinite(pagina) ? pagina : 1,
        }),
        { headers: NO_STORE },
      );
    } catch (e) {
      console.error("[traffico] elenco anomalie:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero delle anomalie" }, { status: 500 });
    }
  });
}
