/**
 * Segni delle conversioni della tappa 2 credenziali in `tenant_settings`
 * (piano 2026-10-15-tappa2-archivio-credenziali, vincoli «Migrazioni»).
 *
 * Valori: `done:<data ISO>:<conteggi>` (conversione completa),
 * `parziale:<data ISO>:<conteggi>` (fatta, con voci lasciate o saltate),
 * `errore:<messaggio>` (ROLLBACK, niente scritto). Con `done:` o `parziale:` la
 * conversione non si richiama più: le sorgenti vecchie restano piene fino alla
 * 2g, e rigirarla annullerebbe le modifiche fatte nel frattempo dagli utenti.
 * Senza segno, o con `errore:`, si riprova all'apertura successiva.
 *
 * Si leggono e si scrivono con l'handle ricevuto, mai con
 * getTenantSetting/setTenantSetting: in fondo a getTenantDb passerebbero da
 * `db()` → `getTenantDb(code)` con la cache ancora vuota (ricorsione).
 *
 * Modulo puro: riceve l'handle, non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";

export const SEGNO_TIPI = "credenziali_t2_tipi";

export function leggiSegno(dbh: Database.Database, chiave: string): string | null {
  const r = dbh.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(chiave) as { value: string } | undefined;
  return r?.value ?? null;
}

export function scriviSegno(dbh: Database.Database, chiave: string, valore: string): void {
  dbh
    .prepare(
      `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(chiave, valore);
}

/** Vero se la conversione è già stata fatta (`done:` o `parziale:`) e non va richiamata. */
export function conversioneChiusa(valore: string | null): boolean {
  return valore != null && (valore.startsWith("done:") || valore.startsWith("parziale:"));
}

/** Segno d'errore: il messaggio su una riga, tagliato. */
export function segnoErrore(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
  return `errore:${msg.slice(0, 500)}`;
}
