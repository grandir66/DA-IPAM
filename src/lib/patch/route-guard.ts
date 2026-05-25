/**
 * Patch Management — Route guard combinato.
 *
 * Verifica in ordine:
 *   1. Autenticazione (requireAuth) → 401 se manca
 *   2. Tenant context (getCurrentTenantCode) → 500 se manca
 *   3. Feature flag patch_management → 404 se OFF (modulo non installato)
 *
 * Va chiamato DENTRO `withTenantFromSession(async () => { ... })`, perché
 * dipende dall'AsyncLocalStorage del tenant per leggere `tenant_features`
 * dall'hub. Per mutazioni (POST/PUT/DELETE) il caller deve aggiungere il
 * proprio `requireAdmin()` esplicito.
 *
 * Pattern d'uso (vedi src/app/api/patch/...):
 *
 *   return withTenantFromSession(async () => {
 *     const guard = await patchModuleGuard();
 *     if (isAuthError(guard)) return guard;
 *     // ... handler logic
 *   });
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { isPatchEnabled } from "./feature";

/**
 * Ritorna la sessione (oggetto user) se OK, oppure NextResponse di errore.
 * Il caller deve fare `isAuthError(result)` per discriminare.
 */
export async function patchModuleGuard(): Promise<
  Awaited<ReturnType<typeof requireAuth>>
> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) {
    return NextResponse.json(
      { error: "Tenant context non disponibile" },
      { status: 500 }
    );
  }

  const enabled = await isPatchEnabled(tenantCode);
  if (!enabled) {
    return NextResponse.json(
      { error: "Modulo patch_management non installato" },
      { status: 404 }
    );
  }

  return auth;
}

/**
 * Helper per estrarre lo userId numerico dalla sessione.
 * In auth.ts: `id: String(user.id)`. Se assente/non valido ritorna null.
 */
export function userIdFromSession(
  session: Awaited<ReturnType<typeof requireAuth>>
): number | null {
  if (session instanceof NextResponse) return null;
  const raw = (session.user as { id?: string }).id;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
