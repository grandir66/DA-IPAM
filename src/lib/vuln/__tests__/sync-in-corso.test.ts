process.env.ENCRYPTION_KEY ||= "test-encryption-key-sync-in-corso-0123456789";

/**
 * Rilievi a scansione aperta (06/11/2026, piano host lenti Task 3): la sonda consegna i rilievi degli
 * host finiti mentre la scansione gira (`/scans?stato=running`, `/scans/{id}/rilievi-in-corso`) e
 * DA-IPAM li tiene in un giro `in_corso`, sostituendoli per intero a ogni sincronia. Alla chiusura il
 * giro prende i rilievi definitivi di `/cve` e perde quelli in corso.
 *
 * Il punto delicato è `since`: i rilievi definitivi hanno `scanned_at = datetime('now')` della sonda
 * al momento del parse (`parse_cve.py`), cioè la chiusura. Una scansione che chiude mentre la
 * sincronia sta ancora girando ha `scanned_at` <= `last_sync_at` che la sincronia scrive in fondo:
 * col solo `since` i definitivi non arriverebbero mai. Qui lo si prova con un edge che applica
 * `since` davvero.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/sync-in-corso.test.ts
 */
import "./support/dati-isolati";
import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { encrypt } from "@/lib/crypto";
import { runVulnSync } from "@/lib/vuln/sync-job";
import { ultimaNonRiuscita } from "@/lib/vuln/esito-scansione";

const T = "TESTSYNCINCORSO";
const ts = (msFa: number) => new Date(Date.now() - msFa).toISOString().slice(0, 19).replace("T", " ");
const ORA = 3600_000;

interface ScanSonda {
  id: number; gvm_report_id: string | null; network_id: number | null; status: string; started_at: string;
  finished_at: string | null; error_message: string | null; passaggio_id: number | null; finding_count: number;
}
const scan = (id: number, uid: string | null, status: string, started: string, finished: string | null, n = 0, err: string | null = null): ScanSonda => ({
  id, gvm_report_id: uid, network_id: 1, status, started_at: started, finished_at: finished, error_message: err, passaggio_id: null, finding_count: n,
});
const riga = (scan_id: number, ip: string, nvt_oid: string, scanned_at: string) => ({
  id: Math.floor(Math.random() * 1e9), scan_id, network_id: null, ip, mac: null, hostname: null, port: "443/tcp", service: null,
  cve_id: null, cvss_score: 7.5, cvss_vector: null, severity: "High", nvt_oid, nvt_name: nvt_oid, description: null, scanned_at,
});

/** Lo stato del finto edge, riscritto da ogni prova. */
let sonda: {
  vecchia: boolean;                       // 422 su stato=running e su rilievi-in-corso, come una sonda senza le rotte
  running: ScanSonda[]; done: ScanSonda[]; error: ScanSonda[];
  inCorso: Record<number, unknown[][]>;   // scan_id → pagine di rilievi in corso
  inCorsoRotto: boolean;                  // la seconda pagina dà 500
  cve: ReturnType<typeof riga>[];
  chiamate: string[];
};
const pulita = () => ({ vecchia: false, running: [], done: [], error: [], inCorso: {}, inCorsoRotto: false, cve: [], chiamate: [] });

let edge: http.Server;
let scannerId = 0;
const dentro = <R>(f: () => Promise<R>): Promise<R> => withTenant(T, f);

