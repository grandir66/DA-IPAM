/**
 * Modifica dei binding credenziale (tappa 1 credenziali, 15/10, revisione finale).
 *
 * Rischi: la community SNMP inline salvata nello username in chiaro; un
 * aggiornamento della sola porta di un binding d'archivio che scrive i campi
 * inline e così stacca la credenziale.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/aggiornamenti-binding.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-aggiornamenti-binding";

import { aggiornamentiBinding, normalizzaInlineSnmp } from "../aggiornamenti-binding";
import { safeDecrypt } from "@/lib/crypto";

describe("normalizzaInlineSnmp", () => {
  it("SNMP: la community scritta nello username va nel campo cifrato", () => {
    assert.deepEqual(normalizzaInlineSnmp("snmp", "comunita", null), { inline_username: null, inline_password: "comunita" });
  });
  it("SSH: invariato", () => {
    assert.deepEqual(normalizzaInlineSnmp("ssh", "admin", "pw"), { inline_username: "admin", inline_password: "pw" });
  });
});

describe("aggiornamentiBinding", () => {
  it("binding d'archivio SNMP, cambia solo la porta → nessun campo inline", () => {
    assert.deepEqual(aggiornamentiBinding({ protocol_type: "snmp", port: 1161 }), { protocol_type: "snmp", port: 1161 });
  });

  it("SNMP inline: community nel campo cifrato, username vuoto", () => {
    const u = aggiornamentiBinding({ protocol_type: "snmp", port: 161, credential_id: null, inline_username: null, inline_password: "nuova" });
    assert.equal(u.inline_username, null);
    assert.equal(safeDecrypt(String(u.inline_encrypted_password)), "nuova");
    assert.equal(u.credential_id, null);
  });

  it("SNMP inline con community vuota → il segreto non si tocca", () => {
    const u = aggiornamentiBinding({ protocol_type: "snmp", port: 161, credential_id: null, inline_username: null });
    assert.equal("inline_encrypted_password" in u, false);
  });

  it("SSH inline: username e password come scritti", () => {
    const u = aggiornamentiBinding({ protocol_type: "ssh", port: 22, credential_id: null, inline_username: "admin", inline_password: "pw" });
    assert.equal(u.inline_username, "admin");
    assert.equal(safeDecrypt(String(u.inline_encrypted_password)), "pw");
  });
});
