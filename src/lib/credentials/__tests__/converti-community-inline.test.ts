/**
 * Conversione dei binding SNMP inline vecchi (tappa 1 credenziali, 15/10).
 *
 * Incidente: la tabella dei binding salvava la community SNMP inline nel campo
 * `inline_username` (in chiaro) e lasciava vuoto quello cifrato; chi legge la
 * community guarda `inline_encrypted_password`, quindi quel binding non
 * funzionava e la community stava in chiaro. Il 15/10 le righe così erano 0
 * sull'hub e sul cliente A: la conversione resta per le altre installazioni.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/converti-community-inline.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-converti-community";

import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { safeDecrypt, encrypt } from "@/lib/crypto";
import { convertiCommunityInlineSnmp } from "../converti-community-inline";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (1, 'snmp', 'snmp')`).run();
  db.prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'sw', '10.0.0.2', 'switch', 'mikrotik', 'snmp_v2')`).run();
  const b = db.prepare(
    `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, inline_username, inline_encrypted_password, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  b.run(1, null, "snmp", 161, "comunita-vecchia", null, 0); // da convertire
  b.run(1, null, "snmp", 1161, null, encrypt("gia-giusta"), 1); // già nella forma giusta
  b.run(1, 1, "snmp", 162, null, null, 2); // da archivio: non si tocca
  b.run(1, null, "ssh", 22, "admin", encrypt("pw"), 3); // SSH inline: non si tocca
});

function righe() {
  return db.prepare(`SELECT port, protocol_type, inline_username, inline_encrypted_password FROM device_credential_bindings ORDER BY sort_order`).all() as Array<{
    port: number; protocol_type: string; inline_username: string | null; inline_encrypted_password: string | null;
  }>;
}

describe("convertiCommunityInlineSnmp", () => {
  it("sposta la community dal campo username a quello cifrato, solo sulle righe vecchie", () => {
    assert.equal(convertiCommunityInlineSnmp(db), 1);
    const [vecchia, giusta, archivio, ssh] = righe();
    assert.equal(vecchia.inline_username, null);
    assert.equal(safeDecrypt(vecchia.inline_encrypted_password!), "comunita-vecchia");
    assert.equal(safeDecrypt(giusta.inline_encrypted_password!), "gia-giusta");
    assert.equal(archivio.inline_encrypted_password, null);
    assert.equal(ssh.inline_username, "admin");
  });

  it("seconda esecuzione senza effetti", () => {
    convertiCommunityInlineSnmp(db);
    const prima = righe();
    assert.equal(convertiCommunityInlineSnmp(db), 0);
    assert.deepEqual(righe(), prima);
  });
});
