/**
 * Modifica dei binding credenziale (tappa 1 credenziali, 15/10, revisione
 * finale; tappa 2e, T20, 16/10).
 *
 * Rischi: la community SNMP inline salvata nello username in chiaro; un
 * aggiornamento della sola porta di un binding d'archivio che scrive i campi
 * inline e così stacca la credenziale. Dalla 2e: utente e password nuovi non
 * si scrivono più dentro il binding (inline), che la pagina non mostra come
 * voce e la 2g smetterà di leggere. Vanno a parte, alla rotta, che crea o
 * aggiorna la voce d'archivio dell'apparato; e un `credential_id: null` non
 * stacca più la voce dal binding.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/aggiornamenti-binding.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-aggiornamenti-binding";

import { aggiornamentiBinding, normalizzaInlineSnmp } from "../aggiornamenti-binding";

describe("normalizzaInlineSnmp", () => {
  it("SNMP: la community scritta nello username va nel campo del segreto", () => {
    assert.deepEqual(normalizzaInlineSnmp("snmp", "comunita", null), { inline_username: null, inline_password: "comunita" });
  });
  it("SSH: invariato", () => {
    assert.deepEqual(normalizzaInlineSnmp("ssh", "admin", "pw"), { inline_username: "admin", inline_password: "pw" });
  });
});

describe("aggiornamentiBinding", () => {
  it("binding d'archivio SNMP, cambia solo la porta → nessun segreto, nessun campo inline", () => {
    assert.deepEqual(aggiornamentiBinding({ protocol_type: "snmp", port: 1161 }), {
      modifica: { protocol_type: "snmp", port: 1161 },
      segreto: null,
    });
  });

  it("voce dell'archivio scelta → solo la voce, nessun segreto", () => {
    assert.deepEqual(aggiornamentiBinding({ protocol_type: "ssh", port: 22, credential_id: 9 }), {
      modifica: { protocol_type: "ssh", port: 22, credential_id: 9 },
      segreto: null,
    });
  });

  it("SNMP «Nuova»: la community va nel segreto, lo username resta vuoto; niente inline nella modifica", () => {
    const u = aggiornamentiBinding({ protocol_type: "snmp", port: 161, credential_id: null, inline_username: null, inline_password: "nuova" });
    assert.deepEqual(u, { modifica: { protocol_type: "snmp", port: 161 }, segreto: { username: null, password: "nuova" } });
  });

  it("SNMP con community vuota → il segreto non si tocca", () => {
    const u = aggiornamentiBinding({ protocol_type: "snmp", port: 161, credential_id: null, inline_username: null });
    assert.equal(u.segreto, null);
  });

  it("SSH «Nuova»: utente e password al segreto, in chiaro (li cifra chi crea la voce); nessun campo inline", () => {
    const u = aggiornamentiBinding({ protocol_type: "ssh", port: 22, credential_id: null, inline_username: "admin", inline_password: "pw" });
    assert.deepEqual(u, { modifica: { protocol_type: "ssh", port: 22 }, segreto: { username: "admin", password: "pw" } });
    assert.ok(!("inline_username" in u.modifica) && !("inline_encrypted_password" in u.modifica));
  });

  it("password vuota = non cambiare", () => {
    const u = aggiornamentiBinding({ protocol_type: "ssh", port: 22, credential_id: null, inline_username: "admin", inline_password: "" });
    assert.deepEqual(u.segreto, { username: "admin", password: undefined });
  });

  it("credential_id null senza segreto non stacca la voce", () => {
    const u = aggiornamentiBinding({ protocol_type: "ssh", port: 2222, credential_id: null });
    assert.deepEqual(u, { modifica: { protocol_type: "ssh", port: 2222 }, segreto: null });
  });
});
