import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { indirizziAscolto, portaReteDaCollector, quadroAscolto, ReteNonVista } from "@/lib/traffico/reti-collector";

const CIDR = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(1[6-9]|2\d|30)$/;
const Corpo = z.object({
  sede: z.string().min(1).max(100), vid: z.number().int().min(0).max(4094),
  cidr: z.string().regex(CIDR, "Rete non valida: il prefisso va da /16 a /30"), nome: z.string().trim().max(100).optional(),
});

/** GET /api/traffico/reti-ascolto?sede=&vid=&cidr=&q=&limit=&offset=[&quadro=1] — VLAN, reti e indirizzi visti dai collector di una sede. */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const p = new URL(req.url).searchParams;
    const sede = p.get("sede") ?? "";
    const vid = p.get("vid");
    const elenco = indirizziAscolto(sede, {
      vid: vid !== null && /^\d{1,4}$/.test(vid) ? Number(vid) : null, cidr: p.get("cidr"), q: p.get("q")?.slice(0, 100),
      limit: Number(p.get("limit")) || 100, offset: Number(p.get("offset")) || 0,
    });
    if (!elenco) return NextResponse.json({ error: "Nessun collector in questa sede" }, { status: 404 });
    return NextResponse.json({ ...elenco, quadro: p.get("quadro") === "1" ? quadroAscolto(sede) : null }, { headers: NO_STORE });
  });
}

/** POST — porta in IPAM una rete vista dai collector, o gli host che mancano. Nessuna credenziale, nessun giro. */
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Corpo.safeParse(await readJson(req));
    if (!dati.success) return NextResponse.json({ error: dati.error.issues[0].message }, { status: 400 });
    try {
      return NextResponse.json(portaReteDaCollector(dati.data), { status: 201, headers: NO_STORE });
    } catch (e) {
      const testo = e instanceof Error ? e.message : "";
      if (e instanceof ReteNonVista || testo.includes("sovrappone")) return NextResponse.json({ error: testo }, { status: 409 });
      console.error("[traffico] porta rete dal collector:", testo);
      return NextResponse.json({ error: "La rete non è stata portata in DA-IPAM" }, { status: 500 });
    }
  });
}
