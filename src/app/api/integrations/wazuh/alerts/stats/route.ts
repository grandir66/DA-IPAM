/**
 * KPI, distribuzione temporale e composizione degli alert di sicurezza.
 *
 * I conteggi nel tempo arrivano dall'indexer (aggregazione, nessun documento
 * scaricato); lo stato di presa in carico viene dall'event store locale.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { createWazuhIndexerClient } from "@/lib/integrations/wazuh-indexer-api";
import {
  STATS_WINDOWS,
  bucketIntervalFor,
  sinceForWindow,
  windowById,
} from "@/lib/integrations/wazuh-alerts-stats";
import {
  countOpenByCategory,
  ensureWazuhAlertSchema,
  getAlertSyncState,
  tenantDb,
} from "@/lib/integrations/wazuh-alerts-db";
import { collectSelfIdentity } from "@/lib/integrations/self-identity";

const QuerySchema = z.object({ window: z.string().max(10).optional() });

export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const win = windowById(parsed.data.window ?? "24h") ?? STATS_WINDOWS[0]!;

    const db = tenantDb();
    ensureWazuhAlertSchema(db);
    const openByCategory = countOpenByCategory(db);
    const openTotal = Object.values(openByCategory).reduce((a, b) => a + b, 0);

    const base = {
      windows: STATS_WINDOWS,
      window: win.id,
      interval: bucketIntervalFor(win.hours),
      openByCategory,
      openTotal,
      syncState: getAlertSyncState(db),
    };

    const cfg = getWazuhConfig();
    const client =
      cfg.enabled && cfg.indexerUrl
        ? createWazuhIndexerClient({
            url: cfg.indexerUrl,
            username: cfg.indexerUsername,
            password: cfg.indexerPassword,
            verifyTls: cfg.verifyTls,
          })
        : null;

    if (!client) {
      // Senza indexer la pagina resta usabile: tabella e conteggi locali.
      return NextResponse.json({
        ...base,
        stats: null,
        unavailable: "Indexer Wazuh non configurato",
      });
    }

    const self = collectSelfIdentity(db);
    try {
      const stats = await client.alertStats({
        since: sinceForWindow(win.hours),
        interval: bucketIntervalFor(win.hours),
        // I nostri account di servizio non sono "bersagliati": toglierli evita
        // che una nostra credenziale scaduta finisca in cima alla classifica.
        excludeAccounts: self.accounts,
        excludeIps: self.ips,
      });
      return NextResponse.json({ ...base, stats });
    } catch (e) {
      return NextResponse.json({
        ...base,
        stats: null,
        unavailable: `Indexer non raggiungibile: ${(e as Error).message}`,
      });
    }
  });
}
