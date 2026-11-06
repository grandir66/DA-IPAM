/**
 * Proposte di profilo VA della rete. GET legge, POST le rigenera dall'inventario, PATCH registra la
 * scelta di una persona. Nessuna di queste rotte lancia una scansione.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { confermaProposte, leggiProposte, rigeneraProposte } from "@/lib/vuln/proposta/store";

type Ctx = { params: Promise<{ id: string }> };

async function rete(params: Ctx["params"]) {
  const { id } = await params;
  const n = Number(id);
  return Number.isFinite(n) && getNetworkById(n) ? n : null;
}

const NON_TROVATA = { error: "Rete non trovata" };

export async function GET(_req: Request, { params }: Ctx) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    return NextResponse.json({ proposte: leggiProposte(id) });
  });
}

export async function POST(_req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    return NextResponse.json({ ...rigeneraProposte(id), proposte: leggiProposte(id) });
  });
}

const Scelta = z.object({
  host_ids: z.array(z.number().int().positive()).min(1, "Scegli almeno un host").max(5000),
  stato: z.enum(["confermato", "escluso"]),
  voce: z.enum(["veloce", "bilanciato", "profondo", "formale"]).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    const parsed = Scelta.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body JSON non valido" }, { status: 400 });
    const chi = adminCheck.user?.name ?? adminCheck.user?.email ?? "amministratore";
    const esito = confermaProposte(id, { hostIds: parsed.data.host_ids, stato: parsed.data.stato, voce: parsed.data.voce, chi });
    return NextResponse.json({ ...esito, proposte: leggiProposte(id) });
  });
}
