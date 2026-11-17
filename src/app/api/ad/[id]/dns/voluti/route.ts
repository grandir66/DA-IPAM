import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getAdIntegrationById, segnaVolutoDnsAd, togliVolutoDnsAd } from "@/lib/db-tenant";
import { TIPI_ANOMALIA_DNS } from "@/lib/ad/dns/anomalie";

type Params = { params: Promise<{ id: string }> };

const Chiave = z.string().min(3).max(300).refine((c) => TIPI_ANOMALIA_DNS.some((t) => c.startsWith(`${t}:`)), "Chiave non valida");
const Segna = z.object({ chiave: Chiave, nota: z.string().trim().max(300).optional() });
const Togli = z.object({ chiave: Chiave });

async function corpo(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

/** Segna un'anomalia del DNS come voluta. Scrive solo nel database di DA-IPAM, niente verso il DC. */
export async function POST(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAdmin();
    if (isAuthError(sessione)) return sessione;
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || !getAdIntegrationById(id)) return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    const dati = Segna.safeParse(await corpo(request));
    if (!dati.success) return NextResponse.json({ error: dati.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    segnaVolutoDnsAd(id, dati.data.chiave, dati.data.nota || null, sessione.user?.name ?? sessione.user?.email ?? null);
    return NextResponse.json({ success: true });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAdmin();
    if (isAuthError(sessione)) return sessione;
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || !getAdIntegrationById(id)) return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    const dati = Togli.safeParse(await corpo(request));
    if (!dati.success) return NextResponse.json({ error: dati.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    return NextResponse.json({ success: togliVolutoDnsAd(id, dati.data.chiave) });
  });
}
