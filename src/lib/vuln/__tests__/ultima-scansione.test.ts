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
    f.run(maggio, "1.1", "Rilievo di maggio", "2026-05-22 02:00:00");
    f.run(ottobre, "1.2", "Rilievo di ottobre", "2026-10-27 02:00:00");
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
