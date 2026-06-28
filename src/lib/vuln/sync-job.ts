/**
 * Sync job CVE findings da scanner-edge → DB tenant DA-IPAM.
 *
 * Esegue in contesto `withTenant` (impostato dallo scheduler cron).
 * Idempotente: scan_runs ha UNIQUE(scanner_id, edge_scan_id), findings
 * sono append-only (archivio temporale).
 *
 * Strategia incrementale:
 *   1. legge singleton vuln_scanners (enabled=1, limit 1) — niente edge → noop
 *   2. GET /api/v1/scans?since=last_sync_at → lista scan finiti dopo l'ultimo poll
 *   3. per ogni scan nuovo: INSERT OR IGNORE in vuln_scan_runs
 *   4. GET /api/v1/cve?since=last_sync_at paginato → bulk insert in vuln_findings
 *   5. match host_id su (ip, network_id) — single match assegna, multi/zero NULL
 *   6. update last_sync_at; errori → last_error, non rilancia
 */

import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getNetworks } from "@/lib/db";
import {
  EdgeClientError,
  listScans,
  pullFindings,
  type EdgeFinding,
  type EdgeScan,
  type VulnScannerRow,
} from "./scanner-edge-client";
import { pushHostsToEdge } from "./edge-subnet-bridge";

interface HostMatchRow {
  id: number;
  network_id: number;
}

