import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { quadroCosaEsce } from "@/lib/dalink/quadro";

/**
 * Quadro della pagina «Cosa esce da questa istanza» (tappa C1 NetBird/DA-Link).
 * Riservato agli amministratori dell'istanza (spec NetBird §5.3). Non contiene mai il
 * token di DA-Link. Non è legato al cliente della sessione: il segnale riguarda il
 * cliente scritto da DA-Link in /etc/dalink/oggetto.env, e `fatti.ts` apre il suo
 * contesto con `withTenant`.
 */
export async function GET() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  try {
    const quadro = await quadroCosaEsce();
    return NextResponse.json(quadro, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[dalink] quadro di Cosa esce non costruito:", error instanceof Error ? error.message : "errore");
    return NextResponse.json({ error: "Impossibile leggere cosa esce da questa istanza" }, { status: 500 });
  }
}
