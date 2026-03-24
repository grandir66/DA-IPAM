import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isOnboardingCompleted } from "@/lib/db";

interface AuthSession {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    tenantCode?: string | null;
    tenants?: Array<{ code: string; name: string; role: string }>;
  };
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
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Richiesti privilegi di amministratore" }, { status: 403 });
  }
  return session as AuthSession;
}

/**
 * Richiede ruolo superadmin. Ritorna la sessione o una Response 401/403.
 */
export async function requireSuperAdmin(): Promise<AuthSession | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin") {
    return NextResponse.json({ error: "Richiesti privilegi di super amministratore" }, { status: 403 });
  }
  return session as AuthSession;
}

/**
 * Helper per ottenere il codice tenant dalla sessione corrente.
 */
export function getTenantCodeFromSession(session: AuthSession): string | null {
  return session.user?.tenantCode ?? null;
}

/**
 * Come requireAdmin, ma durante il wizard di prima configurazione (onboarding non completato)
 * accetta sessioni autenticate anche se il JWT non espone ancora `role: "admin"` (caso tipico dopo il login post-setup).
 * I viewer restano esclusi.
 */
export async function requireAdminOrOnboarding(): Promise<AuthSession | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role === "viewer") {
    return NextResponse.json({ error: "Accesso riservato agli amministratori" }, { status: 403 });
  }
  if (role === "admin" || role === "superadmin") {
    return session as AuthSession;
  }
  if (!isOnboardingCompleted()) {
    return session as AuthSession;
  }
  return NextResponse.json({ error: "Accesso riservato agli amministratori" }, { status: 403 });
}

/**
 * Helper per controllare se il risultato è una Response (errore) o una sessione valida.
 */
export function isAuthError(result: AuthSession | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
