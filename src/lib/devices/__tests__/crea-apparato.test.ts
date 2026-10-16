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

  // Tappa 2e (T20, 16/10): utente e password diventavano colonne dell'apparato
  // più un binding inline, che la pagina non mostra come voce e che la 2g
  // smetterà di leggere.
  it("utente e password → 0 colonne scritte, 1 voce «<nome> · SSH», 1 binding che la punta", () => {
    const d = getTenantDb(T);
    const vociPrima = (d.prepare(`SELECT COUNT(*) AS n FROM credentials`).get() as { n: number }).n;
    const esito = withTenant(T, () =>
      creaApparato({ name: "fw nuovo", host: "10.40.0.40", device_type: "router", classification: "firewall", vendor: "other", protocol: "ssh", username: "admin", password: "segreta", community_string: "c0mm" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const colonne = d
      .prepare(`SELECT credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token FROM network_devices WHERE id = ?`)
      .get(esito.device.id);
    assert.deepEqual(colonne, { credential_id: null, snmp_credential_id: null, username: null, encrypted_password: null, community_string: null, api_token: null });
    const binding = d
      .prepare(`SELECT b.protocol_type, b.port, b.inline_username, b.inline_encrypted_password, c.name, c.credential_type FROM device_credential_bindings b JOIN credentials c ON c.id = b.credential_id WHERE b.device_id = ? ORDER BY b.sort_order, b.id`)
      .all(esito.device.id);
    assert.deepEqual(binding, [
      { protocol_type: "ssh", port: 22, inline_username: null, inline_encrypted_password: null, name: "fw nuovo · SSH", credential_type: "ssh" },
      { protocol_type: "snmp", port: 161, inline_username: null, inline_encrypted_password: null, name: "fw nuovo · SNMP", credential_type: "snmp" },
    ]);
    assert.equal((d.prepare(`SELECT COUNT(*) AS n FROM credentials`).get() as { n: number }).n, vociPrima + 2);
  });

  it("voce d'archivio scelta più una community scritta: il binding della voce, la community non va in colonna", () => {
    const d = getTenantDb(T);
    const esito = withTenant(T, () =>
      creaApparato({ name: "sw2", host: "10.40.0.41", device_type: "switch", classification: "switch", vendor: "hp", protocol: "ssh", snmp_credential_id: 7, community_string: "ignorata" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const c = d.prepare(`SELECT username, encrypted_password, community_string, api_token FROM network_devices WHERE id = ?`).get(esito.device.id);
    assert.deepEqual(c, { username: null, encrypted_password: null, community_string: null, api_token: null });
    const b = d.prepare(`SELECT credential_id, protocol_type, port FROM device_credential_bindings WHERE device_id = ?`).all(esito.device.id);
    assert.deepEqual(b, [{ credential_id: 7, protocol_type: "snmp", port: 1161 }]);
  });

  it("utente senza password: 400 e nessun apparato creato", () => {
    const d = getTenantDb(T);
    const esito = withTenant(T, () =>
      creaApparato({ name: "mezzo", host: "10.40.0.42", device_type: "server", vendor: "linux", protocol: "ssh", username: "root" })
    );
    assert.equal(esito.ok, false);
    if (!esito.ok) assert.equal(esito.status, 400);
    assert.equal(d.prepare(`SELECT id FROM network_devices WHERE host = '10.40.0.42'`).get(), undefined);
  });
});
