process.env.ENCRYPTION_KEY ||= "test-encryption-key-ultima-scansione";

/**
 * Solo i rilievi dell'ultima scansione (Riccardo, 27/10/2026 sera): «di base devono essere visualizzate
 * quelle presenti nell'ultima scansione e le precedenti solo con la pressione di un pulsante». Sulla 533
 * la pagina mescolava rilievi da maggio a ottobre.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/ultima-scansione.test.ts
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, getAggregatedVulnerabilities, getVulnerabilitiesByHost } from "@/lib/db-tenant";

const T = "TESTULTIMASCANSIONE";
/** «AAAA-MM-GG hh:mm:ss» di n giorni fa, come le scrive SQLite. */
const giorniFa = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
after(() => deleteTenantDatabase(T));

before(() =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'LAN')").run().lastInsertRowid);
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E', 'https://192.0.2.10', 'x')").run().lastInsertRowid);
    const run = (n: number, stato: string) => Number(d.prepare(
      "INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, network_id, status) VALUES (?, ?, ?, ?)").run(sc, n, rete, stato).lastInsertRowid);
    const maggio = run(1, "done");
    const ottobre = run(2, "done");
    run(3, "error");   // una scansione fallita non nasconde l'ultima buona
    const f = d.prepare(`INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, nvt_name, scanned_at)
                         VALUES (?, '192.0.2.5', 'High', ?, ?, ?)`);
    // Date relative a oggi: la regola dei 90 giorni (28/10) le farebbe scadere con quelle fisse.
    f.run(maggio, "1.1", "Rilievo di maggio", giorniFa(30));
    f.run(ottobre, "1.2", "Rilievo di ottobre", giorniFa(1));
  }),
);

const base = { page: 1, pageSize: 50 };

test("di base solo l'ultima scansione buona di ogni rete", () =>
  withTenant(T, () => {
    assert.deepEqual(getAggregatedVulnerabilities(base).data.map((v) => v.package_label), ["Rilievo di ottobre"]);
    assert.equal(getVulnerabilitiesByHost(base).total, 1);
  }));

test("col pulsante anche le precedenti", () =>
  withTenant(T, () => {
    const tutte = getAggregatedVulnerabilities({ ...base, precedenti: true }).data.map((v) => v.package_label).sort();
    assert.deepEqual(tutte, ["Rilievo di maggio", "Rilievo di ottobre"]);
  }));

test("la vista dei rilievi attuali (elenco host, scheda, patch, cruscotto) tiene solo l'ultima scansione", () =>
  withTenant(T, () => {
    const righe = getTenantDb(T).prepare("SELECT nvt_name FROM vuln_findings_attuali").all() as Array<{ nvt_name: string }>;
    assert.deepEqual(righe.map((r) => r.nvt_name), ["Rilievo di ottobre"]);
  }));

/**
 * Regola per host (Riccardo, 27/10/2026 sera): un host spento all'ultima scansione tiene i rilievi della
 * precedente; un rilievo sparisce solo se una scansione successiva di quello stesso IP non lo trova più.
 */
test("per host: chi non c'era all'ultima scansione tiene i rilievi; chi c'era perde quelli risolti", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('203.0.113.0/24', 'LAN')").run().lastInsertRowid);
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E', 'https://x', 'x')").run().lastInsertRowid);
    const run = (n: number) => Number(d.prepare(
      "INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, network_id, status) VALUES (?, ?, ?, 'done')").run(sc, n, rete).lastInsertRowid);
    const prima = run(1), dopo = run(2);
    const f = d.prepare(`INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, nvt_name, scanned_at) VALUES (?, ?, ?, ?, ?, ?)`);
    f.run(prima, "203.0.113.5", "High", "a", "Spento all'ultima: resta", giorniFa(10));
    f.run(prima, "203.0.113.6", "High", "b", "Corretto con un aggiornamento: sparisce", giorniFa(10));
    f.run(dopo, "203.0.113.6", "Log", "c", "Host vivo (riga informativa)", giorniFa(1));
    f.run(dopo, "203.0.113.6", "Medium", "d", "Ancora presente", giorniFa(1));
    const nomi = (getTenantDb(T).prepare("SELECT nvt_name FROM vuln_findings_attuali WHERE severity <> 'Log' AND ip LIKE '203.0.113.%' ORDER BY nvt_name").all() as Array<{ nvt_name: string }>).map((r) => r.nvt_name);
    assert.deepEqual(nomi, ["Ancora presente", "Spento all'ultima: resta"]);
    const pagina = getAggregatedVulnerabilities({ page: 1, pageSize: 50, search: "203.0.113." }).data.map((v) => v.package_label).sort();
    assert.deepEqual(pagina, ["Ancora presente", "Spento all'ultima: resta"]);
  }));

