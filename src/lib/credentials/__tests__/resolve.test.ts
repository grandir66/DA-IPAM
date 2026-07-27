/**
 * Test resolver credenziali (fase 1b, Task 1). Due stili di setup nello stesso file:
 * - resolveCredentialsForDb: DB in-memory puro (pattern di
 *   src/lib/attribution/__tests__/recompute.test.ts) — nessun contesto tenant richiesto.
 * - recordCredentialFailure/recordCredentialSuccess (db-tenant.ts, usano l'AsyncLocalStorage
 *   `db()`): tenant di test reale via withTenant()+getTenantDb() (pattern di
 *   src/lib/integrations/meshcentral/__tests__/db.test.ts), ripulito in `after()`.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/resolve.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { resolveCredentialsForDb, resolveCredentialForDb, resolveCredentialsFor, resolveCredentialFor } from "../resolve";
import { withTenant, getTenantDb, deleteTenantDatabase, recordCredentialFailure, recordCredentialSuccess } from "@/lib/db-tenant";

// ─────────────────────────────────────────────────────────────────────────
// resolveCredentialsForDb / resolveCredentialForDb — DB in-memory puro
// ─────────────────────────────────────────────────────────────────────────

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  // Colonne aggiunte via ALTER in getTenantDb (non nel CREATE TABLE base): le
  // replichiamo qui come farebbe la migrazione, stesso pattern di recompute.test.ts.
  for (const c of ["fail_count INTEGER NOT NULL DEFAULT 0", "last_error TEXT", "last_attempt_at TEXT", "backoff_until TEXT"]) {
    try { db.exec(`ALTER TABLE host_credentials ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  try { db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL"); } catch { /* già presente */ }
});

function seedNetwork(id: number, cidr: string) {
  db.prepare(`INSERT INTO networks (id, cidr, name) VALUES (?, ?, ?)`).run(id, cidr, `net${id}`);
}

function seedHost(id: number, networkId: number, ip: string) {
  db.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (?, ?, ?)`).run(id, networkId, ip);
}

function seedDevice(id: number, hostId: number | null, ip: string) {
  db.prepare(
    `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, host_id) VALUES (?, ?, ?, 'server', 'other', 'snmp_v2', ?)`
  ).run(id, `dev${id}`, ip, hostId);
}

function seedCredential(id: number, type: "ssh" | "snmp" | "api" | "windows" | "linux") {
  db.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (?, ?, ?)`).run(id, `cred${id}`, type);
}

