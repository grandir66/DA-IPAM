import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkController } from "@/lib/db-tenant";
import { checkControllerInput, probeControllerInput } from "@/lib/controllers/service";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";

/**
 * POST /api/controllers/probe — «Prova» dal modulo, prima di salvare.
 * Corpo: i campi del modulo, più `id` se si sta modificando un controller
 * (allora i segreti lasciati vuoti valgono quelli salvati, se l'indirizzo è lo
 * stesso). Non scrive nel DB del tenant; l'impronta del certificato vista torna
 * nella risposta e il modulo la manda col salvataggio.
 */
export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const body = await readJson(req);
  return withTenantFromSession(async () => {
    const rawId = (body as { id?: unknown } | null)?.id;
    const id = rawId === undefined || rawId === null ? null : Number(rawId);
    if (id !== null && !(Number.isInteger(id) && id > 0)) {
      return NextResponse.json({ error: "Id non valido" }, { status: 400 });
    }
    const existing = id !== null ? getNetworkController(id) : undefined;
    if (id !== null && !existing) return NextResponse.json({ error: "Controller non trovato" }, { status: 404 });
    const check = checkControllerInput(body, existing);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    return NextResponse.json(await probeControllerInput(check.value, id), { headers: NO_STORE });
  });
}
