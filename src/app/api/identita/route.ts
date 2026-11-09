import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getProposteIdentita, getConteggiIdentita, decidiPropostaIdentita, raccogliIdentita } from "@/lib/db-tenant";

/** Elenco delle proposte «stesso apparato» e i conteggi. */
export async function GET(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    const stato = new URL(request.url).searchParams.get("stato");
    const ok = stato === "confermato" || stato === "rifiutato" || stato === "proposto" ? stato : "proposto";
    try {
      return NextResponse.json({ righe: getProposteIdentita(ok), conteggi: getConteggiIdentita() });
    } catch (e) {
      console.error("[identita] elenco:", e);
      return NextResponse.json({ error: "Errore nel recupero delle proposte di identità" }, { status: 500 });
    }
  });
}

const Corpo = z.object({
  id: z.number().int().positive(),
  esito: z.enum(["confermato", "rifiutato"]),
});

/** Conferma o rifiuta una proposta. Solo admin; niente fusioni automatiche. */
export async function POST(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const letto = Corpo.safeParse(corpo);
  if (!letto.success) {
    return NextResponse.json({ error: letto.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
  }
  const utente = sessione.user?.name || sessione.user?.email || "admin";
  return withTenantFromSession(() => {
    const r = decidiPropostaIdentita(letto.data.id, letto.data.esito, utente);
    if (!r) return NextResponse.json({ error: "Proposta non trovata o già decisa" }, { status: 404 });
    return NextResponse.json(r);
  });
}

/** Raccoglie le prove dagli archivi e ricalcola le proposte. */
export async function PUT() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => NextResponse.json(raccogliIdentita()));
}
