/**
 * da-vault: `campiVoceDb`, tutti i campi segreti di una voce in chiaro, dal lettore unico. Serve alla verifica della
 * ricifra (stessi campi prima e dopo), alla «mostra password», all'esportazione KeePass e alla migrazione verso
 * OpenBao. I nomi dei campi sono quelli del KV di OpenBao: username, password, private_key, key_passphrase, auth_key,
 * priv_key.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/segreti-campi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-segreti-campi";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { campiVoceDb } from "../segreti";

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  return d;
}

describe("campiVoceDb", () => {
  it("dà i campi presenti, col nome del KV, senza quelli vuoti", () => {
    const d = db();
    d.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password, port) VALUES (1, 'fw', 'ssh', ?, ?, 2222)")
      .run(encrypt("admin"), encrypt("pw-1"));
    d.prepare(`INSERT INTO credentials (id, name, credential_type, auth_method, encrypted_username, encrypted_private_key, encrypted_key_passphrase)
               VALUES (2, 'chiave', 'ssh', 'chiave', ?, ?, ?)`).run(encrypt("root"), encrypt("PEM"), encrypt("frase"));
    d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, security_level, auth_protocol, encrypted_auth_key, priv_protocol, encrypted_priv_key)
               VALUES (3, 'v3', 'snmp_v3', ?, 'authPriv', 'SHA', ?, 'AES', ?)`).run(encrypt("mon"), encrypt("a-key"), encrypt("p-key"));
    assert.deepEqual(campiVoceDb(d, 1), { ok: true, credentialId: 1, nome: "fw", tipo: "ssh", port: 2222, campi: { username: "admin", password: "pw-1" } });
    assert.deepEqual(campiVoceDb(d, 2), { ok: true, credentialId: 2, nome: "chiave", tipo: "ssh", port: null, campi: { username: "root", private_key: "PEM", key_passphrase: "frase" } });
    const v3 = campiVoceDb(d, 3);
    assert.ok(v3.ok);
    assert.deepEqual(v3.ok && v3.campi, { username: "mon", auth_key: "a-key", priv_key: "p-key" });
  });

  it("voce assente o campo non decifrabile: rifiuto col nome, mai col valore", () => {
    const d = db();
    assert.deepEqual(campiVoceDb(d, 9), { ok: false, motivo: "La credenziale #9 non esiste" });
    d.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_password) VALUES (1, 'rotta', 'snmp', 'aa:bb:cc')").run();
    const e = campiVoceDb(d, 1);
    assert.equal(e.ok, false);
    assert.match(e.ok ? "" : e.motivo, /«rotta»: la password non si decifra/);
  });
});
