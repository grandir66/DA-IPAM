import { NextResponse } from "next/server";
import { getHostById } from "@/lib/db-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { dnsAdLetto, dnsDiIp } from "@/lib/ad/dns/per-host";

/** Com'è messo questo host nel DNS di Active Directory. Sola lettura, dall'archivio: non interroga il DC. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const sessione = await requireAuth();
    if (isAuthError(sessione)) return sessione;
    const host = getHostById(Number((await params).id));
    if (!host) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
    return NextResponse.json({ ip: host.ip, letto: dnsAdLetto(), dns: dnsDiIp(host.ip) });
  });
}
