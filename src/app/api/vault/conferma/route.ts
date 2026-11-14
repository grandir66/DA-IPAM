import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { confermaConSecondaVerifica, confermaValida, utenteDaSessione } from "@/lib/vault/mostra";

const Corpo = z.object({ codice: z.string().min(1).max(20), scopo: z.enum(["password", "backup"]).optional() });

/** «Mostra password»: conferma con la verifica in due passaggi dell'utente collegato, valida 5 minuti (D2, ADR 0023). */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Manca il codice" }, { status: 400 });
    const e = confermaConSecondaVerifica({ utente: utenteDaSessione(s), codice: parsed.data.codice, scopo: parsed.data.scopo });
    if (!e.ok) return NextResponse.json({ error: e.errore }, { status: e.stato });
    return NextResponse.json({ scade: new Date(e.scade).toISOString() }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** La conferma dell'utente collegato vale ancora? Serve al dialogo dello scarico del database per non richiedere il codice due volte. */
export async function GET() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  const scade = confermaValida(utenteDaSessione(s).id);
  return NextResponse.json({ scade: scade ? new Date(scade).toISOString() : null }, { headers: { "Cache-Control": "no-store" } });
}
