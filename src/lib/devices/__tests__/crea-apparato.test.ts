/**
 * POST /api/devices senza la parte HTTP (tappa 1 credenziali, 15/10).
 *
 * Incidenti: senza classificazione ogni apparato che non fosse router o switch
 * diventava «hypervisor», e la stessa classificazione finiva sull'host; una
 * classificazione fuori elenco («printer», scritta dal classificatore) passava
 * e l'apparato spariva dalle liste per classificazione; il binding della
 * credenziale SNMP era sempre sulla 161, anche con la porta propria.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/crea-apparato.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-crea-apparato";

import { creaApparato } from "../crea-apparato";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";

const T = "TESTCREAAPPARATO";

describe("creaApparato", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.40.0.0/24', 'prova')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip, classification) VALUES (1, 1, '10.40.0.5', 'unknown')`).run();
      d.prepare(`INSERT INTO credentials (id, name, credential_type, port) VALUES (7, 'snmp fuori standard', 'snmp', 1161)`).run();
    });
  });
  after(() => deleteTenantDatabase(T));

  it("senza classificazione e tipo «server» → apparato e host classificati server (non hypervisor)", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "srv", host: "10.40.0.5", device_type: "server", vendor: "windows", protocol: "winrm" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(esito.device.classification, "server");
    const host = getTenantDb(T).prepare(`SELECT classification FROM hosts WHERE id = 1`).get() as { classification: string };
    assert.equal(host.classification, "server");
  });

  it("classificazione fuori elenco («printer») → 400 con messaggio in italiano", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "stampa", host: "10.40.0.9", device_type: "server", vendor: "other", protocol: "snmp_v2", classification: "printer" })
    );
    assert.equal(esito.ok, false);
    if (!esito.ok) {
      assert.equal(esito.status, 400);
      assert.match(esito.error, /Classificazione non valida/);
    }
  });

  it("un Mac (apple + scansione macOS) si salva (tappa 1b)", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "mac", host: "10.40.0.30", device_type: "server", classification: "notebook", vendor: "apple", protocol: "ssh", scan_target: "macos" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(esito.device.vendor, "apple");
    assert.equal(esito.device.scan_target, "macos");
  });

  it("binding SNMP da una credenziale con porta 1161 → binding sulla 1161", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "sw", host: "10.40.0.20", device_type: "switch", classification: "switch", vendor: "mikrotik", protocol: "ssh", snmp_credential_id: 7 })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const b = getTenantDb(T)
      .prepare(`SELECT port FROM device_credential_bindings WHERE device_id = ? AND protocol_type = 'snmp'`)
      .get(esito.device.id) as { port: number };
    assert.equal(b.port, 1161);
  });
});
