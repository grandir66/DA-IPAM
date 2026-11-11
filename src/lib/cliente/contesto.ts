import { cache } from "react";
import { redirect } from "next/navigation";
import type Database from "better-sqlite3";
import { auth } from "@/lib/auth";
import { getServerTenantCode } from "@/lib/api-tenant";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { resolveModules, type ModuleState } from "@/lib/modules/registry";

export interface ContestoCliente {
  tenantCode: string;
  /** Nome del cliente in sessione; se manca, il codice. */
  nomeCliente: string;
  moduli: ModuleState[];
  ora: Date;
  /** Ruolo admin o superadmin: vede «Torna alla Dashboard». */
  amministratore: boolean;
}

/**
 * Sessione → cliente → moduli. Senza sessione: redirect("/login").
 * Una sola lettura per richiesta (layout e casa la chiamano entrambi).
 */
const leggiContestoCliente = cache(async function leggiContestoCliente(): Promise<ContestoCliente> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenantCode = await getServerTenantCode();
  const tenants = (session.user as { tenants?: Array<{ code: string; name: string }> }).tenants ?? [];
  const nomeCliente = tenants.find((t) => t.code === tenantCode)?.name ?? tenantCode;
  const ruolo = (session.user as { role?: string }).role;
  let moduli: ModuleState[] = [];
  try {
    moduli = await withTenant(tenantCode, () => resolveModules(tenantCode, ruolo));
  } catch (e) {
    console.error("[cliente] moduli non leggibili:", e instanceof Error ? e.message : String(e));
  }
  return {
    tenantCode,
    nomeCliente,
    moduli,
    ora: new Date(),
    amministratore: ruolo === "admin" || ruolo === "superadmin",
  };
});

/** Sessione → cliente → moduli. Senza sessione: redirect("/login"). */
export async function contestoCliente(): Promise<ContestoCliente> {
  return leggiContestoCliente();
}

/** Esegue una lettura dentro il contesto del cliente. */
export function nelCliente<T>(c: ContestoCliente, fn: (db: Database.Database) => T): T {
  return withTenant(c.tenantCode, () => fn(getTenantDb(c.tenantCode)));
}

/** true se esiste un modulo di quella categoria con enabled && configured. */
export function moduloAttivo(c: ContestoCliente, categoria: ModuleState["category"]): boolean {
  return c.moduli.some((m) => m.category === categoria && m.enabled && m.configured);
}
