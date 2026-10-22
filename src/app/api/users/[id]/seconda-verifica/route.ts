import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { secondaVerificaAs } from "@/lib/users/service";

/**
 * Verifica in due passaggi di un utente: richiedi, azzera, togli (Riccardo, 20/10; ADR 0023).
 * Regole e registro nel servizio `@/lib/users/service` (come «Reimposta password»).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    if (isAuthError(session)) return session;

    const { id } = await params;
    const result = await secondaVerificaAs(session, id, request);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Errore verifica in due passaggi:", error);
    return NextResponse.json({ error: "Errore nella verifica in due passaggi" }, { status: 500 });
  }
}
