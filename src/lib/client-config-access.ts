import { NextResponse } from "next/server";

type Sess = { user: { role?: string; tenantCode?: string | null } };

/**
 * G1 — la config cliente è per-tenant (chiave = codice tenant, storage FS globale).
 * Predicato PURO: true se la sessione può accedere alla config del `code` dato.
 * Superadmin → qualsiasi codice; altri → solo il proprio tenant (mai `__ALL__`).
 */
export function canAccessClientConfig(session: Sess, code: string): boolean {
  if (session.user.role === "superadmin") return true;
  const tenantCode = session.user.tenantCode ?? null;
  return !!tenantCode && tenantCode !== "__ALL__" && code === tenantCode;
}

export function isSuperadmin(session: Sess): boolean {
  return session.user.role === "superadmin";
}

/** Wrapper per le route: ritorna 403 se l'accesso è negato, altrimenti null. */
export function denyCrossTenantConfig(session: Sess, code: string): NextResponse | null {
  return canAccessClientConfig(session, code)
    ? null
    : NextResponse.json({ error: "Accesso negato: configurazione di un altro cliente" }, { status: 403 });
}
