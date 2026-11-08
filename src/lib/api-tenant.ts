import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenant, queryAllTenants } from "@/lib/db-tenant";
import { isTecnico } from "@/lib/profilo";

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
export async function getTenantMode(tecnico: boolean = isTecnico()): Promise<
  | { mode: "single"; tenantCode: string }
  | { mode: "all" }
  | { mode: "unauthenticated" }
> {
  const session = (await auth()) as TenantSession | null;
  if (!session?.user) return { mode: "unauthenticated" };
  const code = session.user.tenantCode;
  const role = session.user.role;
  return modoTenant(code, role, tecnico);
}

/**
 * La regola di `getTenantMode`, senza sessione (per le prove). Installazione «tecnico»
 * (ADR 0037): senza profilo scelto si vede l'aggregato in sola lettura, mai `DEFAULT`.
 */
export function modoTenant(
  code: string | null | undefined,
  role: string | undefined,
  tecnico: boolean,
): { mode: "single"; tenantCode: string } | { mode: "all" } {
  if (code === "__ALL__" && role === "superadmin") return { mode: "all" };
  if (!code && tecnico) return { mode: "all" };
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
  tecnico: boolean = isTecnico(),
): { ok: true; tenant: string } | { ok: false; motivo?: "nessuna" } {
  if (tenantCode === "__ALL__") return { ok: false };
  // Installazione «tecnico» (ADR 0037): più profili cliente, nessun ripiego muto su DEFAULT.
  if (!tenantCode && tecnico) return { ok: false, motivo: "nessuna" };
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
      {
        error: resolved.motivo === "nessuna"
          ? "Scegli un profilo cliente prima di questa operazione."
          : "Vista aggregata attiva: seleziona un tenant specifico per questa operazione.",
      },
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
export async function getServerTenantCode(tecnico: boolean = isTecnico()): Promise<string> {
  const session = (await auth()) as TenantSession | null;
  const code = session?.user?.tenantCode;
  if (!code || code === "__ALL__") {
    // Installazione «tecnico» (ADR 0037): niente pagina di un profilo senza profilo scelto.
    // Si va ai «Profili» (pagina client, non passa da qui: niente giri). Le rotte API che
    // usano questa funzione passano prima da `withTenantFromSession`, che risponde 409.
    if (tecnico) redirect("/tenants");
    return "DEFAULT";
  }
  return code;
}

// Re-export for convenience
export { queryAllTenants };
