/**
 * Una credenziale SNMPv3 non è una community v2c (tappa 1 credenziali, 15/10,
 * revisione finale).
 *
 * Rischio: getCredentialCommunityString ripiegava sullo username quando mancava
 * la community. Con il campo «Username SNMPv3» nella pagina, una credenziale
 * solo v3 (username «monitor», niente community) diventava la community
 * «monitor», mandata in chiaro come v2c a tutta la subnet dalla discovery.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/credentials/__tests__/community-snmpv3.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-community-v3";

import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase, getCredentialCommunityString as daTenant } from "@/lib/db-tenant";
import { getCredentialCommunityString as daFacciata } from "@/lib/db";

const T = "TESTCOMMUNITYV3";

describe("getCredentialCommunityString", () => {
  before(() => {
    withTenant(T, () => {
      const ins = getTenantDb(T).prepare(
        "INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password, security_level) VALUES (?, ?, 'snmp', ?, ?, ?)"
      );
      ins.run(1, "solo v3", encrypt("monitor"), null, "authPriv");
      ins.run(2, "v2c", null, encrypt("comunita"), null);
      ins.run(3, "v2c vecchia nello username", encrypt("vecchia"), null, null);
    });
  });
  after(() => deleteTenantDatabase(T));

  for (const [nome, leggi] of [["db-tenant", daTenant], ["db.ts", daFacciata]] as const) {
    it(`${nome}: credenziale solo v3 → nessuna community`, () => {
      assert.equal(withTenant(T, () => leggi(1)), null);
    });
    it(`${nome}: v2c → la community, anche quella vecchia nello username`, () => {
      assert.equal(withTenant(T, () => leggi(2)), "comunita");
      assert.equal(withTenant(T, () => leggi(3)), "vecchia");
    });
  }
});
