process.env.ENCRYPTION_KEY ||= "test-encryption-key-mod19-edge";

/**
 * MOD-19 (piano di miglioramento, tappa 1, 12/10): «Rimuovi» nella card
 * Scanner-Edge chiedeva «Rimuovere la configurazione scanner-edge? I findings
 * storici restano in archivio.» Falso: vuln_scan_runs e vuln_findings hanno
 * ON DELETE CASCADE sullo scanner, e il DB tenant apre con foreign_keys=ON,
 * quindi rimuovere lo scanner cancella tutto lo storico importato.
 *
 * La prova esegue la rimozione vera (la funzione che usa la rotta DELETE) su un
 * DB tenant e controlla che la conferma lo dica. Se la tappa 7 (MOD-5) cambia
 * il comportamento, la prima prova fallisce e il testo va aggiornato insieme.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { removeEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { edgeRemovalConfirmText } from "@/lib/modules/uninstall-copy";

const T = "TESTMOD19EDGE";
after(() => deleteTenantDatabase(T));

test("rimuovere lo scanner-edge cancella findings, storico delle scansioni e sync pianificata", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    const scannerId = Number(
      db
        .prepare(
          "INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('Scanner-Edge', 'https://192.0.2.10:6443', 'cifrato')",
        )
        .run().lastInsertRowid,
    );
    const runId = Number(
      db
        .prepare(
          `INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, edge_scan_uid, finding_count, status)
           VALUES (?, 1, 'a1b2c3d4-0000-4000-8000-000000000001', 2, 'done')`,
        )
        .run(scannerId).lastInsertRowid,
    );
    const ins = db.prepare(
      `INSERT INTO vuln_findings (scan_run_id, ip, port, cve_id, cvss_score, severity, nvt_name, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    ins.run(runId, "192.0.2.20", "443/tcp", "CVE-2024-6387", 8.1, "high", "OpenSSH regreSSHion");
    ins.run(runId, "192.0.2.21", "general/tcp", null, 0, "log", "OS Detection");
    db.prepare(
      "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (NULL, 'vuln_sync', 30, 1)",
    ).run();

    removeEdgeScanner(db);

    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    assert.equal(n("SELECT COUNT(*) AS n FROM vuln_scanners"), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM vuln_scan_runs"), 0, "lo storico delle scansioni se ne va");
    assert.equal(n("SELECT COUNT(*) AS n FROM vuln_findings"), 0, "i findings se ne vanno: la conferma deve dirlo");
    assert.equal(
      n("SELECT COUNT(*) AS n FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL"),
      0,
    );
  });
});

test("la conferma di «Rimuovi» dice che i findings si cancellano, e quanti", () => {
  const molti = edgeRemovalConfirmText(1234);
  assert.match(molti, /1\.234 findings/);
  assert.match(molti, /cancellano/);
  assert.doesNotMatch(molti, /restano in archivio/i);

  assert.match(edgeRemovalConfirmText(1), /il finding importato/);
  // Senza findings non si parla di findings, ma dello storico sì.
  const zero = edgeRemovalConfirmText(0);
  assert.doesNotMatch(zero, /finding/);
  assert.match(zero, /storico delle scansioni/);
});
