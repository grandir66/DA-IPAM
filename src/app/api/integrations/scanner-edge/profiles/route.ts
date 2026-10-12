/**
 * Profili assessment dell'edge configurato per il tenant (EDG-1).
 *
 *  GET — l'elenco letto da `GET /api/v1/profiles` dell'edge, per il pannello
 *        VA Scan della subnet. Se l'edge non risponde, o risponde con una forma
 *        sbagliata, torna l'errore: la pagina lo mostra e non offre una lista
 *        inventata.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { listEdgeProfiles } from "@/lib/vuln/scanner-edge-client";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => {
    const scanner = getActiveEdgeScanner();
    if (!scanner) {
      return NextResponse.json(
        { ok: false, error: "Scanner-Edge non configurato o disabilitato" },
        { status: 409 },
      );
    }
    try {
      const list = await listEdgeProfiles(scanner);
      return NextResponse.json({ ok: true, ...list });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "errore sconosciuto";
      return NextResponse.json(
        { ok: false, error: `L'edge non ha restituito i profili assessment: ${msg}` },
        { status: 502 },
      );
    }
  });
}
