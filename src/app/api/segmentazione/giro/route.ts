import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { avviaGiroSeg } from "@/lib/segmentazione/giro";

/** Avvia il giro della matrice: da ogni VLAN prova i servizi già noti delle altre reti. */
export async function POST() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    const tenant = getCurrentTenantCode();
    if (!tenant) return NextResponse.json({ error: "Nessun tenant scelto" }, { status: 400 });
    const avviato = avviaGiroSeg(tenant);
    if (!avviato) return NextResponse.json({ error: "Un giro è già in corso" }, { status: 409 });
    return NextResponse.json({ avviato: true });
  });
}
