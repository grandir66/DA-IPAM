process.env.ENCRYPTION_KEY ||= "test-encryption-key-riaggancia-host";

/**
 * 79994-ipam-3 (29/10/2026): la sonda aveva scansionato 192.168.4.0/24 prima che DA-IPAM conoscesse la
 * rete; i rilievi restavano «senza match» anche dopo la scoperta degli host. Si riagganciano per IP alla
 * sincronia, solo se l'IP è di un host solo.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { riagganciaHost } from "@/lib/vuln/sync-job";

const T = "TESTRIAGGANCIAHOST";
after(() => deleteTenantDatabase(T));

test("rilievi senza host si agganciano quando l'host compare; IP ambiguo resta libero", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const reteA = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'A')").run().lastInsertRowid);
    const reteB = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('198.51.100.0/24', 'B')").run().lastInsertRowid);
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('e', 'https://x', 'x')").run().lastInsertRowid);
    const run = Number(d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, status) VALUES (?, 1, 'done')").run(sc).lastInsertRowid);
    const f = d.prepare("INSERT INTO vuln_findings (host_id, scan_run_id, ip, severity, nvt_oid, scanned_at) VALUES (NULL, ?, ?, 'High', 'x', datetime('now'))");
    f.run(run, "192.0.2.41");
    f.run(run, "192.0.2.99");
    f.run(run, "192.0.2.50");
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '192.0.2.41')").run(reteA).lastInsertRowid);
    // stesso IP in due reti: non si sa quale, resta senza aggancio
    d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '192.0.2.50')").run(reteA);
    d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '192.0.2.50')").run(reteB);

    assert.equal(riagganciaHost(d), 1);
    const per = (ip: string) => (d.prepare("SELECT host_id FROM vuln_findings WHERE ip = ?").get(ip) as { host_id: number | null }).host_id;
    assert.equal(per("192.0.2.41"), h);
    assert.equal(per("192.0.2.99"), null);
    assert.equal(per("192.0.2.50"), null);
  }),
);
