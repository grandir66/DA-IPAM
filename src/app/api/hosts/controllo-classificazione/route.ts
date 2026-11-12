import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { leggiControllo, ricalcolaTutto } from "@/lib/classification/controllo-db";
import { scriviClassificazione } from "@/lib/classification/scrivi";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

/**
 * GET /api/hosts/controllo-classificazione — la classe scritta contro la migliore possibile: un rilievo per riga,
 * con la proposta e il motivo. Sola lettura.
 */
export async function GET() {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    try {
      return NextResponse.json(leggiControllo(getDb()));
    } catch (error) {
      console.error("Error controllo della classificazione:", error);
      return NextResponse.json({ error: "Errore nel controllo della classificazione" }, { status: 500 });
    }
  });
}

const classi: readonly string[] = DEVICE_CLASSIFICATIONS;
const Richiesta = z.discriminatedUnion("azione", [
  z.object({
    azione: z.literal("applica"),
    voci: z.array(z.object({
      host_id: z.number().int().positive(),
      classe: z.string().refine((c) => classi.includes(c), { message: "Classe non in elenco" }),
    })).min(1, "Nessuna riga spuntata").max(2000),
  }),
  z.object({ azione: z.literal("ricalcola") }),
]);

/**
 * POST { azione: "applica", voci: [{ host_id, classe }] } — scrive le proposte spuntate come scelta di una persona
 * (il motore non le tocca più). POST { azione: "ricalcola" } — rilancia il motore di oggi su tutte le righe.
 * Solo amministratori.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const admin = await requireAdmin();
      if (isAuthError(admin)) return admin;
      const parsed = Richiesta.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
      }
      const db = getDb();
      if (parsed.data.azione === "ricalcola") {
        return NextResponse.json({ success: true, ...ricalcolaTutto(db) });
      }
      let scritte = 0;
      for (const v of parsed.data.voci) {
        if (scriviClassificazione(db, { hostId: v.host_id }, v.classe, { manuale: true }).hostId != null) scritte++;
      }
      return NextResponse.json({ success: true, scritte });
    } catch (error) {
      console.error("Error controllo della classificazione (scrittura):", error);
      return NextResponse.json({ error: "Errore nel salvataggio" }, { status: 500 });
    }
  });
}
