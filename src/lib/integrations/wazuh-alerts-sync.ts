/**
 * Poll periodico degli alert Wazuh selezionati → event store tenant.
 *
 * Riprende dal cursore search_after salvato: senza, ogni giro rileggerebbe la
 * stessa finestra su un indice che sul campo supera i 390M documenti.
 */

import type { Database } from "better-sqlite3";
import { createWazuhIndexerClient } from "./wazuh-indexer-api";
import { getWazuhConfig } from "./wazuh-config";
import { getCurrentTenantCode } from "../db-tenant";
import { collectSelfIdentity } from "./self-identity";
import { getNotificationConfig } from "../notifications/config";
import { dispatchNotification } from "../notifications/notifier";
import {
  buildDigestMessage,
  buildImmediateMessage,
  shouldNotifyImmediately,
  type NotifiableEvent,
} from "../notifications/policy";
import {
  ensureWazuhAlertSchema,
  getAlertSyncState,
  listUnnotifiedEvents,
  markDigestSent,
  markEventsNotified,
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
  notifiedImmediate: number;
  notifiedDigest: number;
}

function digestDue(lastDigestAt: string | null, intervalMinutes: number): boolean {
  if (!lastDigestAt) return true;
  const last = Date.parse(lastDigestAt.replace(" ", "T") + "Z");
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= intervalMinutes * 60_000;
}

/**
 * Notifica gli eventi aperti non ancora comunicati.
 *
 * Non lancia mai: un canale rotto non deve far fallire il sync, altrimenti il
 * cursore non avanza e si perde la raccolta per colpa di un SMTP giù.
 */
async function notifyPendingEvents(
  db: Database,
  tenant: string,
): Promise<{ immediate: number; digest: number }> {
  const out = { immediate: 0, digest: 0 };
  try {
    const cfg = getNotificationConfig();
    if (!cfg.enabled) return out;

    const pending = listUnnotifiedEvents(db) as unknown as NotifiableEvent[];
    if (pending.length === 0) return out;

    const immediate = pending.filter((e) => shouldNotifyImmediately(e, cfg.policy));
    for (const e of immediate) {
      const results = await dispatchNotification({
        kind: "immediate",
        message: buildImmediateMessage(e, tenant),
        events: [e],
        tenant,
      });
      // Marca come notificato solo se almeno un canale ha accettato: altrimenti
      // l'evento resta in coda e riparte al giro dopo.
      if (results.some((r) => r.ok)) {
        markEventsNotified(db, [e.id]);
        out.immediate++;
      }
    }

    const state = getAlertSyncState(db);
    if (!digestDue(state.lastDigestAt, cfg.policy.digestIntervalMinutes)) return out;

    const immediateIds = new Set(immediate.map((e) => e.id));
    const rest = pending.filter((e) => !immediateIds.has(e.id));
    const message = buildDigestMessage(rest, tenant);
    if (!message) return out;

    const results = await dispatchNotification({
      kind: "digest",
      message,
      events: rest,
      tenant,
    });
    if (results.some((r) => r.ok)) {
      markEventsNotified(db, rest.map((e) => e.id));
      markDigestSent(db);
      out.digest = rest.length;
    }
    return out;
  } catch (e) {
    console.error("[wazuh-alerts] invio notifiche fallito:", (e as Error).message);
    return out;
  }
}

export async function syncWazuhAlertsForTenant(opts?: {
  maxRows?: number;
  lookbackHours?: number;
  minLevel?: number;
}): Promise<WazuhAlertsSyncResult> {
  const empty = {
    fetched: 0,
    opened: 0,
    updated: 0,
    ignored: 0,
    notifiedImmediate: 0,
    notifiedDigest: 0,
  };
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
      minLevel: opts?.minLevel,
      maxRows: opts?.maxRows ?? DEFAULT_MAX_ROWS,
      searchAfter: state.cursor ?? undefined,
      // Le nostre stesse sonde non devono comparire come attacco
      self: collectSelfIdentity(db),
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

    const notified = await notifyPendingEvents(db, getCurrentTenantCode() ?? "DA-IPAM");

    return {
      skipped: false,
      fetched: alerts.length,
      opened,
      updated,
      ignored,
      notifiedImmediate: notified.immediate,
      notifiedDigest: notified.digest,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Il cursore resta invariato: il prossimo giro riprova la stessa finestra.
    setAlertSyncState(db, { cursor: state.cursor, lastError: message });
    throw err;
  }
}
