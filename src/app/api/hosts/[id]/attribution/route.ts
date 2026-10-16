import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getActiveEvidence } from "@/lib/attribution/evidence";
import { fuseAttribution } from "@/lib/attribution/fuse";
import { buildMissingSuggestion } from "@/lib/attribution/missing";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const hostId = Number(id);
      if (!Number.isInteger(hostId) || hostId <= 0) {
        return Response.json({ error: "id host non valido" }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const signals = getAttributionSignalsForHost(hostId);
      if (!signals) return Response.json({ error: "host non trovato" }, { status: 404 });
      const dbh = getTenantDb(code);
      const evidence = getActiveEvidence(dbh, hostId);
      const result = fuseAttribution(evidence, new Date().toISOString());
      return Response.json({
        attribution: result,
        evidence,
        missing: buildMissingSuggestion(result),
      });
    } catch (error) {
      console.error("Error fetching host attribution:", error);
      return Response.json({ error: "Errore nel recupero dell'attribuzione" }, { status: 500 });
    }
  });
}
