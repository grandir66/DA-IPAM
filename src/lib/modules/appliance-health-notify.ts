/**
 * Notifiche di salute dell'appliance (disco/Docker) con anti-rumore.
 *
 * Perché esiste: l'incident DTS 2026-07-28 (disco al 100%, build falliti in
 * silenzio per giorni) è passato inosservato proprio perché nessuno aveva la
 * dashboard aperta — il probe `appliance` in modules/health.ts rende il
 * problema VISIBILE, questo modulo lo rende RUMOROSO al momento giusto anche
 * ad appliance incustodita (cron ogni 30 minuti, indipendente dalla UI).
 *
 * Riusa per intero il criterio anti-rumore della salute Wazuh
 * (`decideNotification` in wazuh-health-notify.ts): transizione → subito,
 * guasto persistente → ripetizione dopo REPEAT_AFTER_HOURS, rientro → avviso
 * di chiusura. Lo stato precedente vive in `appliance_health_state` (stesso
 * pattern di `wazuh_health_state`: CREATE TABLE IF NOT EXISTS idempotente
 * accanto al codice che lo usa, NON in db-tenant-schema.ts, così il modulo
 * resta testabile su :memory:).
 *
 * L'invio riusa `dispatchNotification` (stesso fan-out SMTP/webhook di Wazuh):
 * la valutazione è per-tenant come per Wazuh — in pratica solo i tenant con
 * notifiche configurate producono avvisi, quindi niente duplicati sulle
 * installazioni tipiche a un tenant operativo.
 */

import cron from "node-cron";
import type { Database } from "better-sqlite3";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { getActiveTenants } from "@/lib/db-hub";
import { getModulesHealth } from "./health";
import type { ModuleVerdict } from "./health";
import {
  decideNotification,
  REPEAT_AFTER_HOURS,
  type NotifyDecision,
} from "@/lib/integrations/wazuh-health-notify";
import { getNotificationConfig } from "@/lib/notifications/config";
import { dispatchNotification } from "@/lib/notifications/notifier";
import type { NotificationMessage } from "@/lib/notifications/policy";

export function ensureApplianceHealthSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS appliance_health_state (
      block TEXT PRIMARY KEY,
      verdict TEXT NOT NULL,
      headline TEXT,
      last_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_notified_at TEXT
    );
  `);
}

interface HealthStateRow {
  block: string;
  verdict: string;
  headline: string | null;
  last_changed_at: string;
  last_notified_at: string | null;
}

/** Converte un `datetime('now')` di SQLite (UTC, senza `Z`) in millisecondi epoch. */
function parseSqliteDatetime(v: string | null): number | null {
  if (!v) return null;
  const ms = Date.parse(v.replace(" ", "T") + "Z");
  return Number.isNaN(ms) ? null : ms;
}

function getHealthState(db: Database, block: string): HealthStateRow | undefined {
  return db
    .prepare("SELECT * FROM appliance_health_state WHERE block = ?")
    .get(block) as HealthStateRow | undefined;
}

function saveHealthState(
  db: Database,
  block: string,
  verdict: ModuleVerdict,
  headline: string,
  verdictChanged: boolean,
  notified: boolean,
): void {
  db.prepare(
    `INSERT INTO appliance_health_state (block, verdict, headline, last_changed_at, last_notified_at)
     VALUES (?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE NULL END)
     ON CONFLICT(block) DO UPDATE SET
       verdict = excluded.verdict,
       headline = excluded.headline,
       last_changed_at = CASE WHEN ? THEN datetime('now') ELSE appliance_health_state.last_changed_at END,
       last_notified_at = CASE WHEN ? THEN datetime('now') ELSE appliance_health_state.last_notified_at END`,
  ).run(block, verdict, headline, notified ? 1 : 0, verdictChanged ? 1 : 0, notified ? 1 : 0);
}

const VERDICT_LABELS: Record<ModuleVerdict, string> = {
  ok: "OK",
  degraded: "degradato",
  fail: "in errore",
};

const REASON_LABELS: Record<NotifyDecision["reason"], string> = {
  transizione: "cambio di stato",
  ripetizione: `persiste da oltre ${REPEAT_AFTER_HOURS} ore`,
  rientro: "rientro alla normalità",
  nessuna: "",
};

/** Messaggio senza segreti: solo verdetto e headline (disco %/GB, stato Docker). */
export function buildApplianceHealthMessage(
  verdict: ModuleVerdict,
  headline: string,
  tenant: string,
  reason: NotifyDecision["reason"],
): NotificationMessage {
  return {
    subject: `[${tenant}] Sistema appliance — ${VERDICT_LABELS[verdict]}`,
    text:
      `Cambio di stato della macchina che ospita DA-IPAM (${REASON_LABELS[reason]}).\n\n` +
      `Stato: ${VERDICT_LABELS[verdict]}\n` +
      `Dettaglio: ${headline}\n\n` +
      `Apri DA-IPAM → Dashboard → Stato Moduli per il dettaglio.`,
  };
}

/**
 * Valuta il probe `appliance` per il tenant e notifica secondo
 * `decideNotification`. Non lancia mai: un problema qui non deve fermare il
 * cron che la invoca. Da chiamare DENTRO `withTenant(tenantCode, ...)`
 * (getNotificationConfig legge il contesto tenant corrente).
 */
export async function evaluateAndNotifyApplianceHealth(
  tenantCode: string,
): Promise<{ notified: number }> {
  const out = { notified: 0 };
  try {
    const cfg = getNotificationConfig();
    if (!cfg.enabled) return out;

    const db = getTenantDb(tenantCode);
    ensureApplianceHealthSchema(db);

    const rows = await getModulesHealth(tenantCode, { force: true, only: "appliance" });
    const health = rows[0];
    if (!health) return out;
    const headline = health.detail ?? "nessun dettaglio";

    const prevRow = getHealthState(db, "appliance");
    const precedente = prevRow
      ? { verdict: prevRow.verdict, lastNotifiedAtMs: parseSqliteDatetime(prevRow.last_notified_at) }
      : null;

    const decision = decideNotification(precedente, health.verdict, Date.now());

    let notified = false;
    if (decision.notify) {
      const message = buildApplianceHealthMessage(health.verdict, headline, tenantCode, decision.reason);
      const results = await dispatchNotification({
        kind: "immediate",
        message,
        events: [],
        tenant: tenantCode,
      });
      // Solo se almeno un canale ha accettato: altrimenti si ritenta al
      // prossimo giro (stesso criterio di wazuh-health-notify.ts).
      notified = results.some((r) => r.ok);
      if (notified) out.notified += 1;
    }

    saveHealthState(db, "appliance", health.verdict, headline, prevRow?.verdict !== health.verdict, notified);
  } catch (e) {
    console.error(`[appliance-health] valutazione tenant ${tenantCode} fallita:`, e);
  }
  return out;
}

let task: ReturnType<typeof cron.schedule> | null = null;

/** Cron ogni 30 minuti su tutti i tenant attivi. Idempotente. */
export function initializeApplianceHealthNotifier(): void {
  if (task) return;
  task = cron.schedule("*/30 * * * *", async () => {
    for (const tenant of getActiveTenants()) {
      const code = tenant.codice_cliente;
      try {
        await withTenant(code, () => evaluateAndNotifyApplianceHealth(code));
      } catch (e) {
        console.error(`[appliance-health] tenant ${code}:`, e);
      }
    }
  });
}
