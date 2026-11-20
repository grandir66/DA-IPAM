import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { elencoAnomalie, STATI_ANOMALIA, TIPI_ANOMALIA, type StatoAnomalia, type TipoAnomalia } from "@/lib/traffico/anomalie";
import { dbTraffico } from "@/lib/traffico/lettura";
import { nomiDegliIp, quadroTraffico } from "@/lib/traffico/quadro";

/** GET /api/traffico/anomalie?stato=&tipo=&gravita=&pagina= — le anomalie del traffico, le più gravi e recenti prima,
 * coi nomi degli host della pagina e il quadro (collector, reti in apprendimento, quante aspettano). */
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
    const gravita = Number(q.get("gravita") ?? 0);
    if (![0, 1, 2, 3].includes(gravita)) return NextResponse.json({ error: "Gravità non valida" }, { status: 400 });
    try {
      const elenco = elencoAnomalie(dbTraffico(), {
        stato: (stato || undefined) as StatoAnomalia | undefined,
        tipo: (tipo || undefined) as TipoAnomalia | undefined,
        gravita: gravita || undefined,
        pagina: Number.isFinite(pagina) ? pagina : 1,
      });
      return NextResponse.json(
        { ...elenco, nomi: nomiDegliIp(elenco.anomalie.flatMap((a) => [a.client, a.server])), quadro: quadroTraffico() },
        { headers: NO_STORE },
      );
    } catch (e) {
      console.error("[traffico] elenco anomalie:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero delle anomalie" }, { status: 500 });
    }
  });
}
