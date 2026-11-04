process.env.ENCRYPTION_KEY ||= "test-encryption-key-scansioni-fallite-0123456789";

/**
 * 72729 (04/11/2026): scansione fermata al 98% dopo otto ore e mezza. L'edge passava solo le riuscite,
 * quindi qui né rilievi né motivo. Prova con un edge finto su HTTP vero: la scansione parziale arriva
 * col motivo, i suoi rilievi sostituiscono quelli degli host che ha toccato e gli altri restano
 * (Riccardo, 04/11: «sommati se non sostituiti», per la copertura completa degli IP della subnet).
 *
 * Hub isolato e tenant registrato: `getNetworks` passa dalla facciata, che altrimenti apre `data/ipam.db`.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/scansioni-fallite.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { encrypt } from "@/lib/crypto";
import { runVulnSync } from "@/lib/vuln/sync-job";
import { statoDelGiro, ultimaNonRiuscita } from "@/lib/vuln/esito-scansione";

const T = "TESTSCANSIONIFALLITE";
const ora = new Date().toISOString().slice(0, 19).replace("T", " ");

const FALLITE = [
  { id: 2, gvm_report_id: "rep-parziale", network_id: 1, status: "error", started_at: ora, finished_at: ora,
    finding_count: 1, error_message: "scansione ferma al 98%. Salvati 1 rilievi parziali; host non finiti: 192.0.2.9" },
  { id: 3, gvm_report_id: "rep-vuota", network_id: 1, status: "error", started_at: ora, finished_at: ora,
    finding_count: 0, error_message: "GVM task Stopped" },
];
const riga = (scan_id: number, ip: string, nvt_oid: string) => ({
  id: scan_id * 100, scan_id, network_id: null, ip, mac: null, hostname: null, port: "443/tcp", service: null,
  cve_id: null, cvss_score: 7.5, cvss_vector: null, severity: "High", nvt_oid, nvt_name: nvt_oid,
  description: null, scanned_at: ora,
});

let edge: http.Server;
before(async () => {
  createTenant({
    codice_cliente: T, ragione_sociale: "Prova scansioni fallite", indirizzo: null, citta: null, provincia: null,
    cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  });
  edge = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    let corpo: unknown = {};
    if (u.pathname === "/api/v1/scans") corpo = u.searchParams.get("stato") === "error" ? FALLITE : [];
    if (u.pathname === "/api/v1/cve") {
      const items = [riga(2, "192.0.2.1", "nuovo")];
      corpo = { items, next_offset: null, limit: 1000 };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(corpo));
  });
  await new Promise<void>((ok) => edge.listen(0, "127.0.0.1", ok));
});
after(async () => {
  await new Promise((ok) => edge.close(ok));
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("una fallita con rilievi è parziale, senza resta errore", () => {
  assert.equal(statoDelGiro({ status: "error", finding_count: 3 }), "parziale");
  assert.equal(statoDelGiro({ status: "error", finding_count: 0 }), "error");
  assert.equal(statoDelGiro({ status: "done", finding_count: 0 }), "done");
});

test("la parziale arriva col motivo e somma i rilievi per host", () =>
  withTenant(T, async () => {
    const d = getTenantDb(T);
    const porta = (edge.address() as AddressInfo).port;
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, last_sync_at) VALUES ('E', ?, ?, ?)")
      .run(`http://127.0.0.1:${porta}`, encrypt("t"), "2030-01-01 00:00:00").lastInsertRowid);
    const vecchia = Number(d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, edge_scan_uid, status) VALUES (?, 1, 'rep-buona', 'done')")
      .run(sc).lastInsertRowid);
    const f = d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, scanned_at) VALUES (?, ?, 'High', ?, ?)");
    f.run(vecchia, "192.0.2.1", "vecchio", ora);   // lo sostituisce la parziale
    f.run(vecchia, "192.0.2.2", "resta", ora);     // la parziale non l'ha raggiunto
    f.run(vecchia, "192.0.2.9", "resta-a-meta", ora);   // l'edge ha scartato i suoi rilievi

    const esito = await runVulnSync();
    assert.equal(esito.error, undefined);
    assert.equal(esito.newScans, 2);

    const stati = d.prepare("SELECT edge_scan_uid, status FROM vuln_scan_runs ORDER BY id").all();
    assert.deepEqual(stati, [
      { edge_scan_uid: "rep-buona", status: "done" },
      { edge_scan_uid: "rep-parziale", status: "parziale" },
      { edge_scan_uid: "rep-vuota", status: "error" },
    ]);
    const attuali = d.prepare("SELECT ip, nvt_oid FROM vuln_findings_attuali ORDER BY ip").all();
    assert.deepEqual(attuali, [
      { ip: "192.0.2.1", nvt_oid: "nuovo" },
      { ip: "192.0.2.2", nvt_oid: "resta" },
      { ip: "192.0.2.9", nvt_oid: "resta-a-meta" },
    ]);

    // Secondo giro: stesso UUID, nessun doppione.
    assert.equal((await runVulnSync()).newScans, 0);

    const ultima = ultimaNonRiuscita(d, sc);
    assert.equal(ultima?.status, "error");
    assert.equal(ultima?.error_message, "GVM task Stopped");
  }));
