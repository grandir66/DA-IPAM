import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { conGuasto, rispostaAnteprima } from "@/lib/apparati-scelti/rotte-server";

/**
 * POST /api/jobs/apparati-scelti/anteprima `{ host_ids }` (piano 2026-10-22 scansione automatica, Task 6): per la
 * finestra J2, chi entra nel job e chi no col motivo, le letture valide per tipo e gli interruttori VLAN. Non scrive,
 * ma elenca host e IP del cliente per chi può creare il job: solo admin. Logica in `rotte-server.ts`.
 */
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const body = await readJson(req);
    const r = conGuasto("anteprima", () => rispostaAnteprima(body));
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
