import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { avviaAzzeramento, statoAzzeramento } from "@/lib/azzeramento-appliance";

/**
 * GET — l'appliance sa azzerarsi? (e il nome da scrivere per confermare).
 * POST { conferma } — avvia `da-appliance azzera --spegni` (src/lib/azzeramento-appliance.ts):
 * via cliente, voci, database e password; la VM si spegne, pronta per il comando di DA-Link.
 */
export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return NextResponse.json(statoAzzeramento());
}

const Corpo = z.object({ conferma: z.string().max(80) });

export async function POST(request: NextRequest) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
  }
  const letto = Corpo.safeParse(corpo);
  if (!letto.success) {
    return NextResponse.json({ error: letto.error.issues[0]?.message ?? "Conferma mancante" }, { status: 400 });
  }
  const esito = await avviaAzzeramento(letto.data.conferma);
  if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.stato });
  return NextResponse.json({
    success: true,
    message: "Azzeramento avviato: fra qualche minuto l'appliance si spegne, pronta da riconfigurare con il comando di DA-Link.",
  });
}
