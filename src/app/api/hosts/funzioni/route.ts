import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { funzioniPerHost, impostaFunzioneAMano } from "@/lib/classification/funzioni-db";
import { eFunzione } from "@/lib/classification/funzioni";

/**
 * GET /api/hosts/funzioni[?network_id=N] — le funzioni degli apparati, per host: `{ "<host_id>": [{ funzione,
 * origine, a_mano }] }`. Sola lettura; le liste le chiedono a parte per non appesantire le query degli host.
 */
export async function GET(request: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    try {
      const grezzo = new URL(request.url).searchParams.get("network_id");
      const rete = grezzo != null && /^\d+$/.test(grezzo) ? Number(grezzo) : undefined;
      return NextResponse.json(funzioniPerHost(getDb(), rete));
    } catch (error) {
      console.error("Error funzioni degli host:", error);
      return NextResponse.json({ error: "Errore nella lettura delle funzioni" }, { status: 500 });
    }
  });
}

const Scelta = z.object({
  host_ids: z.array(z.number().int().positive()).min(1, "Nessun host indicato").max(2000),
  funzione: z.string().refine(eFunzione, { message: "Funzione non in elenco" }),
  azione: z.enum(["metti", "togli", "automatica"]),
});

/**
 * POST /api/hosts/funzioni { host_ids, funzione, azione } — la scelta di una persona su una funzione, per uno o più
 * host: `metti`, `togli`, o `automatica` (torna a decidere il sistema). Solo amministratori.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const admin = await requireAdmin();
      if (isAuthError(admin)) return admin;
      const parsed = Scelta.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
      }
      const { host_ids, funzione, azione } = parsed.data;
      if (!eFunzione(funzione)) return NextResponse.json({ error: "Funzione non in elenco" }, { status: 400 });
      const toccate = impostaFunzioneAMano(getDb(), host_ids, funzione, azione);
      return NextResponse.json({ success: true, toccate });
    } catch (error) {
      console.error("Error scelta della funzione:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della funzione" }, { status: 500 });
    }
  });
}
