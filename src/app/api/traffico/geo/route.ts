import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { scaricaGeo, statoGeo } from "@/lib/traffico/geo";

/** GET /api/traffico/geo — lo stato dell'archivio di paesi e fornitori (DB-IP Lite): mese, quando è stato scaricato. */
export async function GET() {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return NextResponse.json(statoGeo(), { headers: NO_STORE });
}

/** POST /api/traffico/geo — scarica l'archivio del mese e lo sostituisce al vecchio. La richiesta non porta
 * nessun dato dell'installazione: si scarica il file intero e si cerca in locale. */
export async function POST() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  try {
    return NextResponse.json(await scaricaGeo(), { headers: NO_STORE });
  } catch (e) {
    console.error("[traffico] archivio dei paesi:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Archivio non scaricato: l'installazione raggiunge download.db-ip.com?" }, { status: 502 });
  }
}
