import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { recordEvidence } from "@/lib/attribution/evidence";
import { recomputeHostAttribution } from "@/lib/attribution/recompute";
import { isValidCategory } from "@/lib/attribution/taxonomy";
import type { EvidenceInput } from "@/lib/attribution/types";

const OverrideSchema = z.object({
  vendor: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  os_family: z.enum(["windows", "linux", "macos", "network-os"]).optional(),
  os_name: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const hostId = Number(id);
      if (!Number.isInteger(hostId) || hostId <= 0) {
        return Response.json({ error: "id host non valido" }, { status: 400 });
      }
      const body = await request.json().catch(() => null);
      const parsed = OverrideSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.issues }, { status: 400 });
      }
      const { vendor, category, os_family, os_name } = parsed.data;
      if (!vendor && !category && !os_family) {
        return Response.json({ error: "indicare almeno una dimensione da correggere" }, { status: 400 });
      }
      if (category && !isValidCategory(category)) {
        return Response.json({ error: `categoria non valida: ${category}` }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const signals = getAttributionSignalsForHost(hostId);
      if (!signals) return Response.json({ error: "host non trovato" }, { status: 404 });

      const inputs: EvidenceInput[] = [];
      if (vendor) inputs.push({ source: "manual", phase: "manual", dimension: "vendor", claim: vendor, confidence: 1, raw_value: vendor });
      if (category) inputs.push({ source: "manual", phase: "manual", dimension: "category", claim: category, confidence: 1 });
      if (os_family) inputs.push({ source: "manual", phase: "manual", dimension: "os", claim: os_family, confidence: 1, raw_value: os_name ?? null });

      const dbh = getTenantDb(code);
      recordEvidence(dbh, hostId, inputs);
      const result = recomputeHostAttribution(dbh, signals, "manual");
      return Response.json({ success: true, attribution: result });
    } catch (error) {
      console.error("Error overriding host attribution:", error);
      return Response.json({ error: "Errore nell'override dell'attribuzione" }, { status: 500 });
    }
  });
}
