/**
 * Piccoli aiuti condivisi dalle rotte /api/controllers (ADR 0007).
 */
import { NextResponse } from "next/server";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { getCurrentTenantCode } from "@/lib/db-tenant";

/** Id della rotta come intero positivo, o null. */
export function parseControllerId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "Controller non trovato" }, { status: 404 });
}

/** Corpo JSON della richiesta, o null se non è JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Dopo una modifica alla pianificazione: lo scheduler del tenant rilegge i job.
 * Un errore qui non annulla il salvataggio già fatto: torna come avviso.
 */
export function reloadSchedulerForCurrentTenant(): string | null {
  const code = getCurrentTenantCode();
  if (!code) return "Pianificazione salvata, ma senza contesto tenant lo scheduler non è stato ricaricato";
  try {
    reloadTenantScheduler(code);
    return null;
  } catch (e) {
    return `Pianificazione salvata, ma lo scheduler non è stato ricaricato: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Chi ha lanciato un'azione, per lo storico: nome, o email. */
export function actorOf(session: { user: { name?: string | null; email?: string | null } }): string | null {
  return session.user.name?.trim() || session.user.email?.trim() || null;
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
