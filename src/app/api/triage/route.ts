import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTriageRilievi, getConteggiTriage, setTriageRilievo } from "@/lib/db-tenant";
import { STATI_TRIAGE } from "@/lib/triage/db";

/** Triage delle chiavi chieste (`?chiavi=CVE-…,nvt:…`) + i conteggi per stato del tenant. */
export async function GET(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    const grezzo = new URL(request.url).searchParams.get("chiavi") ?? "";
    const chiavi = grezzo.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 500);
    try {
      return NextResponse.json({ triage: getTriageRilievi(chiavi), conteggi: getConteggiTriage() });
    } catch (e) {
      console.error("[triage] lettura:", e);
      return NextResponse.json({ error: "Errore nel recupero del triage" }, { status: 500 });
    }
  });
}

const Corpo = z.object({
  chiave: z.string().min(1).max(200),
  stato: z.enum(STATI_TRIAGE),
  nota: z.string().max(4000).optional().default(""),
});

/** Scrive stato e nota di un rilievo. Chi può agire sui dati (operatore in su). */
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
  return withTenantFromSession(() => {
    try {
      setTriageRilievo(letto.data.chiave, letto.data.stato, letto.data.nota, utente);
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("[triage] scrittura:", e);
      return NextResponse.json({ error: "Errore nel salvataggio del triage" }, { status: 500 });
    }
  });
}
