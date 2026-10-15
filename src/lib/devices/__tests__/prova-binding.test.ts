/**
 * Prova di un binding credenziale (tappa 1 credenziali, 15/10).
 *
 * Incidenti: un binding SNMP senza community veniva provato con «public» (e
 * su un apparato che risponde a public sembrava giusto); «Test» su API,
 * Redfish e ONVIF rispondeva «non implementato» e marcava il binding come
 * fallito, e il motore delle credenziali scarta i binding falliti.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/prova-binding.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { provaBinding } from "../prova-binding";

const SENZA_CREDENZIALE = { credential_id: null, inline_username: null, inline_encrypted_password: null };

describe("provaBinding", () => {
  it("SNMP senza community → fallita «Community mancante», senza provare public", async () => {
    const r = await provaBinding("192.0.2.1", { ...SENZA_CREDENZIALE, protocol_type: "snmp", port: 161 }, "2c");
    assert.equal(r.success, false);
    assert.equal(r.message, "Community mancante");
  });

  for (const protocollo of ["api", "redfish", "onvif"]) {
    it(`${protocollo} → non disponibile, non un fallimento`, async () => {
      const r = await provaBinding("192.0.2.1", { ...SENZA_CREDENZIALE, protocol_type: protocollo, port: 443 }, "2c");
      assert.equal(r.success, false);
      assert.equal(r.nonDisponibile, true);
      assert.equal(r.message, "Test non disponibile per questo protocollo");
    });
  }
});
