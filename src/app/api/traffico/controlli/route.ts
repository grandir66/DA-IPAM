import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { controlliSpenti, impostaControllo, TIPI_CONTROLLO } from "@/lib/traffico/anomalie";
import { dbTraffico } from "@/lib/traffico/lettura";
import { retiPerControlli } from "@/lib/traffico/quadro";

const Cambio = z.object({ network_id: z.number().int().min(0), tipo: z.enum(TIPI_CONTROLLO), acceso: z.boolean() });

/** GET /api/traffico/controlli — i controlli sul contenuto e quelli spenti, rete per rete (assente = acceso). */
export async function GET() {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => NextResponse.json({ tipi: TIPI_CONTROLLO, spenti: controlliSpenti(dbTraffico()), reti: retiPerControlli() }, { headers: NO_STORE }));
}

/** PUT /api/traffico/controlli — `{ network_id, tipo, acceso }`: accende o spegne un controllo per una rete. */
export async function PUT(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Cambio.safeParse(await readJson(req));
    if (!dati.success) return NextResponse.json({ error: "Dati non validi", campi: dati.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
    impostaControllo(dbTraffico(), dati.data.network_id, dati.data.tipo, dati.data.acceso);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  });
}