before(async () => {
  createTenant({
    codice_cliente: T, ragione_sociale: "Prova sync in corso", indirizzo: null, citta: null, provincia: null,
    cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  });
  edge = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    sonda.chiamate.push(`${u.pathname}${u.search}`);
    const rispondi = (status: number, corpo: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(corpo));
    };
    if (u.pathname === "/api/v1/scans") {
      const stato = u.searchParams.get("stato") ?? "done";
      if (stato === "running") return sonda.vecchia ? rispondi(422, { detail: "Input should be 'done' or 'error'" }) : rispondi(200, sonda.running);
      const since = u.searchParams.get("since");
      const lista = stato === "error" ? sonda.error : sonda.done;
      return rispondi(200, lista.filter((s) => !since || (s.finished_at ?? "") > since));
    }
    const m = /^\/api\/v1\/scans\/(\d+)\/rilievi-in-corso$/.exec(u.pathname);
    if (m) {
      if (sonda.vecchia) return rispondi(404, { detail: "Not Found" });
      const pagine = sonda.inCorso[Number(m[1])];
      if (!pagine) return rispondi(404, { detail: "scansione non trovata" });
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const i = offset === 0 ? 0 : 1;
      if (i === 1 && sonda.inCorsoRotto) return rispondi(500, { detail: "database locked" });
      return rispondi(200, { items: pagine[i] ?? [], next_offset: i + 1 < pagine.length ? 1000 : null, limit: 1000 });
    }
    if (u.pathname === "/api/v1/cve") {
      const since = u.searchParams.get("since");
      const items = sonda.cve.filter((f) => !since || f.scanned_at > since);
      return rispondi(200, { items, next_offset: null, limit: 1000 });
    }
    rispondi(404, { detail: "Not Found" });
  });
  await new Promise<void>((ok) => edge.listen(0, "127.0.0.1", ok));
});
after(async () => {
  await new Promise((ok) => edge.close(ok));
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});
beforeEach(() => {
  sonda = pulita();
  const d = getTenantDb(T);
  d.exec("DELETE FROM vuln_findings; DELETE FROM vuln_scan_runs; DELETE FROM vuln_scanners; DELETE FROM hosts;");
  const porta = (edge.address() as AddressInfo).port;
  scannerId = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled, last_sync_at) VALUES ('E', ?, ?, 1, ?)")
    .run(`http://127.0.0.1:${porta}`, encrypt("t"), ts(2 * ORA)).lastInsertRowid);
});

const runs = () => getTenantDb(T).prepare("SELECT edge_scan_uid, status, finding_count, error_message FROM vuln_scan_runs ORDER BY id").all();
const rilievi = () => getTenantDb(T).prepare("SELECT ip, nvt_oid FROM vuln_findings ORDER BY ip, nvt_oid").all();
const scanner = () => getTenantDb(T).prepare("SELECT last_sync_at, last_error, consecutive_errors FROM vuln_scanners WHERE id = ?").get(scannerId) as
  { last_sync_at: string; last_error: string | null; consecutive_errors: number };

test("due sincronie a scansione aperta non raddoppiano, e i rilievi di un host finito si vedono subito", () =>
  dentro(async () => {
    const d = getTenantDb(T);
    // Un giro buono precedente con un rilievo vecchio sull'host .1: quello nuovo lo sostituisce nella vista.
    const vecchio = Number(d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, edge_scan_uid, status) VALUES (?, 1, 'vecchio', 'done')").run(scannerId).lastInsertRowid);
    d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, scanned_at) VALUES (?, '192.0.2.1', 'High', 'vecchio', ?)").run(vecchio, ts(5 * 24 * ORA));
    d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, scanned_at) VALUES (?, '192.0.2.2', 'High', 'resta', ?)").run(vecchio, ts(5 * 24 * ORA));

    sonda.running = [scan(7, "rep-aperta", "running", ts(ORA), null, 2)];
    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "nuovo-a", ts(100)), riga(7, "192.0.2.1", "nuovo-b", ts(100))]];

    const e1 = await runVulnSync();
    assert.equal(e1.ok, true);
    const e2 = await runVulnSync();
    assert.equal(e2.ok, true);
    assert.deepEqual(runs().map((r) => (r as { status: string }).status), ["done", "in_corso"]);
    const nuovi = d.prepare("SELECT nvt_oid FROM vuln_findings f JOIN vuln_scan_runs r ON r.id = f.scan_run_id WHERE r.status = 'in_corso' ORDER BY 1").all();
    assert.deepEqual(nuovi, [{ nvt_oid: "nuovo-a" }, { nvt_oid: "nuovo-b" }], "due sincronie: due righe, non quattro");

    const attuali = d.prepare("SELECT ip, nvt_oid FROM vuln_findings_attuali ORDER BY ip, nvt_oid").all();
    assert.deepEqual(attuali, [
      { ip: "192.0.2.1", nvt_oid: "nuovo-a" },
      { ip: "192.0.2.1", nvt_oid: "nuovo-b" },
      { ip: "192.0.2.2", nvt_oid: "resta" },
    ]);

    // Un terzo rilievo arriva con un altro host finito: la sostituzione è per intero.
    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "nuovo-a", ts(100)), riga(7, "192.0.2.3", "terzo", ts(50))]];
    await runVulnSync();
    assert.deepEqual(
      d.prepare("SELECT ip, nvt_oid FROM vuln_findings f JOIN vuln_scan_runs r ON r.id = f.scan_run_id WHERE r.status = 'in_corso' ORDER BY 1, 2").all(),
      [{ ip: "192.0.2.1", nvt_oid: "nuovo-a" }, { ip: "192.0.2.3", nvt_oid: "terzo" }],
    );
    assert.equal(((runs()[1]) as { finding_count: number }).finding_count, 2);
    assert.equal(ultimaNonRiuscita(d, scannerId), null, "un giro in corso non è una scansione fallita");
  }));

