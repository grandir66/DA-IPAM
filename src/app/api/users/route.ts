import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { createUserAs, listUsersAs } from "@/lib/users/service";
import { confermaPerOperazione } from "@/lib/users/conferma";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/**
 * Utenti (UI-18): il superadmin gestisce tutti, l'admin solo gli utenti dei
 * clienti che amministra, il viewer niente. Le regole stanno nel servizio
 * `@/lib/users/service` (prove in `src/lib/users/__tests__/`).
 */
export async function GET() {
  try {
    const session = await requireAdmin();
    if (isAuthError(session)) return session;

    const result = listUsersAs(session);
    return NextResponse.json(result.body, { status: result.status, headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Errore caricamento utenti:", error);
    return NextResponse.json(
      { error: "Errore nel caricamento degli utenti" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    if (isAuthError(session)) return session;

    const ferma = await confermaPerOperazione(session, request, "crea");
    if (ferma) return NextResponse.json(ferma.body, { status: ferma.status, headers: { "Cache-Control": "no-store" } });
    const result = await createUserAs(session, request);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Errore creazione utente:", error);
    return NextResponse.json(
      { error: "Errore nella creazione dell'utente" },
      { status: 500 }
    );
  }
}
