import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import type { Database } from "better-sqlite3";
import type { VulnScannerRow } from "@/lib/vuln/scanner-edge-client";

/** Singleton scanner-edge abilitato per il tenant corrente. */
export function getActiveEdgeScanner(): VulnScannerRow | null {
  const code = getCurrentTenantCode() ?? "DEFAULT";
  const db = getTenantDb(code);
  const row = db
    .prepare(
      "SELECT id, name, base_url, token_encrypted, enabled, cert_pin FROM vuln_scanners WHERE enabled = 1 ORDER BY id LIMIT 1",
    )
    .get() as VulnScannerRow | undefined;
  return row ?? null;
}

/**
 * Rimuove lo scanner-edge del tenant (DELETE /api/integrations/scanner-edge).
 *
 * ATTENZIONE: vuln_scan_runs e vuln_findings hanno ON DELETE CASCADE su
 * vuln_scanners e il DB del cliente apre con foreign_keys=ON, quindi la
 * rimozione cancella anche tutti i findings importati e lo storico delle
 * scansioni. La conferma in UI lo dice (edgeRemovalConfirmText, MOD-19);
 * presidiata da src/lib/vuln/__tests__/edge-removal.test.ts. Chi chiama
 * ricarica lo scheduler del tenant.
 */
export function removeEdgeScanner(db: Database): void {
  db.prepare("DELETE FROM vuln_scanners").run();
  db.prepare(
    "DELETE FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL",
  ).run();
}

/** Storico dello Scanner-Edge che una sostituzione dello scanner cancellerebbe. */
export interface EdgeHistoryCounts {
  /** Scansioni importate (vuln_scan_runs). */
  runs: number;
  /** Findings importati (vuln_findings). */
  findings: number;
}

/**
 * Quante scansioni e quanti findings se ne vanno a cascata se si cancellano
 * le righe di vuln_scanners (rimozione o import del JSON dell'edge).
 */
export function edgeHistoryCounts(db: Database): EdgeHistoryCounts {
  const runs = db
    .prepare(
      `SELECT COUNT(*) AS n FROM vuln_scan_runs r
         JOIN vuln_scanners s ON s.id = r.scanner_id`,
    )
    .get() as { n: number };
  const findings = db
    .prepare(
      `SELECT COUNT(*) AS n FROM vuln_findings f
         JOIN vuln_scan_runs r ON r.id = f.scan_run_id
         JOIN vuln_scanners s ON s.id = r.scanner_id`,
    )
    .get() as { n: number };
  return { runs: runs.n, findings: findings.n };
}

/**
 * MOD-19 (revisione del 12/10): l'import del JSON da Impostazioni → Moduli si
 * ferma e chiede conferma quando il JSON contiene il modulo edge e la
 * sostituzione cancellerebbe uno storico (scansioni o findings). La UI lo
 * chiede con ?chiediConferma=1 e, se l'utente conferma, ripete la richiesta
 * senza. Le chiamate senza il parametro restano come prima: il connect di
 * Deploy-Appliance reimporta l'edge a ogni add-module e non deve fermarsi.
 * Restituisce il conteggio da mostrare, o null per procedere.
 */
export function edgeImportNeedsConfirm(
  modules: readonly string[],
  counts: EdgeHistoryCounts,
  askConfirm: boolean,
): EdgeHistoryCounts | null {
  if (!askConfirm || !modules.includes("edge")) return null;
  if (counts.runs === 0 && counts.findings === 0) return null;
  return counts;
}

/**
 * Sostituisce lo scanner-edge con quello del JSON importato
 * (POST /api/modules/import, modulo edge). Estratta dalla rotta senza
 * cambiarla, perché la prova la esegua.
 *
 * ATTENZIONE: DELETE + INSERT, quindi vuln_scan_runs e vuln_findings se ne
 * vanno a cascata come nella rimozione. La rotta chiede conferma prima
 * (edgeImportNeedsConfirm, edgeImportReplaceConfirmText); passare a un UPDATE
 * sul posto come la POST di scanner-edge (COR-05) è la tappa 7 (MOD-5).
 * Presidiata da src/lib/vuln/__tests__/edge-import-replace.test.ts.
 */
export function replaceEdgeScannerFromImport(
  db: Database,
  row: {
    name: string;
    baseUrl: string;
    tokenEncrypted: string;
    certPin: string | null;
    certFingerprint: string | null;
  },
): void {
  db.prepare("DELETE FROM vuln_scanners").run();
  db.prepare(
    `INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled, cert_pin, cert_fingerprint)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(row.name, row.baseUrl, row.tokenEncrypted, row.certPin, row.certFingerprint);
}
