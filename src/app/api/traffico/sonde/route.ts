import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { impostaSondeAggiunte, indirizziPropri, ipValido, MAX_SONDE, sondeAggiunte } from "@/lib/traffico/sonde";

const Cambio = z.object({ aggiunte: z.array(z.string().refine(ipValido)).max(MAX_SONDE) });

/** GET /api/traffico/sonde — le sonde note: gli indirizzi di IPAM (da soli) e quelle aggiunte a mano. */
export async function GET() {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => NextResponse.json({ proprie: indirizziPropri(), aggiunte: sondeAggiunte() }, { headers: NO_STORE }));
}

/** PUT /api/traffico/sonde — `{ aggiunte: ["192.168.4.20", …] }`: sostituisce l'elenco delle sonde aggiunte a mano. */
export async function PUT(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Cambio.safeParse(await readJson(req));
    if (!dati.success) return NextResponse.json({ error: "Dati non validi: servono indirizzi IPv4" }, { status: 400 });
    return NextResponse.json({ ok: true, aggiunte: impostaSondeAggiunte(dati.data.aggiunte) }, { headers: NO_STORE });
  });
}
