import type Database from "better-sqlite3";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { assicuraColonneMdmConfig } from "@/lib/db-tenant-schema";
import { encrypt, safeDecrypt } from "@/lib/crypto";

export interface MdmConfig {
  base_url: string | null;
  username: string | null;
  user_field: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  /** Ultimo tentativo di sincronizzazione, riuscito o no. */
  last_attempt_at: string | null;
  /** Ultima sincronizzazione riuscita. */
  last_success_at: string | null;
  /** Spenta da sola dopo `max_errori` errori di fila (non dall'admin). */
  auto_disabled: boolean;
  /** Gli errori di fila dopo cui si spegne: da Opzioni (`mdm.max_errori`), di serie MDM_MAX_ERRORI_CONSECUTIVI. */
  max_errori: number;
}

/** Errori di fila dopo cui l'MDM si spegne da solo (pattern vuln_scanners). */
export const MDM_MAX_ERRORI_CONSECUTIVI = 5;

/** Chiave e limiti del numero di errori di fila, che si cambia da Opzioni (23/10). */
export const CHIAVE_MDM_MAX_ERRORI = "mdm.max_errori";
export const LIMITI_MDM_MAX_ERRORI = { min: 1, max: 20 } as const;

/** Gli errori di fila dopo cui MDM si spegne da sola, per il cliente del contesto; illeggibile = di serie. */
export function mdmMaxErrori(): number {
  const r = db().prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_MDM_MAX_ERRORI) as { value: string } | undefined;
  const n = r ? parseInt(r.value, 10) : NaN;
  if (Number.isNaN(n)) return MDM_MAX_ERRORI_CONSECUTIVI;
  return Math.min(LIMITI_MDM_MAX_ERRORI.max, Math.max(LIMITI_MDM_MAX_ERRORI.min, n));
}

/** Intervallo del job `mdm_sync` creato all'accensione (minuti). */
export const MDM_SYNC_INTERVALLO_MINUTI = 60;

/** Cosa è successo al job `mdm_sync` salvando la configurazione. */
export type EsitoJobMdm = "creato" | "riacceso" | "invariato" | "rimosso" | "assente";

export interface EsitoSalvataggioMdm {
  job: EsitoJobMdm;
  /** Il salvataggio ha riacceso l'MDM: contatore degli errori azzerato. */
  riattivato: boolean;
}

/** Connessioni già migrate (colonne nuove di `mdm_config`): una verifica per connessione. */
const migrate = new WeakSet<Database.Database>();

function db(): Database.Database {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("mdm-config: no tenant context");
  const conn = getTenantDb(c);
  if (!migrate.has(conn)) {
    assicuraColonneMdmConfig(conn);
    migrate.add(conn);
  }
  return conn;
}

function testoONull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Config pubblica (la password NON è mai inclusa). */
export function getMdmConfig(): MdmConfig {
  const r = db()
    .prepare(
      `SELECT base_url, username, user_field, enabled, last_sync_at, last_error, consecutive_errors,
              last_attempt_at, last_success_at
       FROM mdm_config WHERE id=1`,
    )
    .get() as Record<string, unknown> | undefined;
  const enabled = !!r?.enabled;
  const consecutive = typeof r?.consecutive_errors === "number" ? r.consecutive_errors : 0;
  return {
    base_url: testoONull(r?.base_url),
    username: testoONull(r?.username),
    user_field: testoONull(r?.user_field) ?? "description",
    enabled,
    last_sync_at: testoONull(r?.last_sync_at),
    last_error: testoONull(r?.last_error),
    consecutive_errors: consecutive,
    last_attempt_at: testoONull(r?.last_attempt_at),
    last_success_at: testoONull(r?.last_success_at),
    auto_disabled: !enabled && consecutive >= mdmMaxErrori(),
    max_errori: mdmMaxErrori(),
  };
}

/** Credenziali in chiaro per il connettore (decifra la password). Null se incomplete. */
export function getMdmCreds(): { baseUrl: string; username: string; password: string } | null {
  const r = db()
    .prepare(`SELECT base_url, username, password_encrypted FROM mdm_config WHERE id=1`)
    .get() as Record<string, unknown> | undefined;
  if (!r?.base_url || !r?.username || !r?.password_encrypted) return null;
  const pwd = safeDecrypt(r.password_encrypted as string);
  if (pwd == null) return null;
  return { baseUrl: r.base_url as string, username: r.username as string, password: pwd };
}

