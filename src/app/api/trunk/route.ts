/**
 * Sensore trunk (2026-10-24): VLAN e osservazioni copiate nel DB del tenant.
 * GET  → quadro (VLAN + pagina di osservazioni), sola lettura.
 * POST → accende/spegne la lettura del tenant e, se accesa, fa subito un giro.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setTenantSetting } from "@/lib/db-tenant";
import {
  getTrunkOsservazioniPaginated,
  getTrunkVlan,
  sincronizzaTrunk,
  trunkLetturaAttiva,
} from "@/lib/trunk/sensore-trunk";

export async function GET(request: Request) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  return withTenantFromSession(() => {
    const { searchParams } = new URL(request.url);
    const vidRaw = searchParams.get("vid");
    const vid = vidRaw != null && vidRaw !== "" && Number.isInteger(Number(vidRaw)) ? Number(vidRaw) : null;
    const { righe, totale } = getTrunkOsservazioniPaginated({
      vid,
      cidr: ((c) => (c && /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(c) ? c : null))(searchParams.get("cidr")),
      q: searchParams.get("q") ?? undefined,
      metodo: ((m) => (m === "ascolto" || m === "giro" || m === "entrambi" ? m : null))(searchParams.get("metodo")),
      limit: Number(searchParams.get("limit")) || 100,
      offset: Number(searchParams.get("offset")) || 0,
    });
    return NextResponse.json({ attiva: trunkLetturaAttiva(), vlan: getTrunkVlan(), osservazioni: righe, totale });
  });
}

const Corpo = z.object({ attiva: z.boolean() });

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
    setTenantSetting("trunk_lettura", parsed.data.attiva ? "1" : "0");
    if (!parsed.data.attiva) return NextResponse.json({ attiva: false });
    try {
      const esito = await sincronizzaTrunk();
      return NextResponse.json({ attiva: true, ...esito });
    } catch (e) {
      return NextResponse.json(
        { attiva: true, error: `Sensore trunk non letto: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }
  });
}
