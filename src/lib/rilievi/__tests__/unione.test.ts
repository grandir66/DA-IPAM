/**
 * Elenco Findings: le tre fonti si uniscono, si filtrano, un tenant non vede l'altro.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/unione.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { salvaControlloServizio } from "@/lib/servizi-rete/db";
import { elencoRilievi } from "../unione";

const A = "PROVAUNILEA";
const B = "PROVAUNILEB";

after(() => {
  for (const t of [A, B]) {
    closeTenantDb(t);
    deleteTenantDatabase(t);
  }
  closeHubDb();
});

function reteConTls(tenant: string, ip: string, tls: Record<string, unknown>): void {
  withTenant(tenant, () => {
    const d = getTenantDb(tenant);
    const esistente = d.prepare("SELECT id FROM networks WHERE cidr = '10.9.0.0/24'").get() as { id: number } | undefined;
    const n = esistente?.id ?? Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'lan')").run().lastInsertRowid);
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(n, ip).lastInsertRowid);
    d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, tls_json) VALUES (?, 443, 'tcp', 'tls', ?)",
    ).run(h, JSON.stringify(tls));
  });
}

test("un certificato scaduto compare come giro High", () => {
  reteConTls(A, "10.9.0.8", { expired: false, subject_cn: "box.local", version: "TLSv1.3", not_after: "2020-01-01" });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"] });
    assert.equal(e.total, 1);
    assert.equal(e.data[0]!.fonte, "giro");
    assert.equal(e.data[0]!.gravita, "High");
    assert.equal(e.perFonte.giro, 1);
    assert.equal(e.rollup.High, 1);
  });
});

test("il tenant B non vede i rilievi di A", () => {
  reteConTls(B, "10.9.0.9", { expired: true, subject_cn: "altro", version: "TLSv1.3" });
  withTenant(B, () => {
    const e = elencoRilievi({ fonti: ["giro"] });
    assert.equal(e.total, 1);
    assert.equal(e.data[0]!.ip, "10.9.0.9");
  });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"] });
    assert.ok(e.data.every((r) => r.ip !== "10.9.0.9"));
  });
});

test("SMB senza firma compare come giro Medium", () => {
  withTenant(A, () => {
    const d = getTenantDb(A);
    const esistente = d.prepare("SELECT id FROM networks WHERE cidr = '10.9.0.0/24'").get() as { id: number } | undefined;
    const n = esistente?.id ?? Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'lan')").run().lastInsertRowid);
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(n, "10.9.0.12").lastInsertRowid);
    d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)",
    ).run(h, JSON.stringify({ fonte: "smb", smb_signing: false, netbios: "PC" }));
  });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"], q: "SMB" });
    assert.ok(e.data.some((r) => r.gravita === "Medium" && /SMB/.test(r.titolo)));
  });
});

test("Telnet in inventario compare come giro Medium", () => {
  withTenant(A, () => {
    const d = getTenantDb(A);
    const esistente = d.prepare("SELECT id FROM networks WHERE cidr = '10.9.0.0/24'").get() as { id: number } | undefined;
    const n = esistente?.id ?? Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'lan')").run().lastInsertRowid);
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(n, "10.9.0.23").lastInsertRowid);
    d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, metodo) VALUES (?, 23, 'tcp', 'connect')").run(h);
  });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"], q: "Telnet" });
    assert.ok(e.data.some((r) => r.gravita === "Medium" && r.ip === "10.9.0.23"));
  });
});

test("filtro gravità: Low non entra se si chiede High, e non entra mai", () => {
  reteConTls(A, "10.9.0.10", { self_signed: true, expired: false, version: "TLSv1.3", subject_cn: "x" });
  withTenant(A, () => {
    const high = elencoRilievi({ fonti: ["giro"], gravita: ["High"] });
    assert.ok(high.data.every((r) => r.gravita === "High"));
    // Dal 10/11/2026 (Riccardo: «i rilievi low, info e vecchi non consideriamoli mai») i bassi
    // non compaiono nemmeno chiedendoli: prima questa prova si aspettava di trovarne almeno uno.
    assert.equal(elencoRilievi({ fonti: ["giro"], gravita: ["Low"] }).total, 0);
  });
});

test("una CVE condivisa appare in Edge e Wazuh e una sola volta in Tutti", () => withTenant(B, () => {
  const d = getTenantDb(B);
  const scanner = d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('Edge', 'https://192.0.2.1', 'x')").run().lastInsertRowid;
  const run = d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, finding_count, status) VALUES (?, 1, 1, 'done')").run(scanner).lastInsertRowid;
  d.prepare(`INSERT INTO vuln_findings (scan_run_id, ip, port, cve_id, severity, scanned_at)
    VALUES (?, '192.0.2.2', '443/tcp', 'CVE-2021-44228', 'Critical', datetime('now'))`).run(run);
  d.prepare("INSERT INTO wazuh_agent (agent_id, name, ip) VALUES ('001', 'wazuh', '192.0.2.3')").run();
  d.prepare(`INSERT INTO wazuh_vuln (agent_id, cve, severity, package_name, package_version, status, detection_time)
    VALUES ('001', 'CVE-2021-44228', 'Critical', 'log4j', '2.1', 'VALID', datetime('now'))`).run();
  const q = "CVE-2021-44228";
  const elenco = elencoRilievi({ q, fonti: ["wazuh"] });
  assert.equal(elenco.total, 1);
  assert.equal(elenco.data[0]?.fonte, "wazuh");
  assert.deepEqual(elenco.perFonte, { edge: 1, wazuh: 1, trunk: 0, giro: 0 });
  assert.equal(elencoRilievi({ q }).total, 1);
}));

test("Redis protetto rimuove il rilievo e conserva gli altri riscontri", () => withTenant(B, () => {
  const d = getTenantDb(B);
  const h = d.prepare("SELECT id FROM hosts WHERE ip = '10.9.0.9'").pluck().get() as number;
  salvaControlloServizio(d, h, 6379, "tcp", { redis_aperto: true, git_env: ".env" });
  assert.equal(elencoRilievi({ q: "Redis" }).total, 1);
  salvaControlloServizio(d, h, 6379, "tcp", { redis_aperto: false });
  assert.equal(elencoRilievi({ q: "Redis" }).total, 0);
  assert.equal(elencoRilievi({ q: ".env" }).total, 1);
}));
