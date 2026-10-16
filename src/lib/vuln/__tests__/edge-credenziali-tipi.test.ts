/**
 * Credenziali della rete verso lo scanner edge, sui tipi d'archivio (tappa 2
 * credenziali, T12, 16/10).
 *
 * Perché: lo slot si decideva dal codice grezzo (`ssh`/`linux`, `windows`,
 * `snmp`). Dalla 2c le SNMP v3 sono `snmp_v3`: senza slot sparivano
 * dall'anteprima in silenzio. Lo slot SNMP verso lo scanner resta solo
 * community: una voce v3 compare nell'anteprima, non selezionata e col
 * motivo, e non parte verso lo scanner.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/vuln/__tests__/edge-credenziali-tipi.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { collectEdgeCredentialsForNetwork } from "../edge-credentials-bridge";

const T = "TESTEDGETIPI";
const NET = 1;
const V3 = 601;
const SSH = 602;
const COMMUNITY = 603;
const LINUX = 604;

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (?, '10.81.0.0/24', 'rete edge')`).run(NET);
    d.prepare(
      `INSERT INTO credentials (id, name, credential_type, encrypted_username, security_level, auth_protocol, encrypted_auth_key)
       VALUES (?, 'v3 switch', 'snmp_v3', ?, 'authNoPriv', 'SHA', ?)`
    ).run(V3, encrypt("monitor"), encrypt("chiave-auth-123"));
    d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, 'ssh server', 'ssh', ?, ?)`)
      .run(SSH, encrypt("root"), encrypt("pw-ssh"));
    d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_password) VALUES (?, 'community', 'snmp', ?)`)
      .run(COMMUNITY, encrypt("comm-rete"));
    d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, 'vecchia linux', 'linux', ?, ?)`)
      .run(LINUX, encrypt("admin"), encrypt("pw-linux"));
    const ins = d.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`);
    [V3, SSH, COMMUNITY, LINUX].forEach((id, i) => ins.run(NET, id, i));
  });
});

after(() => deleteTenantDatabase(T));

describe("anteprima e invio allo scanner", () => {
  it("una voce SNMP v3 compare, non selezionata e col motivo, e non parte", () => {
    const { preview, transfer } = withTenant(T, () => collectEdgeCredentialsForNetwork(NET, { registra: false }));
    const v3 = preview.find((p) => p.credential_id === V3);
    assert.ok(v3, "la voce SNMP v3 è sparita dall'anteprima");
    assert.equal(v3.slot, "snmp");
    assert.equal(v3.selected_for_scan, false);
    assert.match(v3.motivo ?? "", /Non inviata allo scanner: SNMP v3/);
    assert.equal(transfer.some((t) => t.ipam_credential_id === V3), false, "la v3 è partita verso lo scanner");
  });

  it("la community resta lo slot SNMP; ssh e la vecchia linux vanno nello slot SSH", () => {
    const { preview, transfer } = withTenant(T, () => collectEdgeCredentialsForNetwork(NET, { registra: false }));
    const snmp = transfer.filter((t) => t.slot === "snmp");
    assert.deepEqual(snmp.map((t) => t.ipam_credential_id), [COMMUNITY]);
    assert.equal(snmp[0].community, "comm-rete");
    assert.equal(preview.find((p) => p.credential_id === LINUX)?.slot, "ssh");
    assert.equal(preview.find((p) => p.credential_id === SSH)?.slot, "ssh");
  });
});
