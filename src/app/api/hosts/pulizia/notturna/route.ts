import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getPuliziaHostSchedule, setPuliziaHostSchedule } from "@/lib/db-tenant";
import { NO_STORE, readJson, reloadSchedulerForCurrentTenant } from "@/lib/controllers/route-helpers";

/**
 * Pulizia notturna degli host assenti (piano 2026-10-20, Task 5): il job pulizia_host del tenant, ogni notte
 * alle 04:00, spento di default. È l'unico interruttore che lo crea (decisione 4). Copia della rotta
 * `topology/settings/hypervisor`.
 */

/** GET /api/hosts/pulizia/notturna — acceso o spento, fine dell'ultimo giro. Niente host: solo lo stato del job. */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json(getPuliziaHostSchedule(), { headers: NO_STORE });
    } catch (error) {
      console.error("[hosts] pulizia notturna, stato:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nella lettura dello stato della pulizia notturna" }, { status: 500 });
    }
  });
}

const Corpo = z.object({ enabled: z.boolean({ error: "Indica se accendere (true) o spegnere (false) la pulizia notturna" }) }).strict();

/** PUT /api/hosts/pulizia/notturna — `{ enabled }`: accende o spegne il job, poi ricarica lo scheduler. */
export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await readJson(req));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
    }
    try {
      setPuliziaHostSchedule(parsed.data.enabled);
    } catch (error) {
      console.error("[hosts] pulizia notturna, scrittura:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio della pulizia notturna" }, { status: 500 });
    }
    const warning = reloadSchedulerForCurrentTenant();
    return NextResponse.json({ ...getPuliziaHostSchedule(), ...(warning ? { warning } : {}) }, { headers: NO_STORE });
  });
}
