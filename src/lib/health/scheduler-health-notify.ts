/**
 * Notifica quando lo scheduler smette di funzionare — allarme, non dashboard.
 *
 * PERCHE' ESISTE: il 2026-09-02, per 4h40, TUTTI i job del tenant 70791
 * sull'appliance Domarc sono falliti (340 esecuzioni) e **nessun allarme e'
 * scattato**. Il processo rispondeva, il DB era sano, la UI non segnalava
 * niente: il guasto era visibile solo a chi fosse andato a leggere il log.
 *
 * `scheduler-freshness.ts` calcolava gia' la condizione, e `/api/health?strict=1`
 * la esponeva — ma nessuno le guardava. Qui si chiude l'anello, con lo stesso
 * mestiere di `modules/appliance-health-notify.ts` (nato dall'incident gemello
 * del 2026-07-28, disco al 100% inosservato per giorni): cron indipendente
 * dalla UI, anti-rumore condiviso via `decideNotification` (transizione ->
 * subito, guasto persistente -> ripetizione, rientro -> avviso di chiusura) e
 * fan-out SMTP/webhook via `dispatchNotification`.
 *
 * La sorgente e' `scheduled_jobs.last_run`, cioe' il DATABASE — non uno stato in
 * memoria. Scelta deliberata: l'incidente del 2026-09-02 nasceva da due istanze
 * dello stesso modulo nel processo, e un allarme che vivesse in memoria
 * potrebbe trovarsi nell'istanza sbagliata proprio quando serve. Un job che
 * fallisce non aggiorna `last_run`, quindi la stessa lettura copre entrambi i
 * casi: job che non partono e job che partono e falliscono.
 */

import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import {
  findStaleJobs,
  type SchedulerJobRow,
} from "@/lib/health/scheduler-freshness";
import {
  decideNotification,
  REPEAT_AFTER_HOURS,
  type NotifyDecision,
} from "@/lib/integrations/wazuh-health-notify";
import { ensureApplianceHealthSchema } from "@/lib/modules/appliance-health-notify";
import { getNotificationConfig } from "@/lib/notifications/config";
import { dispatchNotification } from "@/lib/notifications/notifier";
import type { ModuleVerdict } from "@/lib/modules/health";
import type { NotificationMessage } from "@/lib/notifications/policy";

/**
 * Da quanti job fermi in su si parla di blocco totale invece di singole
 * integrazioni in ritardo. Sotto questa soglia, "tutti fermi" su un tenant con
 * due soli job sarebbe un allarme grave per un fatto piccolo.
 */
export const OUTAGE_MIN_JOBS = 3;

/** Chiave usata in `appliance_health_state` (tabella condivisa, una riga per blocco). */
export const SCHEDULER_BLOCK = "scheduler";

/**
 * Verdetto sullo scheduler. PURA: righe e orologio arrivano dal chiamante, così
 * è testabile senza DB e senza aspettare.
 *
 * - `fail`      → sono fermi TUTTI i job del tenant (ed è più di una manciata):
 *                 la causa è comune, non di una singola integrazione.
 * - `degraded`  → alcuni job sono fermi: probabile guasto localizzato.
 * - `ok`        → nessun job fermo, oppure nessun job attivo da guardare.
 */
export function composeSchedulerVerdict(
  rows: SchedulerJobRow[],
  nowMs: number,
): { verdict: ModuleVerdict; headline: string } {
  const enabled = rows.filter((r) => r.enabled);
  if (enabled.length === 0) {
    return { verdict: "ok", headline: "nessun job attivo da sorvegliare" };
  }

  const stale = findStaleJobs(rows, nowMs);
  if (stale.length === 0) {
    return { verdict: "ok", headline: `${enabled.length} job attivi, tutti nei tempi` };
  }

  const worst = stale[0];
  const ritardo = `il piu' in ritardo di ${worst.overdueMinutes} min (${worst.jobType})`;
  const totale = stale.length === enabled.length && enabled.length >= OUTAGE_MIN_JOBS;

  if (totale) {
    return {
      verdict: "fail",
      headline:
        `tutti i ${enabled.length} job del cliente sono fermi — ${ritardo}. ` +
        "Una causa comune a tutti i job non e' un'integrazione rotta: " +
        "verificare il processo (log 'CONTESTO TENANT CORROTTO', riavvio del servizio)",
    };
  }

  return {
    verdict: "degraded",
    headline: `${stale.length} job su ${enabled.length} sono fermi — ${ritardo}`,
  };
}

const VERDICT_LABELS: Record<ModuleVerdict, string> = {
  ok: "OK",
  degraded: "degradato",
  fail: "bloccato",
};