test("alla chiusura restano solo i definitivi, anche se la scansione ha chiuso prima di last_sync_at", () =>
  dentro(async () => {
    const d = getTenantDb(T);
    sonda.running = [scan(7, "rep-aperta", "running", ts(3 * ORA), null, 1)];
    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "in-corso", ts(ORA))]];
    await runVulnSync();
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "in-corso" }]);

    // La scansione chiude mentre la sincronia precedente sta ancora girando: chiusura e definitivi
    // precedono il last_sync_at che quella sincronia scrive in fondo. L'edge applica `since` davvero.
    const chiusura = ts(5 * 60_000);
    d.prepare("UPDATE vuln_scanners SET last_sync_at = ? WHERE id = ?").run(ts(60_000), scannerId);
    // Un rilievo di un altro giro, già importato, con scanned_at nella stessa finestra: non va riscaricato.
    const altro = Number(d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, edge_scan_uid, status) VALUES (?, 3, 'altro', 'done')").run(scannerId).lastInsertRowid);
    d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, scanned_at) VALUES (?, '192.0.2.50', 'High', 'altro', ?)").run(altro, ts(2 * 60_000));
    sonda.running = [];
    sonda.inCorso = {};
    sonda.done = [scan(7, "rep-aperta", "done", ts(3 * ORA), chiusura, 3)];
    sonda.cve = [
      riga(7, "192.0.2.1", "def-1", chiusura), riga(7, "192.0.2.1", "def-2", chiusura), riga(7, "192.0.2.2", "def-3", chiusura),
      riga(3, "192.0.2.50", "altro", ts(2 * 60_000)),
    ];

    const e = await runVulnSync();
    assert.equal(e.ok, true);
    assert.deepEqual(rilievi(), [
      { ip: "192.0.2.1", nvt_oid: "def-1" }, { ip: "192.0.2.1", nvt_oid: "def-2" }, { ip: "192.0.2.2", nvt_oid: "def-3" },
      { ip: "192.0.2.50", nvt_oid: "altro" },
    ]);
    assert.deepEqual(
      runs().map((r) => r as { status: string; finding_count: number }).map((r) => [r.status, r.finding_count]),
      [["done", 3], ["done", 1]],
    );
    // Una terza sincronia non raddoppia niente.
    await runVulnSync();
    assert.equal(rilievi().length, 4);
  }));

