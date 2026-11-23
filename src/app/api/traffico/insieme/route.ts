import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { insiemeTraffico, PERIODI, VISTE, type Vista } from "@/lib/traffico/insieme";

const CHIAVE_RETE = /^(\d{1,9}|esterno|diffusione|nessuna|o:\d{1,3}(\.\d{1,3}){3}\/\d{1,2})$/;

/** GET /api/traffico/insieme?giorni=&vista=&rete=&da=&a=&cerca=&pagina= — il traffico sulla rete intera:
 * fra reti, per host o per coppia, coi numeri del periodo e i nomi più chiesti. */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const q = new URL(req.url).searchParams;
    const vista = q.get("vista") ?? "reti";
    const giorni = Number(q.get("giorni") ?? 1);
    const pagina = Number(q.get("pagina") ?? 1);
    if (!VISTE.includes(vista as Vista)) return NextResponse.json({ error: "Vista non valida" }, { status: 400 });
    if (!(PERIODI as readonly number[]).includes(giorni)) return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });
    const reti: Record<string, string | undefined> = {};
    for (const k of ["rete", "da", "a"]) {
      const v = q.get(k) ?? "";
      if (v && !CHIAVE_RETE.test(v)) return NextResponse.json({ error: "Rete non valida" }, { status: 400 });
      reti[k] = v || undefined;
    }
    try {
      return NextResponse.json(
        insiemeTraffico({
          vista: vista as Vista, giorni, pagina: Number.isFinite(pagina) ? pagina : 1,
          rete: reti.rete, da: reti.da, a: reti.a, cerca: (q.get("cerca") ?? "").slice(0, 80),
        }),
        { headers: NO_STORE },
      );
    } catch (e) {
      console.error("[traffico] vista d'insieme:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero del traffico" }, { status: 500 });
    }
  });
}
