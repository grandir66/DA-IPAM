import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb, getHostsByNetwork } from "@/lib/db-tenant";
import { recomputeHostAttribution } from "@/lib/attribution/recompute";

const RecomputeSchema = z.object({
  network_id: z.number().int().positive().optional(),
  host_ids: z.array(z.number().int().positive()).optional(),
});

export async function POST(request: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = RecomputeSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.issues }, { status: 400 });
      }
      const { network_id, host_ids } = parsed.data;
      if (!network_id && (!host_ids || host_ids.length === 0)) {
        return Response.json({ error: "indicare network_id o host_ids" }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const dbh = getTenantDb(code);
      const ids: number[] = host_ids ?? getHostsByNetwork(network_id!).map((h) => h.id);
      let done = 0;
      for (const hostId of ids) {
        const signals = getAttributionSignalsForHost(hostId);
        if (!signals) continue;
        recomputeHostAttribution(dbh, signals, "apply");
        done += 1;
      }
      return Response.json({
        success: true,
        hosts: ids.length,
        recomputed: done,
        message: `Attribuzione ricalcolata su ${done} host`,
      });
    } catch (error) {
      console.error("Error recomputing attribution:", error);
      return Response.json({ error: "Errore nel ricalcolo dell'attribuzione" }, { status: 500 });
    }
  });
}
