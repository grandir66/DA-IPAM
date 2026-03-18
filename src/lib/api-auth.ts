import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

interface AuthSession {
  user: { name?: string | null; email?: string | null; role?: string };
}

/**
 * Richiede autenticazione. Ritorna la sessione o una Response 401.
 */
export async function requireAuth(): Promise<AuthSession | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  return session as AuthSession;
}

/**
 * Richiede ruolo admin. Ritorna la sessione o una Response 401/403.
 */
export async function requireAdmin(): Promise<AuthSession | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Accesso riservato agli amministratori" }, { status: 403 });
  }
  return session as AuthSession;
}

/**
 * Helper per controllare se il risultato è una Response (errore) o una sessione valida.
 */
export function isAuthError(result: AuthSession | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
