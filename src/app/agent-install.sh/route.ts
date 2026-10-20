import { NextResponse } from "next/server";
import { MESSAGGIO_AGENTE_TOLTO } from "@/lib/agente-remoto-tolto";

/**
 * Installatore dell'agente Python remoto, tolto il 20/10/2026 (decisione 26 della spec
 * NetBird). Rotta pubblica e ferma (410) per un giro, come le altre dell'agente (perché in
 * `lib/agente-remoto-tolto.ts`): chi la usa ancora con `curl … | bash` riceve uno script
 * che dice cosa è successo ed esce con errore, invece di un JSON che bash non capisce.
 */
export async function GET() {
  const corpo = `#!/bin/sh\necho "${MESSAGGIO_AGENTE_TOLTO}" >&2\nexit 1\n`;
  return new NextResponse(corpo, {
    status: 410,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
