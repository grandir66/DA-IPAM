process.env.ENCRYPTION_KEY ||= "test-encryption-key-rilievi-controlli";

/**
 * «overall_grade» Critical su 60 host della 533 (Riccardo, 03/11/2026: «ho ancora questa evidenza»):
 * righe della sonda di prima con IP «nome/IP», voto riassuntivo e avvisi dello strumento come rilievi.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/rilievi-controlli.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, getAggregatedVulnerabilities } from "@/lib/db-tenant";
import { normalizzaRilievoControllo, ripulisciRilieviControlli } from "@/lib/vuln/rilievi-controlli";

const T = "TESTRILIEVICONTROLLI";
after(() => deleteTenantDatabase(T));
const oggi = new Date().toISOString().slice(0, 19).replace("T", " ");

test("all'arrivo: IP senza nome davanti, voto e avvisi a Log, autofirmato Media", () => {
  const f = (nome: string, sev = "Critical") =>
    normalizzaRilievoControllo({ ip: "192.168.40.9/192.168.40.9", severity: sev, nvt_oid: "controllo:tls-deep:tls_weakness", nvt_name: nome });
  assert.deepEqual([f("overall_grade").severity, f("scanTime", "High").severity, f("cmdline_ip-target", "High").severity], ["Log", "Log", "Log"]);
  assert.equal(f("cert_chain_of_trust").severity, "Medium");
  assert.equal(f("heartbleed").severity, "Critical");
  assert.equal(f("heartbleed").ip, "192.168.40.9");
  // Un identificativo per rilievo, non uno per modulo (prima tutto si fondeva sotto «overall_grade»).
  assert.equal(f("heartbleed").nvt_oid, "controllo:tls-deep:tls_weakness:heartbleed");
  // Le altre fonti non si toccano.
  const g = normalizzaRilievoControllo({ ip: "a/b", severity: "Critical", nvt_oid: "1.3.6.1", nvt_name: "overall_grade" });
  assert.deepEqual([g.ip, g.severity], ["a/b", "Critical"]);
});

test("righe già salvate: spariscono dalla vista, agganciate all'host, idempotente", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.168.40.0/24', 'LAN')").run().lastInsertRowid);
    const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '192.168.40.9')").run(rete).lastInsertRowid);
    const sc = Number(d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E', 'https://x', 'x')").run().lastInsertRowid);
    const run = Number(d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, network_id, status) VALUES (?, 1, ?, 'done')").run(sc, rete).lastInsertRowid);
    const ins = d.prepare(`INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, nvt_name, scanned_at)
                           VALUES (?, '192.168.40.9/192.168.40.9', ?, 'controllo:tls-deep:tls_weakness', ?, ?)`);
    ins.run(run, "Critical", "overall_grade", oggi);
    ins.run(run, "High", "scanTime", oggi);
    ins.run(run, "Critical", "cert_caIssuers", oggi);
    ins.run(run, "Critical", "heartbleed", oggi);
    assert.ok(ripulisciRilieviControlli(d) > 0);
    d.prepare("UPDATE vuln_findings SET host_id = (SELECT id FROM hosts WHERE hosts.ip = vuln_findings.ip) WHERE host_id IS NULL").run();
    const righe = d.prepare("SELECT ip, host_id, severity, nvt_name FROM vuln_findings ORDER BY id").all();
    assert.equal((d.prepare("SELECT nvt_oid FROM vuln_findings WHERE nvt_name = 'heartbleed'").get() as { nvt_oid: string }).nvt_oid,
      "controllo:tls-deep:tls_weakness:heartbleed");
    assert.deepEqual(righe, [
      { ip: "192.168.40.9", host_id: host, severity: "Log", nvt_name: "overall_grade" },
      { ip: "192.168.40.9", host_id: host, severity: "Log", nvt_name: "scanTime" },
      { ip: "192.168.40.9", host_id: host, severity: "Medium", nvt_name: "cert_caIssuers" },
      { ip: "192.168.40.9", host_id: host, severity: "Critical", nvt_name: "heartbleed" },
    ]);
    const r = getAggregatedVulnerabilities({ page: 1, pageSize: 50 });
    const nomi = r.data.map((v) => `${v.package_label ?? ""} ${v.key}`);
    assert.equal(r.data.length, 2); // heartbleed e autofirmato, non il voto né gli avvisi
    assert.ok(!nomi.some((n) => String(n).includes("overall_grade")));
    assert.equal(ripulisciRilieviControlli(d), 0);
  }),
);
