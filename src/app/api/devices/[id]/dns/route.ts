import { NextResponse } from "next/server";
import { getNetworkDeviceById } from "@/lib/db-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { dnsAdLetto, dnsDiIp } from "@/lib/ad/dns/per-host";

/** Com'è messo questo apparato nel DNS di Active Directory. Sola lettura, dall'archivio: non interroga il DC. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const sessione = await requireAuth();
    if (isAuthError(sessione)) return sessione;
    const apparato = getNetworkDeviceById(Number((await params).id));
    if (!apparato) return NextResponse.json({ error: "Apparato non trovato" }, { status: 404 });
    const ip = (apparato.host ?? "").trim();
    return NextResponse.json({ ip, letto: dnsAdLetto(), dns: dnsDiIp(ip) });
  });
}
