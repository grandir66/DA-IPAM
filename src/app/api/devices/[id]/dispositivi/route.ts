/**
 * Dispositivi visti da un router MikroTik (21/10, tab «Dispositivi» della scheda): ARP, lease DHCP, vicini e host IPAM
 * uniti per IP con le precedenze del Manager (src/lib/scheda/dispositivi-router.ts).
 * GET /api/devices/[id]/dispositivi?pagina=1&filtro=tutti&q= → { righe, totale, conteggi, pagina, pagine }
 * Sola lettura con la sessione; filtro, ricerca e pagina sono lato server (regola 9 del CLAUDE.md).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkDeviceById, ingressoDispositivi } from "@/lib/db-tenant";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";
import { FILTRI_DISPOSITIVI, paginaDispositivi, unisciDispositivi, type FiltroDispositivi } from "@/lib/scheda/dispositivi-router";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }
  const sp = request.nextUrl.searchParams;
  const filtroGrezzo = sp.get("filtro") ?? "tutti";
  if (!(FILTRI_DISPOSITIVI as readonly string[]).includes(filtroGrezzo)) {
    return NextResponse.json({ error: "Filtro non valido" }, { status: 400 });
  }
  const pagina = Number(sp.get("pagina") ?? "1");
  return withTenantFromSession(() => {
    const device = getNetworkDeviceById(deviceId);
    if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    if (device.vendor !== "mikrotik") {
      return NextResponse.json({ error: "Questo elenco è solo per dispositivi MikroTik" }, { status: 400 });
    }
    const righe = unisciDispositivi(ingressoDispositivi(deviceId), lookupVendorSync);
    return NextResponse.json(paginaDispositivi(righe, { pagina: Number.isFinite(pagina) ? pagina : 1, filtro: filtroGrezzo as FiltroDispositivi, q: (sp.get("q") ?? "").slice(0, 100) }));
  });
}