test("una chiusura con errore e rilievi diventa parziale, col motivo, e toglie quelli in corso", () =>
  dentro(async () => {
    sonda.running = [scan(7, "rep-aperta", "running", ts(3 * ORA), null, 1)];
    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "in-corso", ts(ORA))]];
    await runVulnSync();

    sonda.running = [];
    sonda.inCorso = {};
    sonda.error = [scan(7, "rep-aperta", "error", ts(3 * ORA), ts(60_000), 1, "scansione ferma al 98%")];
    sonda.cve = [riga(7, "192.0.2.1", "def-1", ts(60_000))];
    await runVulnSync();
    assert.deepEqual(runs(), [{ edge_scan_uid: "rep-aperta", status: "parziale", finding_count: 1, error_message: "scansione ferma al 98%" }]);
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "def-1" }]);
    assert.equal(ultimaNonRiuscita(getTenantDb(T), scannerId)?.status, "parziale");
  }));

test("una sonda vecchia (422, 404) non ferma la sincronia né sporca lo scanner", () =>
  dentro(async () => {
    sonda.vecchia = true;
    const prima = scanner().last_sync_at;
    sonda.done = [scan(9, "rep-chiusa", "done", ts(2 * ORA), ts(60_000), 1)];
    sonda.cve = [riga(9, "192.0.2.9", "def", ts(60_000))];
    const e = await runVulnSync();
    assert.equal(e.ok, true);
    assert.equal(e.error, undefined);
    const s = scanner();
    assert.equal(s.last_error, null);
    assert.equal(s.consecutive_errors, 0);
    assert.notEqual(s.last_sync_at, prima, "last_sync_at avanza come sempre");
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.9", nvt_oid: "def" }], "il flusso normale è arrivato");
  }));

test("una pagina fallita non cancella niente", () =>
  dentro(async () => {
    sonda.running = [scan(7, "rep-aperta", "running", ts(ORA), null, 2)];
    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "a", ts(100))]];
    await runVulnSync();
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "a" }]);

    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "b", ts(100))], [riga(7, "192.0.2.2", "c", ts(100))]];
    sonda.inCorsoRotto = true;
    const e = await runVulnSync();
    assert.equal(e.ok, true, "la sincronia non si ferma");
    assert.equal(scanner().last_error, null);
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "a" }], "i vecchi restano, i nuovi non entrano a metà");

    sonda.inCorsoRotto = false;
    await runVulnSync();
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "b" }, { ip: "192.0.2.2", nvt_oid: "c" }], "tutte le pagine");
  }));

test("una lista vuota di una scansione che ha già chiuso non cancella i rilievi tenuti", () =>
  dentro(async () => {
    sonda.running = [scan(7, "rep-aperta", "running", ts(ORA), null, 1)];
    sonda.inCorso[7] = [[riga(7, "192.0.2.1", "a", ts(100))]];
    await runVulnSync();
    // Chiusa fra l'elenco e la richiesta dei rilievi: la sonda risponde lista vuota.
    sonda.inCorso[7] = [[]];
    await runVulnSync();
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "a" }]);
  }));

test("un giro aperto che la sonda non dà più da oltre 48 ore diventa parziale e tiene i suoi rilievi", () =>
  dentro(async () => {
    const d = getTenantDb(T);
    const ins = d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, edge_scan_uid, status, started_at) VALUES (?, ?, ?, 'in_corso', ?)");
    const vecchio = Number(ins.run(scannerId, 11, "vecchio", ts(50 * ORA)).lastInsertRowid);
    ins.run(scannerId, 12, "recente", ts(5 * ORA));
    const vuoto = Number(ins.run(scannerId, 13, "vuoto", ts(60 * ORA)).lastInsertRowid);
    d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, scanned_at) VALUES (?, '192.0.2.1', 'High', 'tenuto', ?)").run(vecchio, ts(49 * ORA));
    void vuoto;
    await runVulnSync();
    assert.deepEqual(
      runs().map((r) => r as { edge_scan_uid: string; status: string }).map((r) => [r.edge_scan_uid, r.status]),
      [["vecchio", "parziale"], ["recente", "in_corso"], ["vuoto", "error"]],
    );
    assert.deepEqual(rilievi(), [{ ip: "192.0.2.1", nvt_oid: "tenuto" }]);
  }));
