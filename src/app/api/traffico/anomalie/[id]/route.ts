import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { segnaAnomalia } from "@/lib/traffico/anomalie";
import { dbTraffico } from "@/lib/traffico/lettura";

const Cambio = z.object({ stato: z.enum(["vista", "normale"]) });

/**
 * PATCH /api/traffico/anomalie/[id] — `{ stato: "vista" | "normale" }`. «normale» conferma anche
 * l'abitudine: l'avviso non torna. Solo un amministratore: DA-IPAM non ha una guardia «operatore».
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const id = Number((await params).id);
    const dati = Cambio.safeParse(await readJson(req));
    if (!dati.success) return NextResponse.json({ error: "Stato non valido: «vista» o «normale»" }, { status: 400 });
    if (!Number.isInteger(id) || id <= 0 || !segnaAnomalia(dbTraffico(), id, dati.data.stato)) {
      return NextResponse.json({ error: "Anomalia non trovata" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  });
}
