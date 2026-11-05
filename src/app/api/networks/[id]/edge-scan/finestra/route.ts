/**
 * Scansione a finestra di una rete (05/11/2026): lettura, salvataggio e cancellazione della finestra
 * che sta sulla sonda Edge. L'elenco degli IP è in `./ip/route.ts`.
 *
 * La GET risponde 200 con `stato`: «ok» (con `finestra: null` se la rete non ne ha), «da_aggiornare»
 * (la sonda non ha la rotta), «sonda_assente», «rete_non_registrata» o «errore» col motivo. Sono
 * stati della sonda, non guasti della rotta: il pannello li mostra tutti, nessuno diventa «nessuna finestra».
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  leggiFinestra,
  removeEdgeSubnetFinestra,
  resolveAssessmentForNetwork,
  saveEdgeSubnetFinestra,
} from "@/lib/vuln/edge-subnet-bridge";
import { assessmentProfileIdSchema } from "@/lib/vuln/edge-profiles";

const orario = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Orario non valido: scrivi HH:MM");

const finestraSchema = z.object({
  enabled: z.boolean(),
  giorni: z.array(z.number().int().min(0).max(6)).min(1, "Scegli almeno un giorno").max(7),
  dalle: orario,
  alle: orario,
  ripeti: z.enum(["mese", "settimana"]),
  ip_per_gruppo: z.number().int().min(1).max(20),
  tentativi: z.number().int().min(1).max(10),
  profile: z.enum(["fast", "balanced", "deep"]),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]),
  assessment_enabled: z.boolean().optional(),
  assessment_profile_id: assessmentProfileIdSchema.nullable().optional(),
});

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
    return NextResponse.json(await leggiFinestra(networkId));
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
    const parsed = finestraSchema.safeParse(raw);
    if (!parsed.success) {
      const primo = parsed.error.issues[0];
      return NextResponse.json(
        { error: primo?.message ?? "Body JSON non valido", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Come la pianificazione: un profilo assessment che l'edge non ha si ferma qui, prima di scrivere.
    const assessment = await resolveAssessmentForNetwork(networkId, {
      enabled: body.assessment_enabled,
      profileId: body.assessment_profile_id,
    });
    if (!assessment.ok) {
      return NextResponse.json({ ok: false, error: assessment.error }, { status: assessment.status });
    }

    const result = await saveEdgeSubnetFinestra(networkId, {
      enabled: body.enabled,
      giorni: body.giorni,
      dalle: body.dalle,
      alle: body.alle,
      ripeti: body.ripeti,
      ipPerGruppo: body.ip_per_gruppo,
      tentativi: body.tentativi,
      profile: body.profile,
      targetingMode: body.targeting_mode,
      assessmentEnabled: assessment.enabled,
      assessmentProfileId: assessment.profileId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, daAggiornare: result.daAggiornare ?? false },
        { status: result.status ?? 502 },
      );
    }
    return NextResponse.json({ ok: true, avviso: result.avviso ?? null, finestra: await leggiFinestra(networkId) });
  });
}

export async function DELETE(_req: Request, ctx: Contesto) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const networkId = await idRete(ctx);
    if (networkId === null) return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });

    const result = await removeEdgeSubnetFinestra(networkId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 502 });
    }
    return NextResponse.json({ ok: true, finestra: await leggiFinestra(networkId) });
  });
}
