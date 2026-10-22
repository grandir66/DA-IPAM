/**
 * Riquadro «Acquisizione modulare (anteprima)» della scheda (tavola C1, oggetti 1-13):
 * GET /api/devices/[id]/acquisizione?snapshot=<id>&pagina=<n> → interruttore, fonte ricavata (collector e NOMI delle
 * credenziali, mai segreti), lo snapshot in vista (l'ultimo, o quello chiesto) con le sezioni e le prime 5 righe, cosa ha
 * cambiato nell'apparato, e le ultime acquisizioni paginate (solo colonne piccole). Sola lettura, con la sessione.
 * L'acquisizione si lancia col pulsante di sempre (POST /api/devices/[id]/query). Logica in `riquadro-server.ts`.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { statoRiquadro } from "@/lib/acquisizione-modulare/riquadro-server";

type RouteParams = { params: Promise<{ id: string }> };

function intero(v: string | null, min: number): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : NaN;
}

export async function GET(request: Request, { params }: RouteParams) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  const url = new URL(request.url);
  const chiesto = intero(url.searchParams.get("snapshot"), 1);
  const pagina = intero(url.searchParams.get("pagina"), 1) ?? 1;
  if (Number.isNaN(chiesto) || Number.isNaN(pagina)) return NextResponse.json({ error: "Parametri non validi" }, { status: 400 });
  return withTenantFromSession(() => {
    const r = statoRiquadro(deviceId, chiesto, pagina);
    return NextResponse.json(r.body, { status: r.status });
  });
}
