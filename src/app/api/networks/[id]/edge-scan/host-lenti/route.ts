/**
 * Host lenti di una rete (06/11/2026, piano host lenti): quelli fuori standard che la sonda tiene in un
 * job separato. GET legge (200 con `stato`, come la finestra: «da_aggiornare», «sonda_assente», … non
 * sono guasti della rotta); PUT accende/spegne l'esclusione (`escludi_lenti`) o toglie un IP (`togli_ip`),
 * con la stessa guardia delle rotte finestra.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { leggiHostLenti, salvaHostLenti } from "@/lib/vuln/edge-subnet-bridge";

type Contesto = { params: Promise<{ id: string }> };

const corpoSchema = z
  .object({
    escludi_lenti: z.boolean().optional(),
    job_lenti: z.boolean().optional(),
    togli_ip: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((c) => c.escludi_lenti !== undefined || c.job_lenti !== undefined || c.togli_ip !== undefined, "Serve «escludi_lenti», «job_lenti» o «togli_ip»");

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
    return NextResponse.json(await leggiHostLenti(networkId));
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
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = corpoSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body JSON non valido", details: parsed.error.issues }, { status: 400 });
    }
    const r = await salvaHostLenti(networkId, parsed.data);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, daAggiornare: r.daAggiornare ?? false }, { status: r.status });
    return NextResponse.json({ escludi_lenti: r.escludi_lenti, job_lenti: r.job_lenti, host: r.host });
  });
}
