/**
 * Proposte di profilo VA della rete. GET legge, POST le rigenera dall'inventario, PATCH registra la
 * scelta di una persona. Nessuna di queste rotte lancia una scansione.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { quadroFamiglie } from "@/lib/vuln/proposta/quadro";
import { leggiScelte } from "@/lib/vuln/proposta/scelte-gruppo";
import { confermaProposte, leggiProposte, riapriProposte, rigeneraProposte, ultimaProposta } from "@/lib/vuln/proposta/store";

type Ctx = { params: Promise<{ id: string }> };

async function rete(params: Ctx["params"]) {
  const { id } = await params;
  const n = Number(id);
  return Number.isFinite(n) && getNetworkById(n) ? n : null;
}

const NON_TROVATA = { error: "Rete non trovata" };

/** Tutto quello che serve alla pagina: la rilettura dopo ogni scelta dà sempre lo stesso quadro. */
function risposta(id: number) {
  const proposte = leggiProposte(id);
  return { proposte, famiglie: quadroFamiglie(proposte, leggiScelte(id)), aggiornata_il: ultimaProposta(id) };
}

export async function GET(_req: Request, { params }: Ctx) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    return NextResponse.json(risposta(id));
  });
}

export async function POST(_req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    return NextResponse.json({ ...rigeneraProposte(id), ...risposta(id) });
  });
}

const Scelta = z.object({
  host_ids: z.array(z.number().int().positive()).min(1, "Scegli almeno un host").max(5000),
  /** `riapri`: si accetta il tipo nuovo di un host «da rivedere», che torna proposto nella famiglia giusta. */
  stato: z.enum(["confermato", "escluso", "riapri"]),
  voce: z.enum(["veloce", "bilanciato", "profondo", "formale"]).optional(),
  /** La nota della scelta, firmata con chi e quando (08/11/2026). */
  nota: z.string().max(300).optional().nullable(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json(NON_TROVATA, { status: 404 });
    const parsed = Scelta.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body JSON non valido" }, { status: 400 });
    if (parsed.data.stato === "riapri") return NextResponse.json({ ...riapriProposte(id, parsed.data.host_ids), ...risposta(id) });
    const chi = adminCheck.user?.name ?? adminCheck.user?.email ?? "amministratore";
    const esito = confermaProposte(id, { hostIds: parsed.data.host_ids, stato: parsed.data.stato, voce: parsed.data.voce, chi, nota: parsed.data.nota });
    return NextResponse.json({ ...esito, ...risposta(id) });
  });
}