/**
 * Il job `mdm_sync` segue l'interruttore (passo 3, 16/10; come
 * `ensureWazuhSyncJobForAllTenants`): acceso → c'è ed è acceso, senza doppioni;
 * spento → non c'è. Prima il job non lo creava nessuno: «sincronizzazione
 * automatica abilitata» restava una promessa.
 */
function allineaJobMdm(conn: Database.Database, acceso: boolean): EsitoJobMdm {
  const jobs = conn
    .prepare(`SELECT id, enabled FROM scheduled_jobs WHERE job_type = 'mdm_sync'`)
    .all() as Array<{ id: number; enabled: number }>;
  if (!acceso) {
    if (jobs.length === 0) return "assente";
    conn.prepare(`DELETE FROM scheduled_jobs WHERE job_type = 'mdm_sync'`).run();
    return "rimosso";
  }
  if (jobs.length === 0) {
    conn
      .prepare(
        `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled)
         VALUES (NULL, 'mdm_sync', ?, 1)`,
      )
      .run(MDM_SYNC_INTERVALLO_MINUTI);
    return "creato";
  }
  if (jobs.every((j) => j.enabled === 1)) return "invariato";
  conn
    .prepare(
      `UPDATE scheduled_jobs SET enabled = 1, updated_at = datetime('now')
       WHERE job_type = 'mdm_sync' AND enabled = 0`,
    )
    .run();
  return "riacceso";
}

/**
 * Salva la configurazione e allinea il job `mdm_sync` all'interruttore, in una
 * transazione. Riaccendere (da spento, anche se spento da solo dopo gli errori)
 * azzera `consecutive_errors`: altrimenti il primo errore dopo la riaccensione la
 * rispegnerebbe subito. Chi chiama deve poi ricaricare lo scheduler del tenant se
 * `job` non è «invariato»/«assente».
 */
export function saveMdmConfig(input: {
  base_url: string;
  username: string;
  password?: string;
  user_field?: string;
  enabled?: boolean;
}): EsitoSalvataggioMdm {
  const conn = db();
  const acceso = input.enabled === true;
  return conn.transaction((): EsitoSalvataggioMdm => {
    const existing = conn
      .prepare(`SELECT password_encrypted, enabled FROM mdm_config WHERE id=1`)
      .get() as { password_encrypted?: string | null; enabled?: number | null } | undefined;
    const eraAcceso = existing?.enabled === 1;
    const enc = input.password ? encrypt(input.password) : (existing?.password_encrypted ?? null);
    conn
      .prepare(
        `INSERT INTO mdm_config (id, base_url, username, password_encrypted, user_field, enabled)
         VALUES (1, @base_url, @username, @enc, @user_field, @enabled)
         ON CONFLICT(id) DO UPDATE SET base_url=@base_url, username=@username,
           password_encrypted=@enc, user_field=@user_field, enabled=@enabled`,
      )
      .run({
        base_url: input.base_url,
        username: input.username,
        enc,
        user_field: input.user_field ?? "description",
        enabled: acceso ? 1 : 0,
      });
    const riattivato = acceso && !eraAcceso;
    if (riattivato) {
      conn.prepare(`UPDATE mdm_config SET consecutive_errors = 0 WHERE id=1`).run();
    }
    return { job: allineaJobMdm(conn, acceso), riattivato };
  })();
}

/**
 * Aggiorna esito sync. Dopo `mdmMaxErrori()` errori di fila l'MDM si
 * spegne da solo (pattern vuln_scanners); la pagina lo spiega. Il job resta in
 * tabella e gira a vuoto («disabled») finché l'admin non salva: toglierlo qui,
 * dentro il job stesso, lascerebbe allo scheduler un cron senza riga.
 */
export function recordSync(ok: boolean, error?: string): void {
  const conn = db();
  if (ok) {
    conn
      .prepare(
        `UPDATE mdm_config SET last_sync_at=datetime('now'), last_attempt_at=datetime('now'),
           last_success_at=datetime('now'), last_error=NULL, consecutive_errors=0 WHERE id=1`,
      )
      .run();
  } else {
    conn
      .prepare(
        `UPDATE mdm_config SET last_sync_at=datetime('now'), last_attempt_at=datetime('now'),
           last_error=?, consecutive_errors=consecutive_errors+1 WHERE id=1`,
      )
      .run(error ?? "error");
    conn
      .prepare(`UPDATE mdm_config SET enabled=0 WHERE id=1 AND consecutive_errors>=?`)
      .run(mdmMaxErrori());
  }
}
