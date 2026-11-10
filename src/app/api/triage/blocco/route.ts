import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setTriageRilieviBlocco } from "@/lib/db-tenant";
import { STATI_TRIAGE } from "@/lib/triage/db";

const Corpo = z.object({
  chiavi: z.array(z.string().min(1).max(200)).min(1).max(1000),
  stato: z.enum(STATI_TRIAGE),
});

/** Imposta lo stesso stato su più rilievi in blocco (la nota di ciascuno resta). Operatore in su. */
export async function POST(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const letto = Corpo.safeParse(corpo);
  if (!letto.success) {
    return NextResponse.json({ error: letto.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
  }
  const utente = sessione.user.name ?? sessione.user.email ?? null;
  const chiavi = Array.from(new Set(letto.data.chiavi));
  return withTenantFromSession(() => {
    try {
      setTriageRilieviBlocco(chiavi, letto.data.stato, utente);
      return NextResponse.json({ ok: true, aggiornati: chiavi.length });
    } catch (e) {
      console.error("[triage] scrittura in blocco:", e);
      return NextResponse.json({ error: "Errore nel salvataggio del triage in blocco" }, { status: 500 });
    }
  });
}
