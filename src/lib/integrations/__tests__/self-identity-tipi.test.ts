/**
 * Account che riconosciamo come nostri nei log di Windows: le voci `windows`
 * e, dalla tappa 2 credenziali (T12, 16/10), le voci `ad` dell'archivio.
 *
 * Perché: nella 2f l'account LDAP dell'Active Directory passa da
 * `ad_integrations` a una voce `ad` dell'archivio. Se la lettura guardasse
 * solo `windows`, i login della nostra sincronizzazione AD tornerebbero a
 * comparire come allarmi di Wazuh.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/integrations/__tests__/self-identity-tipi.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";
import { collectSelfIdentity } from "../self-identity";

test("gli account delle voci windows e ad sono nostri; quelli SSH no", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE credentials (id INTEGER PRIMARY KEY, name TEXT, credential_type TEXT NOT NULL, encrypted_username TEXT)`);
  const ins = db.prepare(`INSERT INTO credentials (name, credential_type, encrypted_username) VALUES (?, ?, ?)`);
  ins.run("winrm", "windows", encrypt("CLIENTE\\svc-winrm"));
  ins.run("ldap", "ad", encrypt("svc-ldap@cliente.local"));
  ins.run("server", "ssh", encrypt("root"));
  const s = collectSelfIdentity(db);
  assert.ok(s.accounts.includes("svc-winrm"), "manca l'account windows");
  assert.ok(s.accounts.includes("svc-ldap"), "manca l'account dell'Active Directory");
  assert.equal(s.accounts.includes("root"), false);
  db.close();
});
