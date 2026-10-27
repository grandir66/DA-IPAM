/**
 * Porta in DA-IPAM una rete vista dal sensore trunk (2026-10-24): crea la rete
 * con VLAN e gateway dedotti. Una rete che si sovrappone a una esistente non si crea.
 * Dal 27/10 anche un giro ARP sul VID e gli host trovati (lib/trunk/aggiungi-rete.ts):
 * la risposta può arrivare dopo un minuto e mezzo.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { aggiungiReteDalTrunk } from "@/lib/trunk/aggiungi-rete";

const Corpo = z.object({
  vid: z.number().int().min(0).max(4094),
  cidr: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "Subnet non valida"),
  gateway: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).nullable().optional(),
  nome: z.string().max(100).optional(),
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
  const { vid, cidr, gateway, nome } = parsed.data;
  return withTenantFromSession(async () => {
    try {
      const e = await aggiungiReteDalTrunk({ vid, cidr, gateway: gateway ?? null, nome });
      return NextResponse.json({ id: e.rete.id, cidr: e.rete.cidr, host: e.host, giro: e.giro });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  });
}
