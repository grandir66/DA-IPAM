import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getHostById, getHostNotoPerIp, getHostNotoPerNomeNodo, getScansioniProxmoxSalvate } from "@/lib/db";
import { parseProxmoxScan } from "@/lib/topology/vms";
import { vmDelHost } from "@/lib/scheda/abbinamento-proxmox";

/**
 * GET: sola lettura. Se l'host è una VM di un cluster Proxmox (il suo IP sta in una sola VM delle scansioni
 * salvate) dice quale VM e su quale nodo, per la riga «VM n su <nodo>» dell'intestazione della scheda.
 * `vm: null` = non risulta una VM (o l'abbinamento è ambiguo).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const guardia = await requireAuth();
      if (isAuthError(guardia)) return guardia;
      const hostId = parseInt((await params).id, 10);
      if (isNaN(hostId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
      const host = getHostById(hostId);
      if (!host) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
      const scans = getScansioniProxmoxSalvate().map((s) => ({ deviceId: s.id, ...parseProxmoxScan(s.id, s.raw) }));
      const vm = vmDelHost(host.ip, scans, { perIp: getHostNotoPerIp, perNome: getHostNotoPerNomeNodo });
      return NextResponse.json({ vm });
    } catch (error) {
      console.error("Proxmox VM dell'host error:", error);
      return NextResponse.json({ error: "Errore nella ricerca della VM" }, { status: 500 });
    }
  });
}
