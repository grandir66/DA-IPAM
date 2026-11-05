import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { applicaScelteContesi, leggiContesiDiRete, ORDINE_DIMENSIONI } from "@/lib/attribution/contesi";
import type { AttributionDimension } from "@/lib/attribution/types";

const ScelteSchema = z.object({
  scelte: z.array(z.object({
    host_id: z.number().int().positive(),
    dimensione: z.enum(ORDINE_DIMENSIONI as [AttributionDimension, ...AttributionDimension[]]),
    valore: z.string().min(1).max(200),
  })).min(1).max(1000),
});

export async function GET(request: Request) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const networkId = Number(searchParams.get("network_id"));
      if (!Number.isInteger(networkId) || networkId <= 0) {
        return Response.json({ error: "network_id non valido" }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const elenco = leggiContesiDiRete(getTenantDb(code), networkId, new Date().toISOString(), {
        includiManuali: searchParams.get("manuali") === "1",
      });
      return Response.json(elenco);
    } catch (error) {
      console.error("Error reading contested hosts:", error);
      return Response.json({ error: "Errore nella lettura degli IP contesi" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = ScelteSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.issues }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const esito = applicaScelteContesi(
        getTenantDb(code), parsed.data.scelte, getAttributionSignalsForHost, new Date().toISOString(),
      );
      return Response.json(esito);
    } catch (error) {
      console.error("Error applying contested choices:", error);
      return Response.json({ error: "Errore nell'applicazione delle scelte" }, { status: 500 });
    }
  });
}
