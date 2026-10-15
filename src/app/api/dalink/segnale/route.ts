import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { leggiConfigDalink } from "@/lib/dalink/config";
import { inviaAdesso } from "@/lib/dalink/segnale-job";

/**
 * «Invia adesso» dalla pagina «Cosa esce» (tappa C1). Un giro come quello del timer,
 * mai due insieme. Senza configurazione DA-Link non parte niente e lo si dice.
 */
export async function POST() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  if (leggiConfigDalink().stato === "assente") {
    return NextResponse.json(
      { error: "DA-Link non è configurato su questa istanza: non parte niente" },
      { status: 409 },
    );
  }
  try {
    const esito = await inviaAdesso();
    return NextResponse.json(esito);
  } catch {
    return NextResponse.json({ error: "Invio non riuscito" }, { status: 500 });
  }
}
