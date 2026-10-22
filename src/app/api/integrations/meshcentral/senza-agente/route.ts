/**
 * GET/PUT /api/integrations/meshcentral/senza-agente — l'interruttore del desktop
 * remoto senza agente (RDP/VNC dal server MeshCentral), analisi del 19/10 (F10).
 * Prima stava solo in `.env.local`; ora è un'impostazione del tenant. Se è acceso
 * dalla variabile d'ambiente, da qui non si spegne e lo si dice (409).
 * Lettura → requireAuth; scrittura → requireAdmin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setTenantSetting } from "@/lib/db-tenant";
import { CHIAVE_SENZA_AGENTE, statoSenzaAgente } from "@/lib/integrations/meshcentral/senza-agente";

const bodySchema = z.object({ attivo: z.boolean() });

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    return NextResponse.json(statoSenzaAgente());
  });
}

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    if (statoSenzaAgente().daAmbiente) {
      return NextResponse.json(
        { error: "Acceso da MESHCENTRAL_SENZA_AGENTE=1 in .env.local: si spegne togliendo quella riga e riavviando il servizio." },
        { status: 409 },
      );
    }
    setTenantSetting(CHIAVE_SENZA_AGENTE, parsed.data.attivo ? "1" : "0");
    return NextResponse.json(statoSenzaAgente());
  });
}
