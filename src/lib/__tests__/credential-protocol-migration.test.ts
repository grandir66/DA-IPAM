/**
 * Test Fase 4b Task 3+4: migrazione del CHECK protocol_type
 * (host_credentials/device_credential_bindings: ssh|snmp|winrm|api →
 * + redfish|onvif, rebuild versionato idempotente in getTenantDb — vedi
 * db-tenant.ts, pattern già usato per scan_history) e la vista di copertura
 * credenziali `getCredentialCoverageByCategory` (§7.6).
 *
 * Pattern migrazione: un tenant DB REALE viene creato con lo schema CORRENTE
 * (TENANT_SCHEMA_SQL, che include già 'redfish'/'onvif'), poi le due tabelle
 * sotto test vengono DROP+ricreate manualmente con il CHECK VECCHIO (come
 * sarebbero su un tenant esistente pre-Task 4) e ripopolate con dati reali —
 * closing la connessione raw prima di richiamare `getTenantDb()`, che è il
 * codice di produzione: deve rilevare il CHECK vecchio e fare il rebuild,
 * preservando i dati preesistenti.
 *
 * Run: node --import tsx --test src/lib/__tests__/credential-protocol-migration.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { resolveDataDir } from "@/lib/data-dir";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { getTenantDb, deleteTenantDatabase, withTenant, getCredentialCoverageByCategory } from "@/lib/db-tenant";

const T_MIGRATE = "TESTPROTOMIGRATE";
const T_COVERAGE = "TESTPROTOCOVERAGE";

function tenantDbPath(code: string): string {
  return path.join(resolveDataDir(), "tenants", `${code}.db`);
}

describe("migrazione protocol_type CHECK (host_credentials/device_credential_bindings)", () => {
  before(() => {
    deleteTenantDatabase(T_MIGRATE); // pulizia da run precedenti interrotti

    const dbPath = tenantDbPath(T_MIGRATE);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    // Schema corrente per TUTTE le tabelle tranne le due sotto test (già include
    // redfish/onvif — verrà sovrascritto subito sotto per queste due, simulando
    // un tenant creato PRIMA di questa migrazione).
    raw.exec(TENANT_SCHEMA_SQL);
    raw.exec(TENANT_INDEXES_SQL);

    // Rimpiazza le due tabelle col CHECK VECCHIO (stato pre-Task 4), stesse
    // colonne di db-tenant-schema.ts prima della migrazione (fail_count e affini
    // erano già stati aggiunti in una release precedente, Task 1b credenziali).
    raw.exec("DROP TABLE host_credentials");
    raw.exec(`CREATE TABLE host_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
      protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api')),
      port INTEGER NOT NULL,
      validated INTEGER NOT NULL DEFAULT 0,
      validated_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_detected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT,
      backoff_until TEXT,
      UNIQUE(host_id, credential_id, protocol_type, port)
    )`);

    raw.exec("DROP TABLE device_credential_bindings");
    raw.exec(`CREATE TABLE device_credential_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      credential_id INTEGER REFERENCES credentials(id) ON DELETE CASCADE,
      protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api')),
      port INTEGER NOT NULL DEFAULT 22,
      sort_order INTEGER NOT NULL DEFAULT 0,
      inline_username TEXT,
      inline_encrypted_password TEXT,
      test_status TEXT NOT NULL DEFAULT 'untested' CHECK(test_status IN ('success', 'failed', 'untested')),
      test_message TEXT,
      tested_at TEXT,
      auto_detected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(device_id, credential_id, protocol_type, port)
    )`);

    // Dati preesistenti reali da preservare attraverso il rebuild.
    raw.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.50.0.0/24', 'migr-net')`).run();
    raw.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.50.0.5')`).run();
    raw.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (1, 'cred-ssh', 'ssh')`).run();
    raw.prepare(
      `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, fail_count)
       VALUES (1, 1, 'ssh', 22, 1, 0, 2)`
    ).run();
    raw.prepare(
      `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'dev-migr', '10.50.0.5', 'server', 'other', 'ssh')`
    ).run();
    raw.prepare(
      `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status)
       VALUES (1, 1, 'ssh', 22, 'success')`
    ).run();

    raw.pragma("foreign_keys = ON");
    raw.close();
  });

  after(() => deleteTenantDatabase(T_MIGRATE));

  it("getTenantDb rileva il CHECK vecchio e ricostruisce le tabelle preservando i dati", () => {
    const d = getTenantDb(T_MIGRATE);

    const hc = d.prepare(`SELECT * FROM host_credentials WHERE host_id = 1 AND credential_id = 1`).get() as {
      protocol_type: string; validated: number; fail_count: number; port: number;
    } | undefined;
    assert.ok(hc, "la riga host_credentials preesistente deve sopravvivere al rebuild");
    assert.equal(hc.protocol_type, "ssh");
    assert.equal(hc.validated, 1);
    assert.equal(hc.fail_count, 2);
    assert.equal(hc.port, 22);

    const dcb = d.prepare(`SELECT * FROM device_credential_bindings WHERE device_id = 1 AND credential_id = 1`).get() as {
      protocol_type: string; test_status: string;
    } | undefined;
    assert.ok(dcb, "la riga device_credential_bindings preesistente deve sopravvivere al rebuild");
    assert.equal(dcb.protocol_type, "ssh");
    assert.equal(dcb.test_status, "success");

    // Il CHECK deve ora accettare 'redfish'/'onvif'.
    assert.doesNotThrow(() => {
      d.prepare(
        `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'onvif', 80)`
      ).run();
    }, "INSERT con protocol_type='onvif' deve riuscire dopo la migrazione");
    assert.doesNotThrow(() => {
      d.prepare(
        `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'redfish', 443)`
      ).run();
    }, "INSERT con protocol_type='redfish' deve riuscire dopo la migrazione");
    assert.doesNotThrow(() => {
      d.prepare(
        `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (1, 1, 'onvif', 80)`
      ).run();
    }, "device_credential_bindings deve accettare 'onvif' dopo la migrazione");

    // CHECK ancora attivo per valori non ammessi.
    assert.throws(() => {
      d.prepare(
        `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'telnet', 23)`
      ).run();
    }, /CHECK constraint failed/);

    // Indici ricreati (query per host_id/sort_order non deve fallire, sintomo di
    // un rebuild che ha perso gli indici).
    const idxRows = d.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='host_credentials'`).all() as Array<{ name: string }>;
    assert.ok(idxRows.some((r) => r.name === "idx_host_credentials_host"));
    assert.ok(idxRows.some((r) => r.name === "idx_host_credentials_validated"));
    const idxRowsDcb = d.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='device_credential_bindings'`).all() as Array<{ name: string }>;
    assert.ok(idxRowsDcb.some((r) => r.name === "idx_dcb_device"));
    assert.ok(idxRowsDcb.some((r) => r.name === "idx_dcb_credential"));
  });

  it("richiamare di nuovo getTenantDb (o riaprire) è idempotente — nessun errore, CHECK resta esteso", () => {
    // getTenantDb usa una cache in-process: qui verifichiamo che una migrazione
    // già applicata non generi errori se rieseguita a mano sulla stessa connessione
    // (guardia su sqlite_master.sql — la condizione `!row.sql.includes("'redfish'")`
    // è già falsa, il blocco non deve fare nulla).
    const d = getTenantDb(T_MIGRATE);
    assert.doesNotThrow(() => {
      d.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'winrm', 5985)`).run();
    });
  });
});

describe("getCredentialCoverageByCategory", () => {
  before(() => {
    deleteTenantDatabase(T_COVERAGE);
    withTenant(T_COVERAGE, () => {
      getTenantDb(T_COVERAGE); // forza la creazione con schema corrente
    });
  });
  after(() => deleteTenantDatabase(T_COVERAGE));

  it("conta host per categoria attribuita e quanti hanno credenziale validata sul protocollo giusto", () => {
    withTenant(T_COVERAGE, () => {
      const d = getTenantDb(T_COVERAGE);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.60.0.0/24', 'cov-net')`).run();

      // 2 switch (network.switch -> snmp): 1 con credenziale snmp validata, 1 senza.
      d.prepare(`INSERT INTO hosts (id, network_id, ip, attr_category) VALUES (1, 1, '10.60.0.1', 'network.switch')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip, attr_category) VALUES (2, 1, '10.60.0.2', 'network.switch')`).run();
      d.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (1, 'snmp-c', 'snmp')`).run();
      d.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (1, 1, 'snmp', 161, 1)`).run();

      // 1 telecamera (av.camera -> onvif), nessuna credenziale validata.
      d.prepare(`INSERT INTO hosts (id, network_id, ip, attr_category) VALUES (3, 1, '10.60.0.3', 'av.camera')`).run();

      // 1 server (compute.server -> winrm/ssh/redfish), validata via redfish.
      d.prepare(`INSERT INTO hosts (id, network_id, ip, attr_category) VALUES (4, 1, '10.60.0.4', 'compute.server')`).run();
      d.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (2, 'bmc-c', 'api')`).run();
      d.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (4, 2, 'redfish', 443, 1)`).run();

      // Categoria senza mapping (peripheral.printer) — deve essere esclusa dal risultato.
      d.prepare(`INSERT INTO hosts (id, network_id, ip, attr_category) VALUES (5, 1, '10.60.0.5', 'peripheral.printer')`).run();

      const coverage = getCredentialCoverageByCategory();

      const sw = coverage.find((c) => c.category === "network.switch");
      assert.ok(sw);
      assert.equal(sw.hosts, 2);
      assert.equal(sw.withValidCredential, 1);
      assert.equal(sw.expectedProtocol, "snmp");

      const cam = coverage.find((c) => c.category === "av.camera");
      assert.ok(cam);
      assert.equal(cam.hosts, 1);
      assert.equal(cam.withValidCredential, 0);
      assert.equal(cam.expectedProtocol, "onvif");

      const srv = coverage.find((c) => c.category === "compute.server");
      assert.ok(srv);
      assert.equal(srv.hosts, 1);
      assert.equal(srv.withValidCredential, 1);
      assert.equal(srv.expectedProtocol, "winrm/ssh/redfish");

      assert.equal(coverage.find((c) => c.category === "peripheral.printer"), undefined);
    });
  });

  it("nessun host attribuito → array vuoto, mai eccezione", () => {
    deleteTenantDatabase("TESTCOVEMPTY");
    withTenant("TESTCOVEMPTY", () => {
      getTenantDb("TESTCOVEMPTY");
      assert.deepEqual(getCredentialCoverageByCategory(), []);
    });
    deleteTenantDatabase("TESTCOVEMPTY");
  });
});
