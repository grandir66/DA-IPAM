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
export async function withTenantFromSession<T>(
  fn: () => T | Promise<T>
): Promise<T | NextResponse> {
  const session = (await auth()) as TenantSession | null;
  if (!session?.user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  let tenantCode = session.user.tenantCode;
  // __ALL__ for superadmin: fallback to DEFAULT for single-tenant operations
  if (!tenantCode || tenantCode === "__ALL__") {
    tenantCode = "DEFAULT";
  }
  return withTenant(tenantCode, () => fn());
}

// Re-export for convenience
export { queryAllTenants };
