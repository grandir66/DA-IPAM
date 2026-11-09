/**
 * Scansione forzata di un host «da chiarire» (Passo 9, 08/11/2026, tavola oggetti 32-34 approvata). Riccardo: «con
 * l'autorizzazione di un operatore devono essere scansionabili». POST forza (famiglia scelta, nota facoltativa),
 * DELETE toglie la forzatura. Solo l'amministratore; nessuna delle due lancia una scansione. Un impianto non si
 * forza da qui: passa dal consenso. Lo stato si rilegge dal database, mai dal client.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getHostsByNetwork, getNetworkById } from "@/lib/db";
import { eImpianto } from "@/lib/vuln/impianti-in-rete";
import { quadroFamiglie } from "@/lib/vuln/proposta/quadro";
import { leggiScelte } from "@/lib/vuln/proposta/scelte-gruppo";
import type { HostPerProposta } from "@/lib/vuln/proposta/regole";
import { forzaProposta, leggiProposte, togliForzatura, ultimaProposta } from "@/lib/vuln/proposta/store";

type Ctx = { params: Promise<{ id: string }> };

const Forza = z.object({
  /** Uno o più host (08/11/2026: selezione multipla). */
  host_ids: z.array(z.number().int().positive()).min(1).max(2000),
  famiglia: z.enum(["rete", "windows", "linux", "web", "periferiche", "da_chiarire"]),
  nota: z.string().max(300).optional().nullable(),
});
const Togli = z.object({ host_id: z.number().int().positive() });

async function rete(params: Ctx["params"]): Promise<number | null> {
  const n = Number((await params).id);
  return Number.isInteger(n) && n > 0 && getNetworkById(n) ? n : null;
}

function risposta(id: number) {
  const proposte = leggiProposte(id);
  return { proposte, famiglie: quadroFamiglie(proposte, leggiScelte(id)), aggiornata_il: ultimaProposta(id) };
}

export async function POST(req: Request, { params }: Ctx) {
  const check = await requireAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const parsed = Forza.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    const host = new Map((getHostsByNetwork(id) as Array<HostPerProposta & { id: number }>).map((h) => [h.id, h]));
    const chi = check.user?.name ?? check.user?.email ?? "amministratore";
    const rifiutati: Array<{ host_id: number; motivo: string }> = [];
    for (const hostId of parsed.data.host_ids) {
      const esito = forzaProposta(id, { hostId, famiglia: parsed.data.famiglia, chi, nota: parsed.data.nota },
        (x) => { const h = host.get(x); return !h || eImpianto(h); });
      if (!esito.ok) rifiutati.push({ host_id: hostId, motivo: esito.motivo });
    }
    // Chi non passa lo si dice, gli altri restano scelti: una selezione mista non si butta tutta.
    return NextResponse.json({ ...risposta(id), rifiutati });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const check = await requireAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const parsed = Togli.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    const esito = togliForzatura(id, parsed.data.host_id);
    if (!esito.ok) return NextResponse.json({ error: esito.motivo }, { status: 409 });
    return NextResponse.json(risposta(id));
  });
}

