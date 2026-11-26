import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { statoDnsDi } from "@/lib/ad/dns/per-host";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Lo stato nel DNS di Active Directory di un elenco di indirizzi, in una chiamata (elenco degli apparati):
 * `ip → ok · manca · diverso`. Sola lettura, dall'archivio: non interroga il DC.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const sessione = await requireAuth();
    if (isAuthError(sessione)) return sessione;
    let ips: unknown;
    try {
      ips = ((await request.json()) as { ips?: unknown }).ips;
    } catch {
      return NextResponse.json({ error: "Richiesta non leggibile" }, { status: 400 });
    }
    if (!Array.isArray(ips)) return NextResponse.json({ error: "Manca l'elenco degli indirizzi" }, { status: 400 });
    const puliti = [...new Set(ips.filter((x): x is string => typeof x === "string" && IPV4.test(x)))].slice(0, 5000);
    return NextResponse.json({ stati: statoDnsDi(puliti) });
  });
}
