/**
 * Poll periodico degli alert Wazuh selezionati → event store tenant.
 *
 * Riprende dal cursore search_after salvato: senza, ogni giro rileggerebbe la
 * stessa finestra su un indice che sul campo supera i 390M documenti.
 */

import type { Database } from "better-sqlite3";
import { createWazuhIndexerClient, type WazuhIndexerConfig, type WazuhIndexerClient } from "./wazuh-indexer-api";
import { getWazuhConfig, isWazuhConfigured } from "./wazuh-config";
import { getImmutableStoreConfig } from "./immutable-store-api";
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
import { evaluateAndNotifyWazuhHealth } from "./wazuh-health-notify";

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

/** Minima superficie usata dal sync: solo `searchAlerts`. Lascia ai test di
 *  iniettare un fake senza implementare l'intera `WazuhIndexerClient` (stesso
 *  pattern di `MeshControlClientLike` in meshcentral/mesh-sync.ts). */
export interface AlertsIndexerClientLike {
  searchAlerts: WazuhIndexerClient["searchAlerts"];
}

/** Test-only: inject a fake indexer client factory. Pass `null` to restore the real one
 *  (stesso pattern di `_setControlClientFactory` in meshcentral/mesh-sync.ts — niente
 *  `mock.module`, non supportato sotto Node22+tsx). */
let indexerClientFactory: ((cfg: WazuhIndexerConfig) => AlertsIndexerClientLike | null) | null = null;
export function _setWazuhIndexerClientFactory(
  f: ((cfg: WazuhIndexerConfig) => AlertsIndexerClientLike | null) | null,
): void {
  indexerClientFactory = f;
}

/** Test-only: inject a fake valutatore di salute. Pass `null` per ripristinare quello vero. */
let healthEvaluator: typeof evaluateAndNotifyWazuhHealth | null = null;
export function _setHealthEvaluator(f: typeof evaluateAndNotifyWazuhHealth | null): void {
  healthEvaluator = f;
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
  const tenantCode = getCurrentTenantCode() ?? "DA-IPAM";

  // La valutazione della salute (manager/indexer/ingestione/repliche) deve
  // avvenire SEMPRE, indipendentemente dall'esito del sync degli alert:
  // altrimenti un'interruzione dell'indexer produce zero notifiche di salute
  // (nè durante il guasto nè dopo), e un tenant con solo le repliche
  // configurate ma senza credenziali indexer non le riceverebbe mai (era il
  // bug: la valutazione viveva dentro il try del sync, dopo searchAlerts, e
  // i return "skipped" la saltavano del tutto). Si salta solo quando non c'è
  // proprio nulla da valutare: nè Wazuh nè l'endpoint delle repliche sono
  // configurati (i quattro blocchi risulterebbero tutti "non configurato").
  const healthRelevant = isWazuhConfigured() || getImmutableStoreConfig() !== null;

  async function evaluateHealthSafely(): Promise<void> {
    if (!healthRelevant) return;
    // Try/catch proprio: un problema qui non deve mascherare l'esito del
    // sync già deciso sopra (return o throw). evaluateAndNotifyWazuhHealth
    // ha già il proprio try/catch interno, questo è un ulteriore livello di
    // difesa.
    try {
      await (healthEvaluator ?? evaluateAndNotifyWazuhHealth)(tenantCode);
    } catch (e) {
      console.error("[wazuh-health] notifiche di salute fallite:", (e as Error).message);
    }
  }

  try {
    if (!cfg.enabled) return { skipped: true, reason: "integrazione disabilitata", ...empty };
    if (!cfg.indexerUrl || !cfg.indexerUsername || !cfg.indexerPassword) {
      return { skipped: true, reason: "indexer non configurato", ...empty };
    }

    const client = (indexerClientFactory ?? createWazuhIndexerClient)({
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
        deviceRuleIds: cfg.deviceRuleIds,
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

      const notified = await notifyPendingEvents(db, tenantCode);

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
  } finally {
    await evaluateHealthSafely();
  }
}
