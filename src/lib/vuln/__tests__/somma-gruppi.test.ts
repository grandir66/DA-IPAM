process.env.ENCRYPTION_KEY ||= "test-encryption-key-somma-gruppi-0123456789";

/**
 * Scansione a finestra (Task 10, 05/11/2026): una rete scandita a gruppi arriva come tanti rapporti
 * dello stesso CIDR, ciascuno `done`. Prova con un edge finto su HTTP vero che i gruppi si sommano per
 * host in `vuln_findings_attuali`: il gruppo più recente vince sull'IP che ha toccato, un IP assente
 * da un gruppo tiene i rilievi di quello prima, e la fermata a fine fascia resta `done`.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/somma-gruppi.test.ts
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
import { statoDelGiro } from "@/lib/vuln/esito-scansione";

const T = "TESTSOMMAGRUPPI";
const ora = new Date().toISOString().slice(0, 19).replace("T", " ");

// Tre gruppi della stessa rete, tutti `done`. Il terzo si è fermato a fine fascia: lo dice il motivo,
// ma lo stato resta `done` e i suoi rilievi valgono.
const GRUPPI = [
  { id: 1, gvm_report_id: "rep-g1", network_id: 1, status: "done", started_at: ora, finished_at: ora, finding_count: 2, error_message: null },
  { id: 2, gvm_report_id: "rep-g2", network_id: 1, status: "done", started_at: ora, finished_at: ora, finding_count: 2, error_message: null },
  { id: 3, gvm_report_id: "rep-g3", network_id: 1, status: "done", started_at: ora, finished_at: ora, finding_count: 1, error_message: "fine fascia: gruppo ripreso alla prossima apertura" },
];
const riga = (scan_id: number, ip: string, nvt_oid: string) => ({
  id: scan_id * 100 + Number(ip.split(".")[3]), scan_id, network_id: null, ip, mac: null, hostname: null, port: "443/tcp", service: null,
  cve_id: null, cvss_score: 7.5, cvss_vector: null, severity: "High", nvt_oid, nvt_name: nvt_oid,
  description: null, scanned_at: ora,
});
const RILIEVI = [
  riga(1, "192.0.2.1", "g1-vecchio"), // sostituito dal gruppo 2
  riga(1, "192.0.2.2", "g1-resta"),   // assente dai gruppi 2 e 3: tiene il suo
  riga(2, "192.0.2.1", "g2-nuovo"),
  riga(2, "192.0.2.3", "g2-solo"),
  riga(3, "192.0.2.4", "g3-fine-fascia"),
];

let edge: http.Server;
before(async () => {
  createTenant({
    codice_cliente: T, ragione_sociale: "Prova somma gruppi", indirizzo: null, citta: null, provincia: null,
    cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  });
  edge = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    let corpo: unknown = {};
    if (u.pathname === "/api/v1/scans") corpo = GRUPPI;
    if (u.pathname === "/api/v1/cve") corpo = { items: RILIEVI, next_offset: null, limit: 1000 };
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

test("statoDelGiro: un gruppo done resta done, anche a fine fascia e anche con rilievi", () => {
  assert.equal(statoDelGiro({ status: "done", finding_count: 1 }), "done");
  assert.equal(statoDelGiro({ status: "done", finding_count: 0 }), "done");
});

test("i gruppi done si sommano per host in vuln_findings_attuali", () =>
  withTenant(T, async () => {
    const d = getTenantDb(T);
    const porta = (edge.address() as AddressInfo).port;
    d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, last_sync_at) VALUES ('E', ?, ?, ?)")
      .run(`http://127.0.0.1:${porta}`, encrypt("t"), "2030-01-01 00:00:00");

    const esito = await runVulnSync();
    assert.equal(esito.error, undefined);
    assert.equal(esito.newScans, 3);

    // La fermata a fine fascia è done anche nel database, non parziale né error.
    const stati = d.prepare("SELECT edge_scan_uid, status FROM vuln_scan_runs ORDER BY id").all();
    assert.deepEqual(stati, [
      { edge_scan_uid: "rep-g1", status: "done" },
      { edge_scan_uid: "rep-g2", status: "done" },
      { edge_scan_uid: "rep-g3", status: "done" },
    ]);

    const attuali = d.prepare("SELECT ip, nvt_oid FROM vuln_findings_attuali ORDER BY ip").all();
    assert.deepEqual(attuali, [
      { ip: "192.0.2.1", nvt_oid: "g2-nuovo" },        // il gruppo più recente vince sull'IP comune
      { ip: "192.0.2.2", nvt_oid: "g1-resta" },        // assente dai gruppi dopo: tiene i suoi
      { ip: "192.0.2.3", nvt_oid: "g2-solo" },
      { ip: "192.0.2.4", nvt_oid: "g3-fine-fascia" },
    ]);
  }));
