import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { coppieDiHost } from "@/lib/traffico/lettura";

/** GET /api/traffico/host/[ip]?giorni=7 — con chi parla un host e chi parla a lui, dai collector. */
export async function GET(req: Request, { params }: { params: Promise<{ ip: string }> }) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const ip = decodeURIComponent((await params).ip);
    if (isIP(ip) === 0) return NextResponse.json({ error: "Indirizzo non valido" }, { status: 400 });
    const giorni = Number(new URL(req.url).searchParams.get("giorni") ?? 7);
    try {
      return NextResponse.json({ ip, ...coppieDiHost(ip, Number.isFinite(giorni) ? giorni : 7) }, { headers: NO_STORE });
    } catch (e) {
      console.error("[traffico] coppie dell'host:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero del traffico dell'host" }, { status: 500 });
    }
  });
}
