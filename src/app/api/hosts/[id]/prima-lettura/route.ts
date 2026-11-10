/**
 * GET /api/hosts/[id]/prima-lettura — OS, dominio, servizi e chiavi già in archivio.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getPrimaLetturaHost } from "@/lib/db-tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(async () => {
    const { id } = await params;
    const hostId = Number(id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "Host non valido" }, { status: 400 });
    }
    try {
      const dati = getPrimaLetturaHost(hostId);
      if (!dati) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
      return NextResponse.json(dati);
    } catch (e) {
      console.error("[api/hosts/prima-lettura]", e);
      return NextResponse.json({ error: "Errore nella prima lettura dell'host" }, { status: 500 });
    }
  });
}
