/**
 * Scheda MikroTik, utenti del router (22/10, Task 10): GET /api/devices/[id]/mikrotik-utenti → { utenti, letto_il }.
 * SOLO admin: nomi, gruppi e indirizzi ammessi sono un dato riservato (nessuna password: il lettore non la legge).
 * 404 apparato assente, 400 se non è un MikroTik.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rispostaUtentiMikrotik } from "@/lib/devices/scheda-mikrotik-rotta";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const authCheck = await requireAdmin();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    const r = rispostaUtentiMikrotik(deviceId);
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  });
}
