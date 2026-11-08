/**
 * POST /api/trunk/vlan-nativa — la VLAN dei pacchetti senza tag del trunk (Riccardo, 08/11/2026).
 * Il sensore li manda come VID 0; in DA-IPAM la stessa rete ha la sua VLAN (di solito la 1). La pagina
 * propone quella dedotta e chi la usa la conferma: un numero, «nessuna», o null per tornare alla dedotta.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setTenantSetting } from "@/lib/db-tenant";
import { CHIAVE_VLAN_NATIVA, getTrunkAppartenenza } from "@/lib/trunk/sensore-trunk";
import { valutaRilievi } from "@/lib/trunk/rilievi";

const Corpo = z.object({ vid: z.union([z.number().int().min(1).max(4094), z.literal("nessuna"), z.null()]) });

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
    return NextResponse.json({ error: "VLAN non valida: un numero da 1 a 4094, «nessuna» o null" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    setTenantSetting(CHIAVE_VLAN_NATIVA, parsed.data.vid == null ? "" : String(parsed.data.vid));
    // Il rilievo «fuori rete» dipende dalla nativa: si ricalcola subito, non al prossimo giro.
    valutaRilievi();
    return NextResponse.json({ ok: true, appartenenza: getTrunkAppartenenza() });
  });
}
