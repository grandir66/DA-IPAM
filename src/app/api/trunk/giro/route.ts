/**
 * Giro ARP su una rete vista dal sensore trunk (2026-10-24): solo su richiesta
 * di un admin, mai pianificato. Parte dal sensore (socket locale o edge); i
 * risultati arrivano con la lettura successiva.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { chiediGiroArp, SensoreTrunkAssente, trunkLetturaAttiva } from "@/lib/trunk/sensore-trunk";

const Corpo = z.object({
  vid: z.number().int().min(0).max(4094),
  cidr: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "Subnet non valida"),
});

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = Corpo.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validazione fallita", details: parsed.error.issues }, { status: 400 });
  }
  return withTenantFromSession(async () => {
    if (!trunkLetturaAttiva()) {
      return NextResponse.json({ error: "Il sensore trunk è spento: accendilo in Impostazioni › Opzioni" }, { status: 409 });
    }
    try {
      const giro = await chiediGiroArp(parsed.data.vid, parsed.data.cidr);
      return NextResponse.json(giro);
    } catch (e) {
      const status = e instanceof SensoreTrunkAssente ? 404 : 502;
      return NextResponse.json({ error: `Giro ARP non partito: ${e instanceof Error ? e.message : String(e)}` }, { status });
    }
  });
}
