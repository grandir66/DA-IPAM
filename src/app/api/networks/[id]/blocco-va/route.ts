/**
 * Rete fermata dalla sentinella di Edge: un impianto ha smesso di rispondere durante una scansione.
 * GET dice se lo è, DELETE la riapre. Lo sblocco è solo di una persona, e non lancia niente.
 */
import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { leggiBloccoRete, sbloccaReteEdge } from "@/lib/vuln/edge-subnet-bridge";

type Ctx = { params: Promise<{ id: string }> };

async function rete(params: Ctx["params"]) {
  const n = Number((await params).id);
  return Number.isInteger(n) && n > 0 && getNetworkById(n) ? n : null;
}

const NON_TROVATA = { error: "Rete non trovata" };

export async function GET(_req: Request, { params }: Ctx) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    try {
      return NextResponse.json({ blocco: await leggiBloccoRete(id) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "La sonda non risponde" }, { status: 502 });
    }
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    try {
      await sbloccaReteEdge(id, adminCheck.user.name || adminCheck.user.email || `utente ${adminCheck.user.id ?? "?"}`);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "La sonda non risponde" }, { status: 502 });
    }
  });
}
