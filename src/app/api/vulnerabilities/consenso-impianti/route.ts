/**
 * Consenso a scansionare gli impianti di una rete, e registro. Leggere basta la sessione, dare o revocare
 * chiede l'amministratore. Il nome viene dalla sessione e gli IP dall'inventario: non si leggono dal corpo.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { ipImpiantiDellaRete } from "@/lib/vuln/edge-subnet-bridge";
import {
  ORE_CONSENSO,
  daiConsenso,
  leggiRegistro,
  registroCsv,
  revocaConsenso,
  sincronizzaRegistro,
} from "@/lib/vuln/registro-impianti";

const dai = z.object({
  network_id: z.number().int().positive(),
  riferimento: z.string().trim().min(3, "Scrivi il riferimento all'autorizzazione del cliente").max(500),
  ore: z.union([z.literal(ORE_CONSENSO[0]), z.literal(ORE_CONSENSO[1]), z.literal(ORE_CONSENSO[2])]),
  consapevole: z.literal(true, { message: "Serve la conferma che il cliente sa che la produzione può fermarsi" }),
});
const revoca = z.object({ network_id: z.number().int().positive() });

function chi(s: { user: { name?: string | null; email?: string | null; id?: string | null } }): string {
  return s.user.name || s.user.email || `utente ${s.user.id ?? "?"}`;
}

export async function GET(req: Request) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    const url = new URL(req.url);
    const rete = Number(url.searchParams.get("rete"));
    if (url.searchParams.has("rete")) {
      if (!Number.isInteger(rete) || rete <= 0 || !getNetworkById(rete)) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
      return NextResponse.json({ ips: ipImpiantiDellaRete(rete) });
    }
    // Sonda spenta o vecchia: si mostra la copia che c'è, e lo si dice.
    let avviso: string | null = null;
    try {
      await sincronizzaRegistro();
    } catch (e) {
      avviso = e instanceof Error ? e.message : "La sonda non risponde";
    }
    if (url.searchParams.get("formato") === "csv") {
      return new NextResponse(`﻿${registroCsv(leggiRegistro(100000))}`, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="registro-impianti.csv"' },
      });
    }
    return NextResponse.json({ righe: leggiRegistro(), avviso });
  });
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const parsed = dai.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    if (!getNetworkById(parsed.data.network_id)) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const r = await daiConsenso(parsed.data.network_id, { chi: chi(adminCheck), riferimento: parsed.data.riferimento, ore: parsed.data.ore });
    return r.ok ? NextResponse.json({ consenso: r.dati }) : NextResponse.json({ error: r.error, daAggiornare: r.daAggiornare }, { status: r.status });
  });
}

export async function DELETE(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const parsed = revoca.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !getNetworkById(parsed.data.network_id)) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const r = await revocaConsenso(parsed.data.network_id, chi(adminCheck));
    return r.ok ? NextResponse.json(r.dati) : NextResponse.json({ error: r.error, daAggiornare: r.daAggiornare }, { status: r.status });
  });
}
