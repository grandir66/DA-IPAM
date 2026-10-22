/**
 * GET/PUT /api/patch/choco-automatico — l'interruttore «Installa Chocolatey
 * automaticamente» della pagina del modulo Patch Management (21/10/2026),
 * impostazione del tenant, acceso di default. Il GET porta anche il
 * riepilogo degli host Windows con credenziale WinRM (installati, da
 * installare, falliti, fermi al limite di tentativi).
 * Lettura → requireAuth + modulo attivo; scrittura → requireAdmin + modulo attivo.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { patchModuleGuard } from "@/lib/patch/route-guard";
import {
  chocoAutomaticoAccesoDb,
  impostaChocoAutomaticoDb,
  riepilogoChocoDb,
  TENTATIVI_NOTTURNI_MAX,
} from "@/lib/patch/choco-automatico";

const bodySchema = z.object({ acceso: z.boolean() });

function stato() {
  const code = getCurrentTenantCode();
  if (!code) return NextResponse.json({ error: "Tenant context non disponibile" }, { status: 500 });
  const db = getTenantDb(code);
  return NextResponse.json({
    acceso: chocoAutomaticoAccesoDb(db),
    tentativiMax: TENTATIVI_NOTTURNI_MAX,
    riepilogo: riepilogoChocoDb(db),
  });
}

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    try {
      return stato();
    } catch (e) {
      console.error("[patch/choco-automatico GET]", (e as Error).message);
      return NextResponse.json({ error: "Errore nella lettura dello stato di Chocolatey" }, { status: 500 });
    }
  });
}

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const code = getCurrentTenantCode();
    if (!code) return NextResponse.json({ error: "Tenant context non disponibile" }, { status: 500 });
    try {
      impostaChocoAutomaticoDb(getTenantDb(code), parsed.data.acceso);
      return stato();
    } catch (e) {
      console.error("[patch/choco-automatico PUT]", (e as Error).message);
      return NextResponse.json({ error: "Errore nel salvataggio dell'interruttore" }, { status: 500 });
    }
  });
}