function nowIso(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Lookup `host_id` per (ip, network_id?). Restituisce id se match singolo,
 * altrimenti null (zero match o ambiguità).
 */
function matchHostId(
  db: ReturnType<typeof getTenantDb>,
  ip: string,
  networkId: number | null,
): number | null {
  if (networkId !== null) {
    const r = db
      .prepare("SELECT id FROM hosts WHERE ip = ? AND network_id = ?")
      .get(ip, networkId) as HostMatchRow | undefined;
    if (r) return r.id;
  }
  const rows = db
    .prepare("SELECT id FROM hosts WHERE ip = ?")
    .all(ip) as HostMatchRow[];
  return rows.length === 1 ? rows[0].id : null;
}

export async function runVulnSync(): Promise<{
  ok: boolean;
  newScans: number;
  newFindings: number;
  error?: string;
}> {
  const db = getTenantDb(getCurrentTenantCode() ?? "DEFAULT");

  const scanner = db
    .prepare(
      "SELECT id, name, base_url, token_encrypted, enabled, last_sync_at, last_error, consecutive_errors " +
        "FROM vuln_scanners WHERE enabled = 1 LIMIT 1",
    )
    .get() as VulnScannerRow | undefined;
  if (!scanner) {
    return { ok: true, newScans: 0, newFindings: 0 };
  }

  const since = scanner.last_sync_at ?? undefined;
  let newScans = 0;
  let newFindings = 0;

  try {
    const scans: EdgeScan[] = await listScans(scanner, since);

    // network_id qui resta NULL: l'ID arrivato dall'edge è dello *suo*
    // namespace e non corrisponde a `networks.id` lato IPAM. Il match host
    // viene fatto per IP a valle (vedi matchHostId). Eventuale mapping
    // per CIDR è ottimizzazione futura.
    const insertScanRun = db.prepare(
      `INSERT OR IGNORE INTO vuln_scan_runs
        (scanner_id, edge_scan_id, network_id, started_at, finished_at,
         finding_count, status)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    );
    const findScanRun = db.prepare(
      "SELECT id FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_id = ?",
    );

    const scanRunByEdgeId = new Map<number, { runId: number; networkId: number | null }>();
    for (const s of scans) {
      const info = insertScanRun.run(
        scanner.id,
        s.id,
        s.started_at,
        s.finished_at,
        s.finding_count,
        s.status,
      );
      const row = findScanRun.get(scanner.id, s.id) as { id: number } | undefined;
      if (row) {
        // networkId qui mantengo come arriva dall'edge perché serve solo
        // come hint per matchHostId (lookup hosts per ip+network_id IPAM
        // se conosciuto). Per IPAM è informativo, non FK.
        scanRunByEdgeId.set(s.id, { runId: row.id, networkId: s.network_id });
        if (info.changes > 0) newScans++;
      }
    }

    // Paginazione findings dall'edge fino a esaurimento
    let offset = 0;
    const limit = 1000;
    const insertFinding = db.prepare(
      `INSERT INTO vuln_findings
        (host_id, scan_run_id, ip, mac, hostname, port, service,
         cve_id, cvss_score, cvss_vector, severity,
         nvt_oid, nvt_name, description, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Lookup riusabile: per finding il cui edge_scan_id non era nello
    // snapshot di listScans(since), cerca in vuln_scan_runs già esistente.
    // Tipico col backfill retroattivo: i findings nuovi puntano a scan
    // run già importati in passi precedenti.
    const findRunByEdgeId = db.prepare(
      "SELECT id, network_id FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_id = ?",
    );

    // Transaction wrapper per bulk insert
    const insertMany = db.transaction((findings: EdgeFinding[]) => {
      for (const f of findings) {
        let runRef = scanRunByEdgeId.get(f.scan_id);
        if (!runRef) {
          const r = findRunByEdgeId.get(scanner.id, f.scan_id) as
            | { id: number; network_id: number | null }
            | undefined;
          if (!r) continue;
          runRef = { runId: r.id, networkId: r.network_id };
          scanRunByEdgeId.set(f.scan_id, runRef);
        }
        const hostId = matchHostId(db, f.ip, f.network_id ?? runRef.networkId);
        insertFinding.run(
          hostId,
          runRef.runId,
          f.ip,
          f.mac,
          f.hostname,
          f.port,
          f.service,
          f.cve_id,
          f.cvss_score,
          f.cvss_vector,
          f.severity,
          f.nvt_oid,
          f.nvt_name,
          f.description,
          f.scanned_at,
        );
        newFindings++;
      }
    });

    while (true) {
      const page = await pullFindings(scanner, { since, offset, limit });
      if (page.items.length === 0) break;
      insertMany(page.items);
      if (page.next_offset === null) break;
      offset = page.next_offset;
      if (offset > 100000) {
        // safety: protezione runaway, oltre questo soglia c'è un bug
        console.warn(`[vuln-sync] offset > 100k su scanner ${scanner.id}, abort`);
        break;
      }
    }

    // Push-hosts periodico: aggiorna inventario sull'edge per le reti con
    // targeting_mode dinamico (found_ips / populated_24). Le reti full_subnet
    // non ne hanno bisogno (scansionano l'intero CIDR direttamente).
    // Best-effort: un singolo fallimento non blocca il resto del job né il sync.
    // Nota: iteriamo su tutte le reti con targeting_mode ≠ full_subnet senza
    // verificare se la rete ha uno schedule edge attivo (quella info richiederebbe
    // un round-trip verso l'edge per ogni rete). La scelta è conservativa:
    // si fa push anche per reti senza schedule — overhead trascurabile, nessun danno.
    const allNetworks = getNetworks();
    for (const net of allNetworks) {
      const mode = net.targeting_mode ?? "full_subnet";
      if (mode === "full_subnet") continue;
      try {
        await pushHostsToEdge(net.id);
      } catch (pushErr) {
        // Log solo metadati (no IP/hostname): per EdgeClientError logghiamo
        // solo lo status HTTP, non il body (può echeggiare campi della richiesta).
        const msg =
          pushErr instanceof EdgeClientError
            ? `edge HTTP ${pushErr.status}`
            : pushErr instanceof Error
              ? pushErr.message
              : "errore sconosciuto";
        console.warn(`[vuln-sync] push-hosts rete #${net.id} (${mode}) fallito: ${msg}`);
      }
    }

    // v0.2.638 audit B7: success → azzera counter consecutive_errors.
    db.prepare(
      "UPDATE vuln_scanners SET last_sync_at = ?, last_error = NULL, consecutive_errors = 0, auto_disabled_at = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(nowIso(), scanner.id);

    return { ok: true, newScans, newFindings };
  } catch (e) {
    const msg =
      e instanceof EdgeClientError
        ? `edge ${e.status}: ${e.message}`
        : (e as Error).message;
    // v0.2.638 audit B7: incrementa counter; a 5 errori consecutivi auto-disable
    // lo scanner per fermare il rumore (cron muto per ore su TOFU mismatch).
    // L'utente vede `auto_disabled_at` + `last_error` chiaro per riattivare manualmente.
    const AUTO_DISABLE_THRESHOLD = 5;
    const newCount = (scanner.consecutive_errors ?? 0) + 1;
    if (newCount >= AUTO_DISABLE_THRESHOLD) {
      db.prepare(
        `UPDATE vuln_scanners
         SET last_error = ?, consecutive_errors = ?, enabled = 0, auto_disabled_at = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        `Auto-disabilitato dopo ${newCount} errori consecutivi: ${msg}`.slice(0, 500),
        newCount,
        nowIso(),
        scanner.id,
      );
    } else {
      db.prepare(
        "UPDATE vuln_scanners SET last_error = ?, consecutive_errors = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(msg.slice(0, 500), newCount, scanner.id);
    }
    return { ok: false, newScans, newFindings, error: msg };
  }
}
