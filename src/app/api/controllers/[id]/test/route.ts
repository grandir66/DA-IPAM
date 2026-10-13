import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { probeSavedController } from "@/lib/controllers/service";
import { NO_STORE, notFound, parseControllerId } from "@/lib/controllers/route-helpers";

/**
 * POST /api/controllers/[id]/test — «Prova» dalla riga: legge il controller
 * con la configurazione salvata, senza scrivere nel DB del tenant. POST e
 * admin: manda le credenziali al controller e, al primo uso riuscito, fissa
 * l'impronta del certificato.
 *
 * Risposta: `{ ok: true, devices, certPin, certPinRecorded, sites? }` oppure
 * `{ ok: false, reason, message, presentedPin?, expectedPin? }`. Mai segreti.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  return withTenantFromSession(async () => NextResponse.json(await probeSavedController(id), { headers: NO_STORE }));
}