describe("resolveCredentialsForDb — ordine di precedenza completo", () => {
  it("host validate → binding success → host non validate → binding untested → rete → legacy (pin poi lista)", () => {
    seedNetwork(1, "10.1.0.0/24");
    seedHost(1, 1, "10.1.0.1");
    seedDevice(1, 1, "10.1.0.1");
    for (const id of [10, 20, 30, 40, 50, 60, 70]) seedCredential(id, "snmp");

    db.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (1, 10, 'snmp', 161, 1, 0)`).run();
    db.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (1, 30, 'snmp', 161, 0, 1)`).run();

    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 20, 'snmp', 161, 'success', 0)`).run();
    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 40, 'snmp', 161, 'untested', 1)`).run();
    // binding 'failed' non deve mai comparire
    seedCredential(999, "snmp");
    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 999, 'snmp', 161, 'failed', 2)`).run();

    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (1, 50, 0)`).run();
    db.prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (1, 60, 'snmp', 0)`).run();
    db.prepare(`INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (1, 'snmp', 70)`).run();

    const result = resolveCredentialsForDb(db, { hostId: 1, networkId: 1 }, "snmp");
    assert.deepEqual(result.map((r) => r.credential_id), [10, 20, 30, 40, 50, 70, 60]);
    assert.deepEqual(result.map((r) => r.source), [
      "host_validated", "device_binding", "host_unvalidated", "device_binding", "network_chain", "legacy_chain", "legacy_chain",
    ]);
    assert.equal(result[0].validated, true);
    assert.equal(result[2].validated, false);
    assert.ok(!result.some((r) => r.credential_id === 999), "binding failed non deve mai comparire");
  });
});

describe("resolveCredentialsForDb — backoff", () => {
  it("esclude una credenziale con backoff_until futuro, la include con includeBackoff:true", () => {
    seedNetwork(2, "10.2.0.0/24");
    seedHost(2, 2, "10.2.0.1");
    seedCredential(80, "ssh");
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, backoff_until) VALUES (2, 80, 'ssh', 22, 1, 0, ?)`
    ).run(future);

    const excluded = resolveCredentialsForDb(db, { hostId: 2, networkId: 2 }, "ssh");
    assert.deepEqual(excluded, []);

    const included = resolveCredentialsForDb(db, { hostId: 2, networkId: 2 }, "ssh", { includeBackoff: true });
    assert.equal(included.length, 1);
    assert.equal(included[0].credential_id, 80);
    assert.equal(included[0].backoff_until, future);
  });

  it("una credenziale con backoff_until passato NON viene esclusa", () => {
    seedNetwork(21, "10.21.0.0/24");
    seedHost(21, 21, "10.21.0.1");
    seedCredential(81, "ssh");
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, backoff_until) VALUES (21, 81, 'ssh', 22, 1, 0, ?)`
    ).run(past);

    const result = resolveCredentialsForDb(db, { hostId: 21, networkId: 21 }, "ssh");
    assert.equal(result.length, 1);
    assert.equal(result[0].credential_id, 81);
  });
});

describe("resolveCredentialsForDb — ponte host↔device", () => {
  it("hostId dato, deviceId assente: risolve il device via FK e ne usa i binding", () => {
    seedNetwork(3, "10.3.0.0/24");
    seedHost(3, 3, "10.3.0.1");
    seedDevice(3, 3, "10.3.0.1");
    seedCredential(600, "windows");
    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (3, 600, 'winrm', 5985, 'success', 0)`).run();

    const result = resolveCredentialsForDb(db, { hostId: 3, networkId: 3 }, "winrm");
    assert.deepEqual(result.map((r) => r.credential_id), [600]);
    assert.equal(result[0].source, "device_binding");
  });

  it("deviceId dato, hostId assente: risolve l'host via FK e ne usa host_credentials", () => {
    seedNetwork(4, "10.4.0.0/24");
    seedHost(4, 4, "10.4.0.1");
    seedDevice(4, 4, "10.4.0.1");
    seedCredential(500, "ssh");
    db.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (4, 500, 'ssh', 22, 1, 0)`).run();

    const result = resolveCredentialsForDb(db, { deviceId: 4, networkId: 4 }, "ssh");
    assert.deepEqual(result.map((r) => r.credential_id), [500]);
    assert.equal(result[0].source, "host_validated");
  });
});

describe("resolveCredentialsForDb / resolveCredentialForDb — nessun risultato", () => {
  it("nessuna sorgente per il protocollo → array vuoto, mai eccezione", () => {
    seedNetwork(5, "10.5.0.0/24");
    seedHost(5, 5, "10.5.0.1");
    assert.deepEqual(resolveCredentialsForDb(db, { hostId: 5, networkId: 5 }, "api"), []);
    assert.equal(resolveCredentialForDb(db, { hostId: 5, networkId: 5 }, "api"), null);
  });

  it("networkId senza rete esistente → array vuoto (non lancia)", () => {
    assert.deepEqual(resolveCredentialsForDb(db, { networkId: 999999 }, "snmp"), []);
  });
});

describe("resolveCredentialsFor / resolveCredentialFor — wrapper pubblico mai lancia", () => {
  it("senza contesto tenant attivo ritorna [] / null", () => {
    assert.deepEqual(resolveCredentialsFor({ networkId: 1 }, "ssh"), []);
    assert.equal(resolveCredentialFor({ networkId: 1 }, "ssh"), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// recordCredentialFailure / recordCredentialSuccess (db-tenant.ts) — tenant reale di test
// ─────────────────────────────────────────────────────────────────────────

const T = "TESTCREDRESOLVE";

function readHostCred(hostId: number, credentialId: number, protocol: string, port: number) {
  return getTenantDb(T)
    .prepare(
      `SELECT * FROM host_credentials WHERE host_id = ? AND credential_id = ? AND protocol_type = ? AND port = ?`
    )
    .get(hostId, credentialId, protocol, port) as
    | { validated: number; validated_at: string | null; fail_count: number; last_error: string | null; last_attempt_at: string | null; backoff_until: string | null }
    | undefined;
}

describe("recordCredentialFailure / recordCredentialSuccess", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.9.0.0/24', 'n')`).run();
      d.prepare(`INSERT OR IGNORE INTO hosts (id, network_id, ip) VALUES (1, 1, '10.9.0.1')`).run();
      d.prepare(`INSERT OR IGNORE INTO credentials (id, name, credential_type) VALUES (1, 'c1', 'ssh')`).run();
      d.prepare(`INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, host_id) VALUES (1, 'dev1', '10.9.0.1', 'server', 'other', 'ssh', 1)`).run();
      d.prepare(
        `INSERT OR IGNORE INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 1, 'ssh', 22, 'untested', 0)`
      ).run();
    });
  });
  after(() => deleteTenantDatabase(T));

  it("registra un fallimento su una riga inesistente: upsert, mai eccezione, fail_count=1 e backoff coerente", () => {
    withTenant(T, () => {
      recordCredentialFailure(1, 1, "ssh", 22, "auth fallita: password errata");
    });
    const row = readHostCred(1, 1, "ssh", 22)!;
    assert.equal(row.fail_count, 1);
    assert.equal(row.last_error, "auth fallita: password errata");
    assert.equal(row.validated, 0);
    assert.ok(row.last_attempt_at?.includes("T"), "last_attempt_at deve essere ISO-8601");
    assert.ok(row.backoff_until?.includes("T"), "backoff_until deve essere ISO-8601");
    const expectedMs = Math.min(2 ** 1 * 5 * 60 * 1000, 24 * 60 * 60 * 1000);
    const deltaMs = new Date(row.backoff_until!).getTime() - new Date(row.last_attempt_at!).getTime();
    assert.ok(Math.abs(deltaMs - expectedMs) < 2000, `backoff atteso ~${expectedMs}ms, trovato ${deltaMs}ms`);

    const binding = getTenantDb(T).prepare(`SELECT test_status, test_message FROM device_credential_bindings WHERE device_id = 1 AND credential_id = 1`).get() as { test_status: string; test_message: string | null };
    assert.equal(binding.test_status, "failed");
    assert.equal(binding.test_message, "auth fallita: password errata");
  });

  it("un secondo fallimento incrementa fail_count e allunga il backoff, e invalida validated se era 1", () => {
    withTenant(T, () => {
      // porta la riga a validated=1 come se fosse stata validata in precedenza
      getTenantDb(T).prepare(`UPDATE host_credentials SET validated = 1, validated_at = datetime('now') WHERE host_id=1 AND credential_id=1 AND protocol_type='ssh' AND port=22`).run();
      recordCredentialFailure(1, 1, "ssh", 22, "auth fallita di nuovo");
    });
    const row = readHostCred(1, 1, "ssh", 22)!;
    assert.equal(row.fail_count, 2);
    assert.equal(row.validated, 0, "validated deve essere invalidato al fallimento");
    assert.equal(row.validated_at, null);
  });

  it("recordCredentialSuccess azzera fail_count/last_error/backoff e marca validated=1, propaga al binding", () => {
    withTenant(T, () => {
      recordCredentialSuccess(1, 1, "ssh", 22);
    });
    const row = readHostCred(1, 1, "ssh", 22)!;
    assert.equal(row.fail_count, 0);
    assert.equal(row.last_error, null);
    assert.equal(row.backoff_until, null);
    assert.equal(row.validated, 1);
    assert.ok(row.validated_at, "validated_at deve essere valorizzato");

    const binding = getTenantDb(T).prepare(`SELECT test_status FROM device_credential_bindings WHERE device_id = 1 AND credential_id = 1`).get() as { test_status: string };
    assert.equal(binding.test_status, "success");
  });
});
