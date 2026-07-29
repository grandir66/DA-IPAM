/**
 * Notifiche di salute Wazuh con anti-rumore.
 *
 * Senza questa logica un blocco "fail" persistente (es. disco pieno) manderebbe
 * un'email a ogni giro di sync: `decideNotification` decide quando un cambio di
 * stato merita davvero di avvisare qualcuno, secondo tre regole:
 *  - una TRANSIZIONE (nuovo guasto, o peggioramento) notifica subito;
 *  - lo stesso guasto persistente notifica di nuovo solo dopo
 *    `REPEAT_AFTER_HOURS` ore dall'ultimo avviso (RIPETIZIONE) — altrimenti
 *    il canale diventerebbe rumore da ignorare;
 *  - il RIENTRO a "ok" da uno stato non-ok notifica la chiusura, così chi ha
 *    ricevuto l'allarme sa quando è finita.
 *
 * Lo stato precedente vive in `wazuh_health_state`, il cui schema è definito
 * qui (stesso pattern di `wazuh_alert_sync_state` in wazuh-alerts-db.ts:
 * `CREATE TABLE IF NOT EXISTS` idempotente accanto al codice che lo usa,
 * NON in db-tenant-schema.ts — così il modulo resta testabile su :memory: e
 * coerente con il resto dell'integrazione Wazuh).
 *
 * L'invio riusa `dispatchNotification` da `notifications/notifier.ts`, lo
 * stesso fan-out SMTP/webhook già impiegato da `wazuh-alerts-sync.ts`: nessun
 * client SMTP nuovo. Il canale webhook, come già fa `sendTestNotification` per
 * i messaggi non legati a un `NotifiableEvent`, riceve una lista eventi vuota:
 * il payload JSON porta comunque kind/tenant/generatedAt, solo senza il
 * dettaglio strutturato degli alert (che non ha senso per un blocco di
 * salute). Il testo del messaggio SMTP resta completo.
 */

import type { Database } from "better-sqlite3";
import { getTenantDb } from "../db-tenant";
import { getWazuhHealth } from "./wazuh-health";
import type { BlockHealth, HealthVerdict } from "./wazuh-health-thresholds";
import { getNotificationConfig } from "../notifications/config";
import { dispatchNotification } from "../notifications/notifier";
import type { NotificationMessage } from "../notifications/policy";

/** Ore da attendere prima di ripetere una notifica per lo stesso guasto persistente. */
export const REPEAT_AFTER_HOURS = 6;

export interface NotifyDecision {
  notify: boolean;
  reason: "transizione" | "ripetizione" | "rientro" | "nessuna";
}

/**
 * Decide se un blocco di salute merita una notifica, confrontando il
 * verdetto attuale con lo stato precedentemente noto. Pura: nessun I/O,
 * nessuna eccezione — solo così è testabile senza aprire un DB.
 */
export function decideNotification(
  precedente: { verdict: string; lastNotifiedAtMs: number | null } | null,
  attuale: HealthVerdict,
  nowMs: number,
): NotifyDecision {
  if (attuale === "ok") {
    // Rientro alla normalità: notifica la chiusura solo se prima NON era ok.
    if (precedente !== null && precedente.verdict !== "ok") {
      return { notify: true, reason: "rientro" };
    }
    return { notify: false, reason: "nessuna" };
  }

  // Da qui `attuale` è "degraded" o "fail": una condizione di guasto/allerta.
  if (precedente === null || precedente.verdict !== attuale) {
    // Primo rilevamento del guasto, o peggioramento/variazione rispetto a
    // prima (es. degraded → fail): notifica subito.
    return { notify: true, reason: "transizione" };
  }

  // Stesso guasto della rilevazione precedente. Se non è mai stato
  // comunicato (es. tutti i canali erano giù al giro scorso), si ritenta ora.
  if (precedente.lastNotifiedAtMs === null) {
    return { notify: true, reason: "transizione" };
  }

  const elapsedMs = nowMs - precedente.lastNotifiedAtMs;
  if (elapsedMs >= REPEAT_AFTER_HOURS * 3_600_000) {
    return { notify: true, reason: "ripetizione" };
  }
  return { notify: false, reason: "nessuna" };
}

export function ensureWazuhHealthSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wazuh_health_state (
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
    .prepare("SELECT * FROM wazuh_health_state WHERE block = ?")
    .get(block) as HealthStateRow | undefined;
}

