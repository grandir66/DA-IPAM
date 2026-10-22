import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { conGuasto, rispostaLeggiJob, rispostaModifica } from "@/lib/apparati-scelti/rotte-server";

/**
 * Un job `apparati_scelti` per la finestra J2 in modo «modifica» (piano 2026-10-22 scansione automatica, Task 6).
 * GET: config, frequenza e stato degli apparati (admin: è la finestra di chi modifica). PUT `{ nome?, device_ids?,
 * frequenza?, cosa? }`: gli apparati si tolgono soltanto (aggiungerli → 400, si fa da Discovery). 404 su un job
 * assente o d'altro tipo. Sospendi = PUT generica di /api/jobs con `enabled`; Elimina = DELETE generica.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: Ctx) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const { id } = await context.params;
    const r = conGuasto("leggi", () => rispostaLeggiJob(id));
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}

export async function PUT(req: Request, context: Ctx) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const { id } = await context.params;
    const body = await readJson(req);
    const r = conGuasto("modifica", () => rispostaModifica(id, body));
    if (r.status === 200) {
      try { reloadTenantScheduler(await getServerTenantCode()); } catch (e) { console.error("[jobs] scheduler reload failed:", e instanceof Error ? e.name : "errore"); }
    }
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
