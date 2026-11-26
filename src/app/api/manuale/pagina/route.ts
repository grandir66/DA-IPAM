import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { guidaDelPercorso } from "@/lib/manuale/formato";
import { elencoGuide } from "@/lib/manuale/pagine";

export const dynamic = "force-dynamic";

/** La guida della pagina aperta (pulsante «?»): `?percorso=/devices/42`. Senza guida risponde `{ guida: null }`. */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const percorso = new URL(request.url).searchParams.get("percorso") ?? "/";
  if (!percorso.startsWith("/") || percorso.length > 300) {
    return NextResponse.json({ error: "Percorso non valido" }, { status: 400 });
  }
  const g = guidaDelPercorso(await elencoGuide(), percorso);
  if (!g) return NextResponse.json({ guida: null });
  return NextResponse.json({
    guida: { nome: g.nome, titolo: g.titolo, versione: g.versione, aggiornata: g.aggiornata, testo: g.testo },
  });
}