/**
 * Host spariti (Riccardo, 28/10/2026): StefanoNB sulla 533 mostrava una «sfruttata» di giugno, host mai più
 * visto. Oltre 90 giorni senza discovery né scansione i rilievi escono da viste ed esportazioni, ma restano
 * nell'archivio (pulsante «precedenti»). Se il discovery l'ha visto da poco, i rilievi restano.
 */
test("host non visto da più di 90 giorni: fuori dai rilievi attuali, dentro l'archivio", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('198.51.100.0/24', 'LAN')").run().lastInsertRowid);
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E', 'https://y', 'x')").run().lastInsertRowid);
    const run = Number(d.prepare(
      "INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, network_id, status) VALUES (?, 1, ?, 'done')").run(sc, rete).lastInsertRowid);
    const host = d.prepare("INSERT INTO hosts (network_id, ip, last_seen) VALUES (?, ?, ?)");
    host.run(rete, "198.51.100.7", giorniFa(130));  // sparito
    host.run(rete, "198.51.100.8", giorniFa(2));    // scansionato a giugno ma visto dal discovery ieri l'altro
    const f = d.prepare(`INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, nvt_name, scanned_at) VALUES (?, ?, 'Critical', ?, ?, ?)`);
    f.run(run, "198.51.100.7", "x1", "Host sparito", giorniFa(128));
    f.run(run, "198.51.100.8", "x2", "Host ancora in rete", giorniFa(128));
    const attuali = (d.prepare("SELECT nvt_name FROM vuln_findings_attuali WHERE ip LIKE '198.51.100.%'").all() as Array<{ nvt_name: string }>).map((r) => r.nvt_name);
    assert.deepEqual(attuali, ["Host ancora in rete"]);
    const pagina = getAggregatedVulnerabilities({ page: 1, pageSize: 50, search: "198.51.100." }).data.map((v) => v.package_label);
    assert.deepEqual(pagina, ["Host ancora in rete"]);
    const archivio = getAggregatedVulnerabilities({ page: 1, pageSize: 50, search: "198.51.100.", precedenti: true }).data.map((v) => v.package_label).sort();
    assert.deepEqual(archivio, ["Host ancora in rete", "Host sparito"]);
  }));

test("agente Wazuh senza contatto da più di 90 giorni: le sue CVE escono, restano con «precedenti»", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    d.prepare("INSERT INTO wazuh_agent (agent_id, name, ip, last_keep_alive) VALUES ('901', 'pc-dismesso', '198.51.100.40', ?)").run(giorniFa(200));
    d.prepare("INSERT INTO wazuh_agent (agent_id, name, ip, last_keep_alive) VALUES ('902', 'pc-vivo', '198.51.100.41', ?)").run(giorniFa(1));
    const v = d.prepare(`INSERT INTO wazuh_vuln (agent_id, cve, severity, package_name, status) VALUES (?, ?, 'High', ?, 'VALID')`);
    v.run("901", "CVE-2099-0001", "pacchetto-dismesso");
    v.run("902", "CVE-2099-0002", "pacchetto-vivo");
    const chiavi = (precedenti: boolean) =>
      getAggregatedVulnerabilities({ page: 1, pageSize: 50, search: "CVE-2099", precedenti }).data.map((x) => x.key).sort();
    assert.deepEqual(chiavi(false), ["CVE-2099-0002"]);
    assert.deepEqual(chiavi(true), ["CVE-2099-0001", "CVE-2099-0002"]);
  }));
