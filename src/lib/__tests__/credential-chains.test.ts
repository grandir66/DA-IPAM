/**
 * Test dei "collettori" credenziali — fase 1b Task 2: buildSnmpCommunitiesForHost,
 * buildSnmpCommunitiesForNetwork, getOrderedDetectCredentialIds,
 * getOrderedSshLinuxCredentialIds diventano wrapper di `resolveCredentialsForDb`
 * (src/lib/credentials/resolve.ts). Firme pubbliche invariate, il corpo ora
 * compone credenziali v2 (`network_credentials`) + legacy (`network_host_credentials`
 * / `host_credentials`), dedup mantenendo l'ordine, con public/private SEMPRE
 * in fondo per SNMP.
 *
 * Pattern: tenant reale di test via withTenant()+getTenantDb() (stesso stile di
 * src/lib/credentials/__tests__/resolve.test.ts, seconda metà del file), ripulito
 * in after(). Nota: getOrderedDetectCredentialIds/getOrderedSshLinuxCredentialIds
 * leggono anche il setting globale HUB (host_windows_credential_id/
 * host_linux_credential_id) — in questo ambiente di sviluppo valgono 3 e 4, quindi
 * gli ID di credenziale usati nei test partono da 50 per non collidere ed è per
 * questo che le asserzioni confrontano il PREFISSO atteso, non l'array intero.
 *
 * Run: node --import tsx --test src/lib/__tests__/credential-chains.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  buildSnmpCommunitiesForHost,
  buildSnmpCommunitiesForNetwork,
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
} from "@/lib/db-tenant";

const T = "TESTCREDCHAINS";

function seedNetwork(id: number, cidr: string, snmpCommunity?: string | null) {
  getTenantDb(T)
    .prepare(`INSERT INTO networks (id, cidr, name, snmp_community) VALUES (?, ?, ?, ?)`)
    .run(id, cidr, `net${id}`, snmpCommunity ?? null);
}

function seedHost(id: number, networkId: number, ip: string) {
  getTenantDb(T).prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (?, ?, ?)`).run(id, networkId, ip);
}

function seedSnmpCredential(id: number, community: string) {
  getTenantDb(T)
    .prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_password) VALUES (?, ?, 'snmp', ?)`)
    .run(id, `cred${id}`, encrypt(community));
}

function seedTypedCredential(id: number, type: "windows" | "ssh" | "linux") {
  getTenantDb(T).prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (?, ?, ?)`).run(id, `cred${id}`, type);
}

before(() => {
  withTenant(T, () => {
    seedNetwork(1, "10.50.0.0/24");
    seedHost(1, 1, "10.50.0.1");

    // Test (a): community SOLO in network_credentials (v2) — oggi ignorata dal legacy.
    seedSnmpCredential(50, "netv2community");
    getTenantDb(T).prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (1, 50, 0)`).run();

    // Test (b): credenziale validata per l'HOST (host_credentials) deve andare per prima.
    seedSnmpCredential(60, "hostvalidated");
    getTenantDb(T)
      .prepare(
        `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (1, 60, 'snmp', 161, 1, 0)`
      )
      .run();

    // Legacy: credenziale sulla rete via network_host_credentials (ruolo snmp).
    seedSnmpCredential(70, "legacycommunity");
    getTenantDb(T)
      .prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (1, 70, 'snmp', 0)`)
      .run();

    // Test (e): stessa credenziale in v2 E legacy — non deve duplicarsi in output.
    seedSnmpCredential(90, "duplicata");
    getTenantDb(T).prepare(`INSERT INTO networks (id, cidr, name) VALUES (2, '10.51.0.0/24', 'net2')`).run();
    getTenantDb(T).prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (2, 90, 0)`).run();
    getTenantDb(T)
      .prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (2, 90, 'snmp', 0)`)
      .run();

    // Test (c): public/private sempre in fondo, mai duplicati — rete con
    // snmp_community di default impostata letteralmente a "public".
    getTenantDb(T).prepare(`INSERT INTO networks (id, cidr, name, snmp_community) VALUES (3, '10.52.0.0/24', 'net3', 'public')`).run();

    // Test (d): getOrderedDetectCredentialIds "windows" — v2 + legacy.
    getTenantDb(T).prepare(`INSERT INTO networks (id, cidr, name) VALUES (4, '10.53.0.0/24', 'net4')`).run();
    seedTypedCredential(80, "windows");
    seedTypedCredential(81, "windows");
    getTenantDb(T).prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (4, 80, 0)`).run();
    getTenantDb(T)
      .prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (4, 81, 'windows', 0)`)
      .run();

    // getOrderedSshLinuxCredentialIds — v2 + legacy (ssh e linux) + dedup.
    getTenantDb(T).prepare(`INSERT INTO networks (id, cidr, name) VALUES (5, '10.54.0.0/24', 'net5')`).run();
    seedTypedCredential(95, "ssh");
    seedTypedCredential(96, "ssh");
    seedTypedCredential(97, "linux");
    getTenantDb(T).prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (5, 95, 0)`).run();
    getTenantDb(T)
      .prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (5, 96, 'ssh', 0)`)
      .run();
    getTenantDb(T)
      .prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (5, 97, 'linux', 0)`)
      .run();
    // 95 duplicata anche come legacy ssh: non deve comparire due volte.
    getTenantDb(T)
      .prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (5, 95, 'linux', 1)`)
      .run();
  });
});

after(() => deleteTenantDatabase(T));

describe("buildSnmpCommunitiesForHost — fase 1b", () => {
  it("(a) una community aggiunta SOLO via network_credentials compare nella catena", () => {
    const result = withTenant(T, () => buildSnmpCommunitiesForHost(1, 1, null));
    assert.ok(result.includes("netv2community"), `attesa 'netv2community' in ${JSON.stringify(result)}`);
  });

  it("(b) le credenziali validate per l'host vanno per prime, poi v2 di rete, poi legacy", () => {
    const result = withTenant(T, () => buildSnmpCommunitiesForHost(1, 1, null));
    assert.deepEqual(
      result.slice(0, 3),
      ["hostvalidated", "netv2community", "legacycommunity"],
      `ordine inatteso: ${JSON.stringify(result)}`
    );
  });

  it("(c) public/private restano SEMPRE ultimi e non duplicati anche se net.snmp_community='public'", () => {
    const result = withTenant(T, () => buildSnmpCommunitiesForNetwork(3, null));
    assert.deepEqual(result.slice(-2), ["public", "private"]);
    assert.equal(result.filter((x) => x === "public").length, 1, "public non deve duplicarsi");
    assert.equal(result.filter((x) => x === "private").length, 1, "private non deve duplicarsi");
  });

  it("(e) nessun duplicato quando la stessa credenziale è sia in v2 che in legacy (buildSnmpCommunitiesForNetwork)", () => {
    const result = withTenant(T, () => buildSnmpCommunitiesForNetwork(2, null));
    assert.equal(result.filter((x) => x === "duplicata").length, 1, `duplicata compare più volte: ${JSON.stringify(result)}`);
  });
});

describe("getOrderedDetectCredentialIds — fase 1b", () => {
  it("(d) include le credenziali v2 (network_credentials) oltre alle legacy, v2 prima", () => {
    const result = withTenant(T, () => getOrderedDetectCredentialIds(4, "windows"));
    assert.deepEqual(result.slice(0, 2), [80, 81], `atteso [80,81] come prefisso: ${JSON.stringify(result)}`);
  });
});

describe("getOrderedSshLinuxCredentialIds — fase 1b", () => {
  it("v2 + legacy (ssh poi linux) senza duplicati", () => {
    const result = withTenant(T, () => getOrderedSshLinuxCredentialIds(5));
    assert.deepEqual(result.slice(0, 3), [95, 96, 97], `atteso [95,96,97] come prefisso: ${JSON.stringify(result)}`);
    assert.equal(result.filter((x) => x === 95).length, 1, "95 non deve duplicarsi (v2 + legacy ssh + legacy linux)");
  });
});
