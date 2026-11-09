import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { avviaGiro } from "@/lib/servizi-rete/giro";

const Corpo = z.object({ network_id: z.number().int().positive().nullable().optional() });

/** Avvia il giro delle sonde senza credenziali (banner, HTTP, TLS, SSH) sulle porte già trovate. */
export async function POST(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  let corpo: unknown = {};
  try {
    corpo = await request.json();
  } catch {
    corpo = {};
  }
  const letto = Corpo.safeParse(corpo);
  if (!letto.success) {
    return NextResponse.json({ error: letto.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    const tenant = getCurrentTenantCode();
    if (!tenant) return NextResponse.json({ error: "Nessun tenant scelto" }, { status: 400 });
    const avviato = avviaGiro(tenant, letto.data.network_id ?? null);
    if (!avviato) return NextResponse.json({ error: "Un giro è già in corso" }, { status: 409 });
    return NextResponse.json({ avviato: true });
  });
}
