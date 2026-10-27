/**
 * GET /api/vulnerabilities/per-host/dettaglio?host=h:<id>|ip:<ip>
 *
 * La riga aperta della vista per host (22/10): tutte le vulnerabilità di quell'host, senza
 * filtri, le sfruttate in cima.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getVulnerabilitiesOfHost } from "@/lib/db-tenant";
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const host = new URL(request.url).searchParams.get("host") ?? "";
  if (!host || host.length > 100) {
    return NextResponse.json({ error: "host non valido" }, { status: 400 });
  }
  const { exploitDi, errore: exploit_errore } = exploitPerRotte();

  return withTenantFromSession(() => {
    try {
      const vulns = getVulnerabilitiesOfHost(host, exploitDi);
      if (!vulns) return NextResponse.json({ error: "host non valido" }, { status: 400 });
      return NextResponse.json({ host, vulns, total: vulns.length, exploit_errore });
    } catch (e) {
      console.error("[api/vulnerabilities/per-host/dettaglio] errore:", e);
      return NextResponse.json({ error: "Errore nel recupero delle vulnerabilità dell'host" }, { status: 500 });
    }
  });
}
