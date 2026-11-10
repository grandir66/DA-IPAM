process.env.ENCRYPTION_KEY ||= "test-encryption-key-gravita-per-motore";

/**
 * Gravità attribuita al motore giusto (Riccardo, 10/11/2026: «è realistico che quasi tutti i
 * rilievi della sonda Edge siano critici? C'è un errore di attribuzione»). Tre difetti misurati
 * sull'hub, sul DB vero di un tenant di prova:
 *  - una CVE vista da Edge prendeva la gravità e gli host di Wazuh (e viceversa);
 *  - gli avvisi di pacchetto di Greenbone danno a ogni CVE il punteggio più alto dell'avviso;
 *  - l'elenco si fermava alle prime 2.000 per gravità, e di Edge restavano quasi solo le critiche.
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, getAggregatedVulnerabilities } from "@/lib/db-tenant";
import { elencoRilievi } from "@/lib/rilievi/unione";

const T = "TESTGRAVITAMOTORE";
after(() => deleteTenantDatabase(T));

let hEdge = 0;
let hWazuh = 0;

before(() =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'LAN prova')").run().lastInsertRowid);
    hEdge = Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname, os_info) VALUES (?, '192.0.2.40', 'visto-da-edge', 'Ubuntu 22.04')").run(rete).lastInsertRowid);
    hWazuh = Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname, os_info) VALUES (?, '192.0.2.9', 'visto-da-wazuh', 'Ubuntu 22.04')").run(rete).lastInsertRowid);
    const scanner = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('Scanner-Edge', 'https://192.0.2.10:6443', 'x')").run().lastInsertRowid);
    const run = Number(d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, finding_count, status) VALUES (?, 1, 2, 'done')").run(scanner).lastInsertRowid);
    const f = d.prepare(
      `INSERT INTO vuln_findings (host_id, scan_run_id, ip, port, cve_id, cvss_score, severity, nvt_oid, nvt_name, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 days'))`,
    );
    // Avviso di pacchetto: Greenbone scrive il punteggio dell'avviso (9.1), la CVE vale 6.3.
    f.run(hEdge, run, "192.0.2.40", "package", "CVE-2026-56367", 9.1, "Critical", "1.3.6.1.4.1.25623.1.1.12.2026.8859.1", "Ubuntu: Security Advisory (USN-8859-1)");
    // Test di rete normale: il suo punteggio è suo e non si tocca.
    f.run(hEdge, run, "192.0.2.40", "8080/tcp", "CVE-2025-24813", 9.8, "Critical", "1.3.6.1.4.1.25623.1.0.154161", "Apache Tomcat RCE Vulnerability");
    d.prepare("INSERT INTO wazuh_agent (agent_id, host_id, name, ip) VALUES ('001', ?, 'visto-da-wazuh', '192.0.2.9')").run(hWazuh);
    d.prepare(
      `INSERT INTO wazuh_vuln (agent_id, cve, severity, cvss3_score, package_name, package_version, status, detection_time)
       VALUES ('001', 'CVE-2026-56367', 'Low', 3.7, 'imagemagick-6-common', '6.9', 'VALID', datetime('now', '-1 days'))`,
    ).run();
  }),
);

const cvssDi = (cves: string[]) => new Map(cves.filter((c) => c === "CVE-2026-56367").map((c) => [c, { cvss: 6.3 }]));

test("avviso di pacchetto di Greenbone: vale il punteggio proprio della CVE, e solo al ribasso", () => {
  withTenant(T, () => {
    const senza = getAggregatedVulnerabilities({ page: 1, pageSize: 50, soloMotore: "edge" }).data;
    assert.equal(senza.find((v) => v.key === "CVE-2026-56367")?.severity, "Critical");
    const con = getAggregatedVulnerabilities({ page: 1, pageSize: 50, soloMotore: "edge", cvssDi }).data;
    const cve = con.find((v) => v.key === "CVE-2026-56367");
    assert.equal(cve?.severity, "Medium");
    assert.equal(cve?.cvss_score, 6.3);
    assert.equal(con.find((v) => v.key === "CVE-2025-24813")?.severity, "Critical");
  });
});

test("un motore solo: gravità e host sono i suoi, non quelli dell'altro", () => {
  withTenant(T, () => {
    const edge = elencoRilievi({ fonti: ["edge"], cvssDi, ospite: hWazuh });
    assert.equal(edge.total, 0, "Edge non ha visto niente sull'host che conosce solo Wazuh");
    const suEdge = elencoRilievi({ fonti: ["edge"], cvssDi, ospite: hEdge });
    assert.deepEqual(suEdge.data.map((r) => [r.titolo, r.gravita, r.ip]).sort(), [
      ["CVE-2025-24813", "Critical", "192.0.2.40"],
      ["CVE-2026-56367", "Medium", "192.0.2.40"],
    ]);
    const wazuh = elencoRilievi({ fonti: ["wazuh"], cvssDi });
    assert.deepEqual(wazuh.data.map((r) => [r.titolo, r.gravita, r.host_count]), [["CVE-2026-56367", "Low", 1]]);
    assert.equal(wazuh.perFonte.edge, 2, "le schede dei motori contano comunque tutte le CVE di ciascuno");
  });
});

test("tutti i motori: la CVE è una riga sola, con la gravità che ha su ciascun host", () => {
  withTenant(T, () => {
    const suWazuh = elencoRilievi({ cvssDi, ospite: hWazuh });
    assert.deepEqual(suWazuh.data.map((r) => [r.titolo, r.gravita, r.ip]), [["CVE-2026-56367", "Low", "192.0.2.9"]]);
    const perHost = elencoRilievi({ cvssDi, raggruppa: "host" }).gruppi ?? [];
    assert.deepEqual(perHost.find((g) => g.nome === "visto-da-wazuh")?.gravita, { Critical: 0, High: 0, Medium: 0, Low: 1 });
  });
});
