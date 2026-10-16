process.env.ENCRYPTION_KEY ||= "test-encryption-key-mod19-edge-import";

/**
 * MOD-19, revisione del 12/10: oltre a «Rimuovi», c'è una seconda via che
 * cancella findings e storico dello Scanner-Edge. Importando il JSON del
 * modulo edge (Impostazioni → Moduli → «Importa configurazione modulo»),
 * POST /api/modules/import esegue DELETE FROM vuln_scanners e poi un INSERT:
 * con foreign_keys=ON vuln_scan_runs e vuln_findings se ne vanno a cascata,
 * senza nessuna conferma. Chi reimporta il JSON per aggiornare token o URL
 * perdeva tutto lo storico in silenzio.
 *
 * Il comportamento resta quello (UPDATE sul posto come la POST con COR-05 è la
 * tappa 7, MOD-5): l'import dalla UI ora si ferma e chiede conferma quando
 * c'è uno storico da perdere. Il connect di Deploy-Appliance, che chiama la
 * stessa rotta senza chiedere conferma, resta com'era. Queste prove eseguono
 * la sostituzione vera e controllano il conteggio che la conferma mostra.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Database } from "better-sqlite3";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import {
  edgeHistoryCounts,
  edgeImportNeedsConfirm,
  replaceEdgeScannerFromImport,
} from "@/lib/vuln/edge-scanner-db";
import { edgeImportReplaceConfirmText } from "@/lib/modules/uninstall-copy";

const T = "TESTMOD19EDGEIMP";
after(() => deleteTenantDatabase(T));

function svuota(db: Database) {
  db.prepare("DELETE FROM vuln_scanners").run();
}

function scannerConStorico(db: Database): void {
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
         VALUES (?, 1, 'a1b2c3d4-0000-4000-8000-000000000002', 2, 'done')`,
      )
      .run(scannerId).lastInsertRowid,
  );
  const ins = db.prepare(
    `INSERT INTO vuln_findings (scan_run_id, ip, port, cve_id, cvss_score, severity, nvt_name, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  ins.run(runId, "192.0.2.20", "443/tcp", "CVE-2024-6387", 8.1, "high", "OpenSSH regreSSHion");
  ins.run(runId, "192.0.2.21", "general/tcp", null, 0, "log", "OS Detection");
}

test("reimportare il JSON dell'edge cancella findings e storico: il conteggio della conferma è quello che si perde", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    svuota(db);
    scannerConStorico(db);

    const prima = edgeHistoryCounts(db);
    assert.deepEqual(prima, { runs: 1, findings: 2 });

    replaceEdgeScannerFromImport(db, {
      name: "Scanner-Edge",
      baseUrl: "https://192.0.2.10:6443",
      tokenEncrypted: "cifrato-nuovo",
      certPin: null,
      certFingerprint: null,
    });

    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    assert.equal(n("SELECT COUNT(*) AS n FROM vuln_scanners"), 1, "resta lo scanner nuovo");
    assert.equal(n("SELECT COUNT(*) AS n FROM vuln_scan_runs"), 0, "lo storico se ne va a cascata");
    assert.equal(n("SELECT COUNT(*) AS n FROM vuln_findings"), 0, "i findings se ne vanno: la conferma deve dirlo");
  });
});

test("l'import dalla UI chiede conferma solo se contiene l'edge e c'è uno storico da perdere", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    svuota(db);
    // Nessuno scanner: niente da perdere.
    assert.equal(edgeImportNeedsConfirm(["edge"], edgeHistoryCounts(db), true), null);

    // Scanner senza scansioni importate: si sostituisce senza chiedere.
    db.prepare(
      "INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('Scanner-Edge', 'https://192.0.2.10:6443', 'cifrato')",
    ).run();
    assert.equal(edgeImportNeedsConfirm(["edge"], edgeHistoryCounts(db), true), null);

    svuota(db);
    scannerConStorico(db);
    const c = edgeHistoryCounts(db);
    assert.deepEqual(edgeImportNeedsConfirm(["edge", "librenms"], c, true), { runs: 1, findings: 2 });
    // JSON senza edge: si procede.
    assert.equal(edgeImportNeedsConfirm(["librenms", "graylog"], c, true), null);
    // Richiesta senza conferma da chiedere (l'utente ha già confermato, o è il
    // connect di Deploy-Appliance): si procede come prima.
    assert.equal(edgeImportNeedsConfirm(["edge"], c, false), null);
  });
});

test("la conferma dell'import dice che si cancellano i findings, e quanti", () => {
  const molti = edgeImportReplaceConfirmText({ runs: 12, findings: 1234 });
  assert.match(molti, /1\.234 findings/);
  assert.match(molti, /12 scansioni/);
  assert.match(molti, /cancellano/);
  // La sincronizzazione riscarica dall'edge solo ciò che l'edge conserva.
  assert.match(molti, /riscarica/);
  assert.match(molti, /non tornano/);

  const uno = edgeImportReplaceConfirmText({ runs: 1, findings: 1 });
  assert.match(uno, /il finding importato/);
  assert.match(uno, /una scansione/);

  const soloStorico = edgeImportReplaceConfirmText({ runs: 3, findings: 0 });
  assert.doesNotMatch(soloStorico, /finding/);
  assert.match(soloStorico, /3 scansioni/);
});