/**
 * Salva il verdetto/headline correnti. `last_changed_at` avanza solo se il
 * verdetto è cambiato rispetto al giro precedente; `last_notified_at` solo se
 * questo giro ha effettivamente inviato una notifica (usa sempre l'orologio
 * di SQLite, mai `Date.now()` lato Node, per restare coerente col resto del
 * modulo — stesso criterio di `markDigestSent` in wazuh-alerts-db.ts).
 */
function saveHealthState(
  db: Database,
  block: string,
  verdict: HealthVerdict,
  headline: string,
  verdictChanged: boolean,
  notified: boolean,
): void {
  db.prepare(
    `INSERT INTO wazuh_health_state (block, verdict, headline, last_changed_at, last_notified_at)
     VALUES (?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE NULL END)
     ON CONFLICT(block) DO UPDATE SET
       verdict = excluded.verdict,
       headline = excluded.headline,
       last_changed_at = CASE WHEN ? THEN datetime('now') ELSE wazuh_health_state.last_changed_at END,
       last_notified_at = CASE WHEN ? THEN datetime('now') ELSE wazuh_health_state.last_notified_at END`,
  ).run(block, verdict, headline, notified ? 1 : 0, verdictChanged ? 1 : 0, notified ? 1 : 0);
}

const BLOCK_LABELS: Record<BlockHealth["key"], string> = {
  manager: "Manager Wazuh",
  indexer: "Indexer Wazuh",
  ingestion: "Ingestione eventi",
  replication: "Repliche/archiviazione",
};

const VERDICT_LABELS: Record<HealthVerdict, string> = {
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

/**
 * Compone il messaggio di notifica per un blocco di salute. Mai un URL con
 * token: solo nome del blocco, verdetto ed headline (già priva di segreti,
 * vedi wazuh-health-thresholds.ts).
 */
function buildHealthMessage(
  block: BlockHealth,
  tenant: string,
  reason: NotifyDecision["reason"],
): NotificationMessage {
  const label = BLOCK_LABELS[block.key];
  const verdictLabel = VERDICT_LABELS[block.verdict];
  return {
    subject: `[${tenant}] Salute Wazuh: ${label} — ${verdictLabel}`,
    text:
      `Cambio di stato nel cruscotto salute Wazuh (${REASON_LABELS[reason]}).\n\n` +
      `Blocco: ${label}\n` +
      `Stato: ${verdictLabel}\n` +
      `Dettaglio: ${block.headline}\n\n` +
      `Apri DA-IPAM → Salute Wazuh per il dettaglio completo.`,
  };
}

/**
 * Valuta i quattro blocchi di salute Wazuh del tenant e invia le notifiche
 * dovute secondo `decideNotification`. Non lancia mai: un problema qui non
 * deve interrompere il chiamante (il sync degli alert).
 */
export async function evaluateAndNotifyWazuhHealth(
  tenantCode: string,
): Promise<{ notified: number }> {
  const out = { notified: 0 };
  try {
    const cfg = getNotificationConfig();
    if (!cfg.enabled) return out;

    const db = getTenantDb(tenantCode);
    ensureWazuhHealthSchema(db);

    const health = await getWazuhHealth(tenantCode, { force: true });
    const now = Date.now();

    for (const block of health.blocks) {
      // Non configurato = non è un guasto, non genera notifiche.
      if (!block.configured) continue;

      const prevRow = getHealthState(db, block.key);
      const precedente = prevRow
        ? { verdict: prevRow.verdict, lastNotifiedAtMs: parseSqliteDatetime(prevRow.last_notified_at) }
        : null;

      const decision = decideNotification(precedente, block.verdict, now);

      let notified = false;
      if (decision.notify) {
        const message = buildHealthMessage(block, tenantCode, decision.reason);
        const results = await dispatchNotification({
          kind: "immediate",
          message,
          events: [],
          tenant: tenantCode,
        });
        // Solo se almeno un canale ha accettato: altrimenti si ritenta al
        // prossimo giro (stesso criterio di wazuh-alerts-sync.ts).
        notified = results.some((r) => r.ok);
      }

      saveHealthState(
        db,
        block.key,
        block.verdict,
        block.headline,
        prevRow?.verdict !== block.verdict,
        notified,
      );
      if (notified) out.notified++;
    }

    return out;
  } catch (e) {
    console.error("[wazuh-health] valutazione notifiche fallita:", (e as Error).message);
    return out;
  }
}
