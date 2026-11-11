import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { funzioniPerHost } from "@/lib/classification/funzioni-db";

/**
 * GET /api/hosts/funzioni[?network_id=N] — le funzioni degli apparati, per host: `{ "<host_id>": [{ funzione,
 * origine, a_mano }] }`. Sola lettura; le liste le chiedono a parte per non appesantire le query degli host.
 */
export async function GET(request: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    try {
      const grezzo = new URL(request.url).searchParams.get("network_id");
      const rete = grezzo != null && /^\d+$/.test(grezzo) ? Number(grezzo) : undefined;
      return NextResponse.json(funzioniPerHost(getDb(), rete));
    } catch (error) {
      console.error("Error funzioni degli host:", error);
      return NextResponse.json({ error: "Errore nella lettura delle funzioni" }, { status: 500 });
    }
  });
}
