/**
 * Segnali operativi presi dagli alert Wazuh gia' raccolti, per arricchire il
 * report AD Health.
 *
 * AD Health fotografa la configurazione LDAP; Wazuh registra cosa succede
 * davvero. Tenendoli separati il report dice "la soglia di lockout e' a zero"
 * ma non "e sono in corso 1.500 tentativi falliti al giorno" — che e' la parte
 * che fa capire l'urgenza.
 *
 * Accoppiamento volutamente lasco: se la tabella non esiste (Wazuh mai
 * configurato) si torna `available: false` e le regole tacciono. Mai dedurre
 * "nessun problema" da "nessun dato".
 */

import type { Database } from "better-sqlite3";

/** Finestra di osservazione predefinita. */
export const SIGNALS_WINDOW_DAYS = 7;
/** Quanti account bersaglio riportare nel finding. */
const TOP_TARGETS = 10;

export interface WazuhAuthTarget {
  targetUser: string | null;
  agentName: string | null;
  occurrences: number;
  lastSeenAt: string;
}

export interface WazuhSignals {
  /** false = tabella assente: nessuna conclusione possibile. */
  available: boolean;
  windowDays: number;
  authFailureOccurrences: number;
  authFailureTargets: WazuhAuthTarget[];
  /** Event ID 4740 osservati nella finestra. */
  lockoutOccurrences: number;
}

function emptySignals(windowDays: number, available: boolean): WazuhSignals {
  return {
    available,
    windowDays,
    authFailureOccurrences: 0,
    authFailureTargets: [],
    lockoutOccurrences: 0,
  };
}

export function collectWazuhSignals(
  db: Database,
  opts?: { windowDays?: number },
): WazuhSignals {
  const windowDays = opts?.windowDays ?? SIGNALS_WINDOW_DAYS;
  const since = `-${Math.max(1, Math.floor(windowDays))} days`;

  const exists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wazuh_alert_event'",
    )
    .get();
  if (!exists) return emptySignals(windowDays, false);

  try {
    const total = db
      .prepare(
        `SELECT COALESCE(SUM(occurrence_count), 0) AS n
           FROM wazuh_alert_event
          WHERE category = 'auth_failure' AND last_seen_at >= datetime('now', ?)`,
      )
      .get(since) as { n: number };

    const targets = db
      .prepare(
        `SELECT target_user, agent_name, SUM(occurrence_count) AS occurrences,
                MAX(last_seen_at) AS last_seen_at
           FROM wazuh_alert_event
          WHERE category = 'auth_failure' AND last_seen_at >= datetime('now', ?)
          GROUP BY target_user, agent_name
          ORDER BY occurrences DESC
          LIMIT ?`,
      )
      .all(since, TOP_TARGETS) as Array<{
      target_user: string | null;
      agent_name: string | null;
      occurrences: number;
      last_seen_at: string;
    }>;

    const lockouts = db
      .prepare(
        `SELECT COALESCE(SUM(occurrence_count), 0) AS n
           FROM wazuh_alert_event
          WHERE event_id = '4740' AND last_seen_at >= datetime('now', ?)`,
      )
      .get(since) as { n: number };

    return {
      available: true,
      windowDays,
      authFailureOccurrences: total.n,
      authFailureTargets: targets.map((t) => ({
        targetUser: t.target_user,
        agentName: t.agent_name,
        occurrences: t.occurrences,
        lastSeenAt: t.last_seen_at,
      })),
      lockoutOccurrences: lockouts.n,
    };
  } catch {
    // Schema piu' vecchio o query non eseguibile: meglio dichiararsi ciechi
    return emptySignals(windowDays, false);
  }
}
