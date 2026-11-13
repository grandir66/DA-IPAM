import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";
import { salvaImpostazioneMonitoring } from "@/lib/cliente/monitoring-impostazioni";

/**
 * PUT /api/vista-cliente/monitoring/visibilita — una famiglia o un apparato visibile o nascosto al cliente, e il
 * nome che il cliente legge per un apparato (Riccardo, 13/11/2026). Solo amministratori.
 */
const Corpo = z
  .object({
    tipo: z.enum(["famiglia", "host"]),
    chiave: z.string().min(1).max(30),
    visibile: z.boolean(),
    nomeCliente: z.string().max(200).nullable().optional(),
  })
  .strict();

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    let corpo: unknown;
    try {
      corpo = await req.json();
    } catch {
      return NextResponse.json({ error: "Richiesta non leggibile" }, { status: 400 });
    }
    const p = Corpo.safeParse(corpo);
    if (!p.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
    const esito = salvaImpostazioneMonitoring(getDb(), p.data, s.user?.name ?? "admin");
    if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: 400 });
    return NextResponse.json({ ok: true });
  });
}
