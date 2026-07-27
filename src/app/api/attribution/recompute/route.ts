import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb, getHostsByNetwork } from "@/lib/db-tenant";
import { recomputeHostAttribution, previewHostAttribution } from "@/lib/attribution/recompute";
import { getActiveEvidence } from "@/lib/attribution/evidence";
import type { AttributionEvidenceRow, AttributionDimension } from "@/lib/attribution/types";

const RecomputeSchema = z.object({
  network_id: z.number().int().positive().optional(),
  host_ids: z.array(z.number().int().positive()).optional(),
  preview: z.boolean().optional(),
});

interface CurrentAttrRow {
  ip: string;
  hostname: string | null;
  attr_vendor: string | null;
  attr_category: string | null;
  attr_os_family: string | null;
}

const DIMENSIONS: AttributionDimension[] = ["vendor", "category", "os"];
const BEFORE_COLUMN: Record<AttributionDimension, keyof CurrentAttrRow> = {
  vendor: "attr_vendor",
  category: "attr_category",
  os: "attr_os_family",
};

/** Evidenze citate da una dimensione (max 5), risolte dalle sole evidenze attive dell'host. */
function citedEvidence(activeEvidence: AttributionEvidenceRow[], evidenceIds: number[]) {
  const idSet = new Set(evidenceIds);
  return activeEvidence
    .filter((e) => idSet.has(e.id))
    .slice(0, 5)
    .map((e) => ({ source: e.source, claim: e.claim, raw_value: e.raw_value }));
}

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
      const { network_id, host_ids, preview } = parsed.data;
      if (!network_id && (!host_ids || host_ids.length === 0)) {
        return Response.json({ error: "indicare network_id o host_ids" }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const dbh = getTenantDb(code);
      const ids: number[] = host_ids ?? getHostsByNetwork(network_id!).map((h) => h.id);

      if (preview) {
        const currentRow = dbh.prepare(
          `SELECT ip, hostname, attr_vendor, attr_category, attr_os_family FROM hosts WHERE id = ?`
        );
        const changes: Array<{
          host_id: number; ip: string; hostname: string | null; manual: boolean;
          dimensions: Array<{
            dimension: AttributionDimension; before: string | null; after: string | null;
            confidence: number; evidence: Array<{ source: string; claim: string; raw_value: string | null }>;
            min_phase: string | null;
          }>;
        }> = [];

        for (const hostId of ids) {
          const signals = getAttributionSignalsForHost(hostId);
          if (!signals) continue;
          const current = currentRow.get(hostId) as CurrentAttrRow | undefined;
          if (!current) continue;

          const result = previewHostAttribution(dbh, signals);
          const activeEvidence = getActiveEvidence(dbh, hostId);
          const manual = activeEvidence.some((e) => e.source === "manual");

          const dimensions: (typeof changes)[number]["dimensions"] = [];
          for (const dimension of DIMENSIONS) {
            const before = current[BEFORE_COLUMN[dimension]];
            const after = result[dimension].claim;
            if (before === after) continue;
            dimensions.push({
              dimension,
              before,
              after,
              confidence: result[dimension].confidence,
              evidence: citedEvidence(activeEvidence, result[dimension].evidence_ids),
              min_phase: result[dimension].min_phase,
            });
          }
          if (dimensions.length > 0) {
            changes.push({
              host_id: hostId,
              ip: current.ip,
              hostname: current.hostname,
              manual,
              dimensions,
            });
          }
        }

        return Response.json({
          success: true,
          preview: true,
          total: ids.length,
          changes,
        });
      }

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
