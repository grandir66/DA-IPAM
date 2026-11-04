/**
 * Esito di una scansione dell'edge lato DA-IPAM (04/11/2026, 72729: fermata al 98% dopo otto ore e
 * mezza, e qui non si vedeva né il lavoro fatto né il motivo).
 */
import type Database from "better-sqlite3";
import type { EdgeScan } from "@/lib/vuln/scanner-edge-client";

/**
 * Una scansione fallita che ha salvato rilievi vale per gli host finiti: l'edge scarta quelli a metà.
 * `vuln_findings_attuali` esclude le `error`, non le `parziale`: così i rilievi si sommano per host
 * e chi non è stato raggiunto tiene i suoi.
 */
export function statoDelGiro(s: Pick<EdgeScan, "status" | "finding_count">): string {
  return s.status === "error" && s.finding_count > 0 ? "parziale" : s.status;
}

export interface GiroNonRiuscito {
  status: string;
  error_message: string | null;
  finished_at: string | null;
}

/** L'ultima non riuscita degli ultimi 7 giorni, la stessa finestra del battito dell'edge verso l'hub. */
export function ultimaNonRiuscita(db: Database.Database, scannerId: number): GiroNonRiuscito | null {
  const riga = db
    .prepare(
      `SELECT status, error_message, finished_at FROM vuln_scan_runs
        WHERE scanner_id = ? AND status IN ('error', 'parziale')
          AND julianday(finished_at) >= julianday('now') - 7
        ORDER BY julianday(finished_at) DESC, id DESC LIMIT 1`,
    )
    .get(scannerId) as GiroNonRiuscito | undefined;
  return riga ?? null;
}
