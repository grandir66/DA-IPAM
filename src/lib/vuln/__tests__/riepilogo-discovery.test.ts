process.env.ENCRYPTION_KEY ||= "test-encryption-key-riepilogo-discovery";

/**
 * Colonne «CVE» e «CVE C/H/M» della Discovery: si contano le CVE di oggi, una volta sola per host.
 *
 * Riccardo (08/11/2026): «l'elenco delle vulnerabilità non mostra solo le informazioni più recenti, i numeri non sono
 * realistici». Misurato sull'hub 533 lo stesso giorno: lo scanner era già all'ultima scansione (1.623 rilievi attuali su
 * 14.947), ma il riepilogo contava RIGHE: la stessa CVE su due porte, su due pacchetti, o vista sia dallo scanner sia da
 * Wazuh valeva due o tre; e i kernel Linux vecchi rimasti installati accanto a quello nuovo portavano le loro CVE.
 * 70.637 righe contate contro 51.925 CVE vere per host.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/riepilogo-discovery.test.ts
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  withTenant, getTenantDb, deleteTenantDatabase, getAllHostsVulnSummary, invalidateAllHostsVulnSummaryCache,
} from "@/lib/db-tenant";
import { kernelSuperati } from "@/lib/vuln/riepilogo-host";

const T = "TESTRIEPILOGODISCOVERY";
const giorniFa = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
let host = 0;
after(() => deleteTenantDatabase(T));

before(() =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'LAN')").run().lastInsertRowid);
    host = Number(d.prepare("INSERT INTO hosts (network_id, ip, last_seen) VALUES (?, '192.0.2.5', ?)").run(rete, giorniFa(0)).lastInsertRowid);
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E', 'https://192.0.2.10', 'x')").run().lastInsertRowid);
    const run = (n: number) => Number(d.prepare(
      "INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, network_id, status) VALUES (?, ?, ?, 'done')").run(sc, n, rete).lastInsertRowid);
    const vecchia = run(1);
    const ultima = run(2);
    const f = d.prepare(`INSERT INTO vuln_findings (host_id, scan_run_id, ip, port, severity, cve_id, nvt_oid, scanned_at)
                         VALUES (?, ?, '192.0.2.5', ?, ?, ?, ?, ?)`);
    f.run(host, vecchia, "443/tcp", "Critical", "CVE-2020-0001", "1.0", giorniFa(20)); // superata: fuori
    f.run(host, ultima, "443/tcp", "High", "CVE-2026-0001", "1.1", giorniFa(1));
    f.run(host, ultima, "8443/tcp", "High", "CVE-2026-0001", "1.1", giorniFa(1));     // stessa CVE, altra porta: una
    f.run(host, ultima, "80/tcp", "Medium", null, "1.2", giorniFa(1));                 // senza CVE: conta l'NVT
    f.run(host, ultima, "22/tcp", "High", "CVE-2026-0002", "1.3", giorniFa(1));       // la vede anche Wazuh, Critical
    f.run(host, ultima, "general/tcp", "Log", null, "1.4", giorniFa(1));               // informativo: fuori

    d.prepare("INSERT INTO wazuh_agent (agent_id, host_id, name, status, last_keep_alive) VALUES ('001', ?, 'srv', 'active', ?)")
      .run(host, giorniFa(0));
    const w = d.prepare(`INSERT INTO wazuh_vuln (agent_id, cve, severity, package_name, package_version, status)
                         VALUES ('001', ?, ?, ?, ?, ?)`);
    w.run("CVE-2026-0002", "Critical", "openssh-server", "1:9.6p1", "VALID");
    w.run("CVE-2026-1000", "High", "linux-image-6.8.0-147-generic", "6.8.0-147.147", "VALID");
    w.run("CVE-2026-1000", "High", "linux-image-6.8.0-117-generic", "6.8.0-117.117", "VALID"); // stesso CVE, kernel vecchio
    w.run("CVE-2025-2000", "Critical", "linux-image-6.8.0-117-generic", "6.8.0-117.117", "VALID"); // solo sul kernel superato
    w.run("CVE-2026-3000", "Medium", "Google Chrome", "130.0", "VALID");
    w.run("CVE-2026-3000", "Medium", "Google Chrome", "130.1", "VALID");                    // due installazioni: una
    w.run("CVE-2026-4000", "Critical", "curl", "8.5.0", "PENDING");                          // non confermata: fuori
  }),
);

test("una CVE per host una volta sola, con la gravità più alta; superate e kernel vecchi fuori", () =>
  withTenant(T, () => {
    invalidateAllHostsVulnSummaryCache();
    const r = getAllHostsVulnSummary().get(host);
    assert.ok(r, "l'host ha rilievi");
    // Critical: CVE-2026-0002 (scanner High + Wazuh Critical). High: CVE-2026-0001, CVE-2026-1000. Medium: NVT 1.2, CVE-2026-3000.
    assert.deepEqual(
      { max: r.max_severity, c: r.critical, h: r.high, m: r.medium, tot: r.total },
      { max: "Critical", c: 1, h: 2, m: 2, tot: 5 },
    );
  }));

test("kernel superati: per agente resta solo il linux-image più recente", () => {
  const s = kernelSuperati([
    { agent_id: "1", package_name: "linux-image-6.8.0-117-generic", package_version: "6.8.0-117.117" },
    { agent_id: "1", package_name: "linux-image-6.8.0-147-generic", package_version: "6.8.0-147.147" },
    { agent_id: "1", package_name: "linux-image-5.15.0-202-generic", package_version: "5.15.0-202.212" },
    { agent_id: "2", package_name: "linux-image-6.8.0-117-generic", package_version: "6.8.0-117.117" },
  ]);
  assert.deepEqual([...s].sort(), ["1|linux-image-5.15.0-202-generic", "1|linux-image-6.8.0-117-generic"]);
});
