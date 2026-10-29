/**
 * Alert di sicurezza Wazuh selezionati, per il tenant corrente.
 *
 *   GET   → elenco eventi + conteggi per categoria (filtri: category, onlyOpen,
 *           window = eventi visti nella finestra, system = rule.groups del sistema)
 *   POST  → forza un poll immediato dell'indexer e, dove si leggono, dei domain controller
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { ALERT_CATEGORIES } from "@/lib/integrations/wazuh-alerts";
import { sinceForWindow, systemFilterById, windowById } from "@/lib/integrations/wazuh-alerts-stats";
import {
  countOpenByCategory,
  ensureWazuhAlertSchema,
  getAlertSyncState,
  listAlertEvents,
  tenantDb,
} from "@/lib/integrations/wazuh-alerts-db";
import { syncWazuhAlertsForTenant } from "@/lib/integrations/wazuh-alerts-sync";
import { modoEventiDc, motivoPerNonLeggere, wazuhLeggeGliAllarmi } from "@/lib/security/eventi-dc/raccolta";
import { giroEventiDcDelContesto, testoEsitoDc } from "@/lib/security/eventi-dc/job";

const QuerySchema = z.object({
  category: z.string().max(40).optional(),
  onlyOpen: z.enum(["0", "1"]).optional(),
  includeDiagnostic: z.enum(["0", "1"]).optional(),
  window: z.string().max(10).optional(),
  system: z.string().max(20).optional(),
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

    const win = q.window ? windowById(q.window) : undefined;
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
        since: win ? sinceForWindow(win.hours) : undefined,
        groups: systemFilterById(q.system)?.match,
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
    // Senza Wazuh la fonte sono i DC (29/10): «Aggiorna ora» legge loro.
    const wazuh = wazuhLeggeGliAllarmi();
    const leggeDc = motivoPerNonLeggere(modoEventiDc(tenantDb()), wazuh) === null;
    try {
      if (!leggeDc) return NextResponse.json(await syncWazuhAlertsForTenant());
      const dc = await giroEventiDcDelContesto();
      const daWazuh = wazuh ? await syncWazuhAlertsForTenant() : null;
      const esito = testoEsitoDc(dc);
      if (!esito.ok && !daWazuh) {
        return NextResponse.json({ error: `Lettura dei DC non riuscita: ${esito.testo}` }, { status: 502 });
      }
      return NextResponse.json({
        skipped: false,
        fetched: dc.dc.reduce((n, d) => n + d.nuovi, 0) + (daWazuh?.fetched ?? 0),
        opened: dc.aperti + (daWazuh?.opened ?? 0),
        dc: esito.testo,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Aggiornamento degli allarmi fallito: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  });
}
