import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { conGuasto, rispostaCrea } from "@/lib/apparati-scelti/rotte-server";

/**
 * POST /api/jobs/apparati-scelti `{ nome, host_ids, frequenza, cosa }` (piano 2026-10-22 scansione automatica, Task 6):
 * crea il job coi soli apparati idonei, ricontrollati qui. Solo admin. 201 `{ id, inclusi, esclusi }`; 400 con 0
 * inclusi o più di 50 host. Logica in `rotte-server.ts`.
 */
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const body = await readJson(req);
    const r = conGuasto("crea", () => rispostaCrea(body));
    if (r.status === 201) {
      try { reloadTenantScheduler(await getServerTenantCode()); } catch (e) { console.error("[jobs] scheduler reload failed:", e instanceof Error ? e.name : "errore"); }
    }
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
