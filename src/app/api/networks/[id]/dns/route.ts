import { NextResponse } from "next/server";
import { getHostsByNetwork } from "@/lib/db-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { statoDnsDi } from "@/lib/ad/dns/per-host";

/** Lo stato nel DNS di Active Directory di tutti gli host di una subnet, in una chiamata: `ip → ok · manca · diverso`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const sessione = await requireAuth();
    if (isAuthError(sessione)) return sessione;
    const host = getHostsByNetwork(Number((await params).id));
    return NextResponse.json({ stati: statoDnsDi(host.map((h) => h.ip)) });
  });
}