const REASON_LABELS: Record<NotifyDecision["reason"], string> = {
  transizione: "cambio di stato",
  ripetizione: `persiste da oltre ${REPEAT_AFTER_HOURS} ore`,
  rientro: "rientro alla normalità",
  nessuna: "",
};

/** Messaggio senza segreti: verdetto, conteggi e ritardo. Nessuna credenziale, nessun IP. */
export function buildSchedulerHealthMessage(
  verdict: ModuleVerdict,
  headline: string,
  tenant: string,
  reason: NotifyDecision["reason"],
): NotificationMessage {
  return {
    subject: `[${tenant}] Sincronizzazioni — ${VERDICT_LABELS[verdict]}`,
    text:
      `Stato delle sincronizzazioni schedulate (${REASON_LABELS[reason]}).\n\n` +
      `Stato: ${VERDICT_LABELS[verdict]}\n` +
      `Dettaglio: ${headline}\n\n` +
      "Apri DA-IPAM → Impostazioni → Job schedulati per il dettaglio, " +
      "oppure interroga /api/health?strict=1 sulla macchina.",
  };
}

/**
 * Valuta lo scheduler per il tenant e notifica secondo `decideNotification`.
 * Non lancia mai: un problema qui non deve fermare il cron che la invoca.
 * Da chiamare DENTRO `withTenant(tenantCode, ...)` — `getNotificationConfig()`
 * legge il contesto tenant corrente.
 */
export async function evaluateAndNotifySchedulerHealth(
  tenantCode: string,
): Promise<{ notified: number }> {
  const out = { notified: 0 };
  try {
    const cfg = getNotificationConfig();
    if (!cfg.enabled) return out;

    const db = getTenantDb(tenantCode);
    ensureApplianceHealthSchema(db);

    const rows = db
      .prepare(
        `SELECT job_type, interval_minutes, last_run, created_at, enabled
           FROM scheduled_jobs`,
      )
      .all() as SchedulerJobRow[];

    const { verdict, headline } = composeSchedulerVerdict(rows, Date.now());

    const prevRow = db
      .prepare("SELECT verdict, last_notified_at FROM appliance_health_state WHERE block = ?")
      .get(SCHEDULER_BLOCK) as { verdict: string; last_notified_at: string | null } | undefined;

    const precedente = prevRow
      ? {
          verdict: prevRow.verdict,
          lastNotifiedAtMs: prevRow.last_notified_at
            ? Date.parse(prevRow.last_notified_at.replace(" ", "T") + "Z") || null
            : null,
        }
      : null;

    const decision = decideNotification(precedente, verdict, Date.now());

    let notified = false;
    if (decision.notify) {
      const results = await dispatchNotification({
        kind: "immediate",
        message: buildSchedulerHealthMessage(verdict, headline, tenantCode, decision.reason),
        events: [],
        tenant: tenantCode,
      });
      // Solo se almeno un canale ha accettato: altrimenti si ritenta al giro
      // successivo (stesso criterio di appliance-health-notify.ts).
      notified = results.some((r) => r.ok);
      if (notified) out.notified += 1;
    }

    db.prepare(
      `INSERT INTO appliance_health_state (block, verdict, headline, last_changed_at, last_notified_at)
       VALUES (?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE NULL END)
       ON CONFLICT(block) DO UPDATE SET
         verdict = excluded.verdict,
         headline = excluded.headline,
         last_changed_at = CASE WHEN ? THEN datetime('now') ELSE appliance_health_state.last_changed_at END,
         last_notified_at = CASE WHEN ? THEN datetime('now') ELSE appliance_health_state.last_notified_at END`,
    ).run(
      SCHEDULER_BLOCK,
      verdict,
      headline,
      notified ? 1 : 0,
      prevRow?.verdict !== verdict ? 1 : 0,
      notified ? 1 : 0,
    );
  } catch (e) {
    console.error(`[scheduler-health] valutazione tenant ${tenantCode} fallita:`, e);
  }
  return out;
}

let task: ReturnType<typeof cron.schedule> | null = null;

/** Cron ogni 30 minuti su tutti i tenant attivi. Idempotente. */
export function initializeSchedulerHealthNotifier(): void {
  if (task) return;
  task = cron.schedule("*/30 * * * *", async () => {
    for (const tenant of getActiveTenants()) {
      const code = tenant.codice_cliente;
      try {
        await withTenant(code, () => evaluateAndNotifySchedulerHealth(code));
      } catch (e) {
        console.error(`[scheduler-health] tenant ${code}:`, e);
      }
    }
  });
}
