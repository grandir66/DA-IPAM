process.env.ENCRYPTION_KEY ||= "test-encryption-key-vista-per-host";

/**
 * Vista per host della pagina Vulnerabilità ed exploit noti (Riccardo, 22/10), sul DB vero di un
 * tenant di prova: righe Edge (Greenbone) e Wazuh come le scrivono i due sync.
 *
 * Casi che contano: una CVE su due porte dello stesso host conta una volta; un IP senza host
 * agganciato resta in elenco (`ip:`); la ricerca trova per IP e nome; il filtro exploit e
 * l'ordinamento mettono in cima chi ha CVE sfruttate davvero.
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import {
  getAggregatedVulnerabilities,
  getVulnerabilitiesByHost,
  getVulnerabilitiesOfHost,
  type ExploitDi,
} from "@/lib/db-tenant";
import type { ExploitInfo } from "@/lib/vuln/exploit-feed/archivio";

const T = "TESTVISTAPERHOST";
after(() => deleteTenantDatabase(T));

const info = (o: Partial<ExploitInfo>): ExploitInfo => ({
  kev: false, kev_data: null, ransomware: false, edb: 0, edb_verificati: 0, epss: null, epss_percentile: null, ...o,
});
const ARCHIVIO = new Map<string, ExploitInfo>([
  ["CVE-2021-44228", info({ kev: true, kev_data: "2021-12-10", ransomware: true, edb: 1, epss: 0.99999 })],
  ["CVE-2024-6387", info({ edb: 1, epss: 0.995 })],
  ["CVE-2016-2183", info({ epss: 0.04 })],
]);
const exploitDi: ExploitDi = (cves) => new Map(cves.filter((c) => ARCHIVIO.has(c)).map((c) => [c, ARCHIVIO.get(c)!]));

let hFile = 0;
let hPc = 0;

before(() =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'LAN prova')").run().lastInsertRowid);
    hFile = Number(
      d.prepare("INSERT INTO hosts (network_id, ip, hostname, os_info) VALUES (?, '192.0.2.5', 'srv-file01', 'Windows Server 2019')").run(rete).lastInsertRowid,
    );
    hPc = Number(
      d.prepare("INSERT INTO hosts (network_id, ip, hostname, os_info) VALUES (?, '192.0.2.23', 'pc-ammin-03', 'Windows 11')").run(rete).lastInsertRowid,
    );
    const scanner = Number(
      d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('Scanner-Edge', 'https://192.0.2.10:6443', 'x')").run().lastInsertRowid,
    );
    const run = Number(
      d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, finding_count, status) VALUES (?, 1, 5, 'done')").run(scanner).lastInsertRowid,
    );
    const f = d.prepare(
      `INSERT INTO vuln_findings (host_id, scan_run_id, ip, port, cve_id, cvss_score, severity, nvt_oid, nvt_name, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-6 days'))`, // relativa: regola dei 90 giorni (28/10)
    );
    // Log4j sullo stesso host su due porte: una vulnerabilità sola
    f.run(hFile, run, "192.0.2.5", "8443/tcp", "CVE-2021-44228", 10, "Critical", "1.3.6.1.4.1.25623.1.0.1", "Apache Log4j");
    f.run(hFile, run, "192.0.2.5", "9443/tcp", "CVE-2021-44228", 10, "Critical", "1.3.6.1.4.1.25623.1.0.1", "Apache Log4j");
    f.run(hFile, run, "192.0.2.5", "443/tcp", "CVE-2016-2183", 7.5, "High", "1.3.6.1.4.1.25623.1.0.2", "SSL/TLS: Vulnerable Cipher Suites");
    f.run(hFile, run, "192.0.2.5", "22/tcp", null, 5.3, "Medium", "1.3.6.1.4.1.25623.1.0.3", "Weak Key Exchange (KEX)");
    // IP non agganciato a nessun host
    f.run(null, run, "192.0.2.77", "22/tcp", "CVE-2024-6387", 8.1, "High", "1.3.6.1.4.1.25623.1.0.4", "OpenSSH regreSSHion");

    d.prepare("INSERT INTO wazuh_agent (agent_id, host_id, name, ip) VALUES ('001', ?, 'pc-ammin-03', '192.0.2.23')").run(hPc);
    d.prepare(
      `INSERT INTO wazuh_vuln (agent_id, cve, severity, cvss3_score, package_name, package_version, status, detection_time)
       VALUES ('001', 'CVE-2016-2183', 'High', 7.5, 'openssl', '1.0.2', 'VALID', '2026-10-21 10:00:00')`,
    ).run();
  }),
);

const base = { page: 1, pageSize: 50, exploitDi };

test("per host: una riga per host, CVE su due porte contata una volta, IP senza match incluso", () =>
  withTenant(T, () => {
    const r = getVulnerabilitiesByHost(base);
    assert.equal(r.total, 3);
    const file = r.data.find((h) => h.host_key === `h:${hFile}`)!;
    assert.equal(file.hostname, "srv-file01");
    assert.equal(file.network_name, "LAN prova");
    assert.equal(file.os_family, "Windows");
    assert.deepEqual(file.counts, { Critical: 1, High: 1, Medium: 1, Low: 0 });
    assert.equal(file.vuln_count, 3);
    assert.equal(file.kev_count, 1);
    assert.equal(file.edb_count, 1);
    assert.equal(file.epss_max, 0.99999);
    const orfano = r.data.find((h) => h.host_key === "ip:192.0.2.77")!;
    assert.equal(orfano.host_id, null);
    assert.equal(orfano.edb_count, 1);
    // ordine per gravità: il Critical prima
    assert.equal(r.data[0]!.host_key, `h:${hFile}`);
    // il riepilogo in testa conta le vulnerabilità distinte, come la vista per CVE
    assert.deepEqual(r.severity_rollup, getAggregatedVulnerabilities(base).severity_rollup);
  }));

test("per host: ricerca per IP e per nome, filtro exploit, ordinamento per exploit", () =>
  withTenant(T, () => {
    assert.deepEqual(getVulnerabilitiesByHost({ ...base, search: "pc-ammin" }).data.map((h) => h.host_key), [`h:${hPc}`]);
    assert.deepEqual(getVulnerabilitiesByHost({ ...base, search: "192.0.2.77" }).data.map((h) => h.host_key), ["ip:192.0.2.77"]);
    assert.deepEqual(getVulnerabilitiesByHost({ ...base, exploit: ["kev"] }).data.map((h) => h.host_key), [`h:${hFile}`]);
    assert.deepEqual(
      getVulnerabilitiesByHost({ ...base, exploit: ["edb"] }).data.map((h) => h.host_key).sort(),
      [`h:${hFile}`, "ip:192.0.2.77"].sort(),
    );
    const perExploit = getVulnerabilitiesByHost({ ...base, sortBy: "exploit" }).data.map((h) => h.host_key);
    assert.deepEqual(perExploit, [`h:${hFile}`, "ip:192.0.2.77", `h:${hPc}`]);
    // filtro sulle sorgenti: con solo Wazuh resta il PC
    assert.deepEqual(getVulnerabilitiesByHost({ ...base, sources: ["Wazuh"] }).data.map((h) => h.host_key), [`h:${hPc}`]);
  }));

test("dettaglio dell'host: tutte le sue vulnerabilità, sfruttate in cima, porte distinte", () =>
  withTenant(T, () => {
    const v = getVulnerabilitiesOfHost(`h:${hFile}`, exploitDi)!;
    assert.deepEqual(v.map((x) => x.key), ["CVE-2021-44228", "CVE-2016-2183", "nvt:1.3.6.1.4.1.25623.1.0.3"]);
    assert.deepEqual(v[0]!.ports.sort(), ["8443/tcp", "9443/tcp"]);
    assert.equal(v[0]!.exploit?.ransomware, true);
    assert.equal(v[2]!.exploit, null);
    assert.deepEqual(getVulnerabilitiesOfHost("ip:192.0.2.77", exploitDi)!.map((x) => x.cve_id), ["CVE-2024-6387"]);
    assert.equal(getVulnerabilitiesOfHost("ciao", exploitDi), null);
  }));

test("per CVE: exploit sulla riga, filtro «sfruttate», ricerca per nome host, ordinamento per exploit", () =>
  withTenant(T, () => {
    const tutte = getAggregatedVulnerabilities(base);
    assert.equal(tutte.data.find((r) => r.key === "CVE-2021-44228")!.exploit?.kev, true);
    assert.equal(tutte.data.find((r) => r.key === "nvt:1.3.6.1.4.1.25623.1.0.3")!.exploit, null);
    assert.deepEqual(getAggregatedVulnerabilities({ ...base, exploit: ["kev"] }).data.map((r) => r.key), ["CVE-2021-44228"]);
    assert.deepEqual(getAggregatedVulnerabilities({ ...base, search: "pc-ammin" }).data.map((r) => r.key), ["CVE-2016-2183"]);
    assert.deepEqual(
      getAggregatedVulnerabilities({ ...base, sortBy: "exploit" }).data.map((r) => r.key).slice(0, 2),
      ["CVE-2021-44228", "CVE-2024-6387"],
    );
    // senza archivio (feed mai scaricati) la vista funziona come prima
    assert.equal(getAggregatedVulnerabilities({ page: 1, pageSize: 50 }).data.every((r) => r.exploit === null), true);
  }));
