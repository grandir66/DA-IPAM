import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenant, queryAllTenants } from "@/lib/db-tenant";

interface TenantSession {
  user: {
    name?: string | null;
    role?: string;
    tenantCode?: string | null;
  };
}

/**
 * Determina la modalità tenant dalla sessione.
 */
export async function getTenantMode(): Promise<
  | { mode: "single"; tenantCode: string }
  | { mode: "all" }
  | { mode: "unauthenticated" }
> {
  const session = (await auth()) as TenantSession | null;
  if (!session?.user) return { mode: "unauthenticated" };
  const code = session.user.tenantCode;
  const role = session.user.role;
  if (code === "__ALL__" && role === "superadmin") return { mode: "all" };
  return { mode: "single", tenantCode: code || "DEFAULT" };
}

/**
 * Esegue una funzione nel contesto del tenant corrente (da sessione JWT).
 * Ritorna NextResponse di errore se non autenticato o nessun tenant selezionato.
 */
/**
 * Risolve il tenant per un'operazione tenant-scoped (H2).
 * `__ALL__` (vista aggregata superadmin) NON è ammesso: le viste aggregate usano
 * `queryAllTenants` e non arrivano qui; ogni operazione su un singolo DB tenant
 * richiede un tenant esplicito. Assenza di tenant (single-tenant/legacy) → DEFAULT.
 */
export function resolveSessionTenant(
  tenantCode: string | null | undefined,
): { ok: true; tenant: string } | { ok: false } {
  if (tenantCode === "__ALL__") return { ok: false };
  return { ok: true, tenant: tenantCode || "DEFAULT" };
}

export async function withTenantFromSession<T>(
  fn: () => T | Promise<T>
): Promise<T | NextResponse> {
  const session = (await auth()) as TenantSession | null;
  if (!session?.user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  const resolved = resolveSessionTenant(session.user.tenantCode);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "Vista aggregata attiva: seleziona un tenant specifico per questa operazione." },
      { status: 409 },
    );
  }
  return withTenant(resolved.tenant, () => fn());
}

/**
 * Helper per Server Components: legge il tenantCode dalla sessione JWT.
 * Restituisce il codice tenant da usare con withTenant().
 * Se superadmin con __ALL__ o nessun tenant, fallback a DEFAULT.
 */
export async function getServerTenantCode(): Promise<string> {
  const session = (await auth()) as TenantSession | null;
  const code = session?.user?.tenantCode;
  if (!code || code === "__ALL__") return "DEFAULT";
  return code;
}

// Re-export for convenience
export { queryAllTenants };
