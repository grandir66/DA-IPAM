/**
 * Alert di sicurezza Wazuh selezionati, per il tenant corrente.
 *
 *   GET   → elenco eventi + conteggi per categoria (filtri: category, onlyOpen)
 *   POST  → forza un poll immediato dell'indexer
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { ALERT_CATEGORIES } from "@/lib/integrations/wazuh-alerts";
import {
  countOpenByCategory,
  ensureWazuhAlertSchema,
  getAlertSyncState,
  listAlertEvents,
  tenantDb,
} from "@/lib/integrations/wazuh-alerts-db";
import { syncWazuhAlertsForTenant } from "@/lib/integrations/wazuh-alerts-sync";

const QuerySchema = z.object({
  category: z.string().max(40).optional(),
  onlyOpen: z.enum(["0", "1"]).optional(),
  includeDiagnostic: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const q = parsed.data;

    const db = tenantDb();
    ensureWazuhAlertSchema(db);

    return NextResponse.json({
      categories: ALERT_CATEGORIES.map((c) => ({
        id: c.id,
        labelIt: c.labelIt,
        diagnostic: c.diagnostic === true,
      })),
      openByCategory: countOpenByCategory(db),
      syncState: getAlertSyncState(db),
      events: listAlertEvents(db, {
        category: q.category,
        onlyOpen: q.onlyOpen === "1",
        includeDiagnostic: q.includeDiagnostic === "0" ? false : undefined,
        limit: q.limit ?? 200,
        offset: q.offset ?? 0,
      }),
    });
  });
}

export async function POST() {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    try {
      const result = await syncWazuhAlertsForTenant();
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json(
        { error: `Poll alert Wazuh fallito: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  });
}
