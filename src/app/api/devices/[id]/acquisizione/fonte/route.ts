/**
 * Finestra del caso dubbio (tavola C1, oggetto 15 corretto dalla decisione 4): PUT /api/devices/[id]/acquisizione/fonte
 * { scelta: "<id del catalogo>" | "classica" } salva la scelta di una persona; si accetta solo un collector fra quelli
 * possibili per il prodotto, o «classica» (l'acquisizione di sempre). Solo admin. Nessuna credenziale si sceglie qui:
 * valgono quelle assegnate all'apparato.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { collectorPossibili } from "@/lib/acquisition/riconosci";
import { getNetworkDeviceById, salvaSceltaFonteAcquisizione } from "@/lib/db-tenant";
import { SCELTA_CLASSICA, SCELTE_AMMESSE } from "@/lib/acquisizione-modulare/fonte";

type RouteParams = { params: Promise<{ id: string }> };
const corpo = z.object({ scelta: z.string().refine((s) => SCELTE_AMMESSE.includes(s), "Scelta sconosciuta") }).strict();

export async function PUT(request: Request, { params }: RouteParams) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const parsed = corpo.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  return withTenantFromSession(() => {
    const device = getNetworkDeviceById(deviceId);
    if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    const { scelta } = parsed.data;
    if (scelta !== SCELTA_CLASSICA && !(collectorPossibili(device) as string[]).includes(scelta)) {
      return NextResponse.json({ error: `«${scelta}» non legge questo prodotto` }, { status: 400 });
    }
    salvaSceltaFonteAcquisizione(deviceId, scelta, { id: adminCheck.user.id ? Number(adminCheck.user.id) : null, nome: adminCheck.user.name ?? null });
    return NextResponse.json({ ok: true, scelta });
  });
}
