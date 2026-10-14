import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getHypervisorSyncSchedule, setHypervisorSyncSchedule } from "@/lib/db-tenant";
import { NO_STORE, readJson, reloadSchedulerForCurrentTenant } from "@/lib/controllers/route-helpers";

/**
 * Lettura giornaliera degli hypervisor (topologia fase 2b, spec §11.5): il job
 * hypervisor_sync del tenant, spento di default.
 */

/** GET /api/topology/settings/hypervisor — acceso o spento, quanti hypervisor, ultima lettura. */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json(getHypervisorSyncSchedule(), { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] lettura hypervisor, stato:", error);
      return NextResponse.json({ error: "Errore nella lettura dello stato degli hypervisor" }, { status: 500 });
    }
  });
}

const Corpo = z.object({ enabled: z.boolean({ error: "Indica se accendere (true) o spegnere (false) la lettura" }) }).strict();

/** PUT /api/topology/settings/hypervisor — `{ enabled }`: accende o spegne il job, poi ricarica lo scheduler. */
export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await readJson(req));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
    }
    try {
      setHypervisorSyncSchedule(parsed.data.enabled);
    } catch (error) {
      console.error("[topology] lettura hypervisor, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della lettura degli hypervisor" }, { status: 500 });
    }
    const warning = reloadSchedulerForCurrentTenant();
    return NextResponse.json({ ...getHypervisorSyncSchedule(), ...(warning ? { warning } : {}) }, { headers: NO_STORE });
  });
}
