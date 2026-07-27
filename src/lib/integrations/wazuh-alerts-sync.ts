/**
 * Poll periodico degli alert Wazuh selezionati → event store tenant.
 *
 * Riprende dal cursore search_after salvato: senza, ogni giro rileggerebbe la
 * stessa finestra su un indice che sul campo supera i 390M documenti.
 */

import { createWazuhIndexerClient } from "./wazuh-indexer-api";
import { getWazuhConfig } from "./wazuh-config";
import {
  ensureWazuhAlertSchema,
  getAlertSyncState,
  setAlertSyncState,
  tenantDb,
  upsertAlertEvent,
} from "./wazuh-alerts-db";

/** Finestra iniziale al primo run, quando non esiste ancora un cursore. */
const DEFAULT_LOOKBACK_HOURS = 24;
/** Tetto per run: protegge sia la memoria sia l'indexer del cliente. */
const DEFAULT_MAX_ROWS = 2_000;

export interface WazuhAlertsSyncResult {
  skipped: boolean;
  reason?: string;
  fetched: number;
  opened: number;
  updated: number;
  ignored: number;
}

export async function syncWazuhAlertsForTenant(opts?: {
  maxRows?: number;
  lookbackHours?: number;
  minLevel?: number;
}): Promise<WazuhAlertsSyncResult> {
  const empty = { fetched: 0, opened: 0, updated: 0, ignored: 0 };
  const cfg = getWazuhConfig();
  if (!cfg.enabled) return { skipped: true, reason: "integrazione disabilitata", ...empty };
  if (!cfg.indexerUrl || !cfg.indexerUsername || !cfg.indexerPassword) {
    return { skipped: true, reason: "indexer non configurato", ...empty };
  }

  const client = createWazuhIndexerClient({
    url: cfg.indexerUrl,
    username: cfg.indexerUsername,
    password: cfg.indexerPassword,
    verifyTls: cfg.verifyTls,
  });
  if (!client) return { skipped: true, reason: "client indexer non creato", ...empty };

  const db = tenantDb();
  ensureWazuhAlertSchema(db);
  const state = getAlertSyncState(db);

  const lookback = opts?.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  const since =
    state.lastTimestamp ?? new Date(Date.now() - lookback * 3_600_000).toISOString();

  try {
    const { alerts, nextCursor } = await client.searchAlerts({
      since,
      minLevel: opts?.minLevel ?? 8,
      maxRows: opts?.maxRows ?? DEFAULT_MAX_ROWS,
      searchAfter: state.cursor ?? undefined,
    });

    let opened = 0;
    let updated = 0;
    let ignored = 0;
    let maxTs = state.lastTimestamp;

    const apply = db.transaction(() => {
      for (const a of alerts) {
        const r = upsertAlertEvent(db, a);
        if (r.skipped) ignored++;
        else if (r.created) opened++;
        else updated++;
        if (!maxTs || a.timestamp > maxTs) maxTs = a.timestamp;
      }
    });
    apply();

    setAlertSyncState(db, {
      lastTimestamp: maxTs ?? since,
      cursor: nextCursor,
      lastError: null,
    });

    return { skipped: false, fetched: alerts.length, opened, updated, ignored };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Il cursore resta invariato: il prossimo giro riprova la stessa finestra.
    setAlertSyncState(db, { cursor: state.cursor, lastError: message });
    throw err;
  }
}
