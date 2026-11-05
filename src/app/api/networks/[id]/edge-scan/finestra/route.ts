/**
 * Scansione a finestra di una rete (05/11/2026): lettura, salvataggio e cancellazione della finestra
 * che sta sulla sonda Edge. L'elenco degli IP è in `./ip/route.ts`. Validazione e stati HTTP stanno in
 * `@/lib/vuln/finestra-rotte`; qui la guardia e il contesto tenant.
 *
 * La GET risponde 200 con `stato`: «ok» (con `finestra: null` se la rete non ne ha), «da_aggiornare»
 * (la sonda non ha la rotta), «sonda_assente», «rete_non_registrata» o «errore» col motivo. Sono
 * stati della sonda, non guasti della rotta: il pannello li mostra tutti, nessuno diventa «nessuna finestra».
 */

import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { cancellaFinestraRotta, leggiFinestraRotta, salvaFinestraRotta } from "@/lib/vuln/finestra-rotte";

type Contesto = { params: Promise<{ id: string }> };

async function idRete(ctx: Contesto): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: Contesto) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => {
    const networkId = await idRete(ctx);
    if (networkId === null) return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    const r = await leggiFinestraRotta(networkId);
    return NextResponse.json(r.body, { status: r.status });
  });
}

export async function PUT(req: Request, ctx: Contesto) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const networkId = await idRete(ctx);
    if (networkId === null) return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      raw = undefined;
    }
    const r = await salvaFinestraRotta(networkId, raw);
    return NextResponse.json(r.body, { status: r.status });
  });
}

export async function DELETE(_req: Request, ctx: Contesto) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const networkId = await idRete(ctx);
    if (networkId === null) return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    const r = await cancellaFinestraRotta(networkId);
    return NextResponse.json(r.body, { status: r.status });
  });
}
