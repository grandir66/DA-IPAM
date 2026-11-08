import { NextResponse } from "next/server";
import { requireSuperAdmin, isAuthError } from "@/lib/api-auth";
import { isTecnico } from "@/lib/profilo";
import { elencoProfili } from "@/lib/profili/elenco";

/**
 * Profili cliente dell'installazione «tecnico» (ADR 0037). Legge l'hub e un numero per
 * ogni DB di profilo, come la vista aggregata: non è un'operazione su un tenant solo, quindi
 * niente `withTenantFromSession`. Fuori dal tipo «tecnico» la rotta non esiste.
 */
export async function GET() {
  const sessione = await requireSuperAdmin();
  if (isAuthError(sessione)) return sessione;
  if (!isTecnico()) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  try {
    return NextResponse.json({ profili: elencoProfili() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Profili] elenco non letto:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Elenco dei profili non leggibile" }, { status: 500 });
  }
}
