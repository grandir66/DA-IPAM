/**
 * Scelta per gruppo della rete (09/11/2026, tavola 45-48). PUT salva Greenbone, nuclei e moduli di una famiglia (solo
 * l'amministratore, firmata col nome della sessione); una scelta che alza il rischio vuole la nota. DELETE = «↺ Torna
 * alla tabella». Risponde col quadro aggiornato, come le altre rotte delle proposte. Nessuna scansione parte da qui.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { quadroFamiglie } from "@/lib/vuln/proposta/quadro";
import {
  FAMIGLIE_SCEGLIBILI, MODULI_SCELTA, NUCLEI_SCELTA, PROFILI_SCELTA,
  controllaScelta, leggiScelte, rischioDellaScelta, salvaScelta, togliScelta,
} from "@/lib/vuln/proposta/scelte-gruppo";
import { leggiProposte, ultimaProposta } from "@/lib/vuln/proposta/store";

type Ctx = { params: Promise<{ id: string }> };

const Salva = z.object({
  famiglia: z.enum(FAMIGLIE_SCEGLIBILI),
  profile: z.enum(PROFILI_SCELTA).nullable(),
  nuclei: z.enum(NUCLEI_SCELTA).nullable(),
  moduli: z.enum(MODULI_SCELTA).nullable(),
  nota: z.string().trim().max(300).optional().nullable(),
});
const Togli = z.object({ famiglia: z.enum(FAMIGLIE_SCEGLIBILI) });

async function rete(params: Ctx["params"]): Promise<number | null> {
  const n = Number((await params).id);
  return Number.isInteger(n) && n > 0 && getNetworkById(n) ? n : null;
}

function risposta(id: number) {
  const proposte = leggiProposte(id);
  return { proposte, famiglie: quadroFamiglie(proposte, leggiScelte(id)), aggiornata_il: ultimaProposta(id) };
}

export async function PUT(req: Request, { params }: Ctx) {
  const check = await requireAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const parsed = Salva.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    const s = parsed.data;
    const no = controllaScelta(s.famiglia, s);
    if (no) return NextResponse.json({ error: no }, { status: 400 });
    const nota = s.nota?.trim() || null;
    const rischio = rischioDellaScelta(s.famiglia, s);
    if (rischio && !nota) return NextResponse.json({ error: "Questa scelta alza il rischio: scrivi perché", rischio }, { status: 409 });
    const chi = check.user?.name ?? check.user?.email ?? "amministratore";
    salvaScelta(id, s, chi, nota);
    return NextResponse.json(risposta(id));
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const check = await requireAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const id = await rete(params);
    if (id === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const parsed = Togli.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Famiglia non valida" }, { status: 400 });
    togliScelta(id, parsed.data.famiglia);
    return NextResponse.json(risposta(id));
  });
}
