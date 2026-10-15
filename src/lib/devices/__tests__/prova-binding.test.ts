/**
 * Prova di un binding credenziale (tappa 1 credenziali, 15/10).
 *
 * Incidenti: un binding SNMP senza community veniva provato con «public» (e
 * su un apparato che risponde a public sembrava giusto); «Test» su API,
 * Redfish e ONVIF rispondeva «non implementato» e marcava il binding come
 * fallito, e il motore delle credenziali scarta i binding falliti.
 *
 * Tappa 2, T4 (15/10): un binding SNMP verso una voce v3 rispondeva
 * «Community mancante», perché la prova sapeva solo la community. Il ramo v3
 * si decide dalla forma del segreto (leggiSegretoDb), non dal tipo.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/devices/__tests__/prova-binding.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { createCredential, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { avviaAgenteV3, utenteShaAes, type AgenteV3 } from "@/lib/protocols/__tests__/support/agente-snmp-v3";
import { avviaAgenteFinto, type AgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";
import { provaBinding } from "../prova-binding";

const SENZA_CREDENZIALE = { credential_id: null, inline_username: null, inline_encrypted_password: null };
const T = "TESTPROVABINDV3";
const aperti: Array<AgenteV3 | AgenteFinto> = [];

after(async () => {
  for (const a of aperti) await a.chiudi();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

/** Voce v3 come la scrive la pagina: chiavi nelle colonne loro. */
function voceV3(nome: string, authKey: string): number {
  return withTenant(T, () =>
    createCredential({
      name: nome,
      credential_type: "snmp",
      encrypted_username: encrypt("monitor"),
      security_level: "authPriv",
      auth_protocol: "SHA",
      encrypted_auth_key: encrypt(authKey),
      priv_protocol: "AES",
      encrypted_priv_key: encrypt("chiave-priv-456"),
    }).id
  );
}

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

  it("SNMP verso una voce v3 authPriv SHA/AES: riesce (prima «Community mancante»)", async () => {
    const a = await avviaAgenteV3({ utente: utenteShaAes(), sysDescr: "Switch finto v3" });
    aperti.push(a);
    const id = voceV3("v3-giusta", "chiave-auth-123");
    const r = await withTenant(T, () =>
      provaBinding("127.0.0.1", { ...SENZA_CREDENZIALE, protocol_type: "snmp", port: a.porta, credential_id: id }, "2c")
    );
    assert.deepEqual(r, { success: true, message: "SNMP raggiungibile (v3)" });
  });

  it("SNMP verso una voce v3 con la chiave sbagliata: fallita col motivo", async () => {
    const a = await avviaAgenteV3({ utente: utenteShaAes(), sysDescr: "Switch finto v3" });
    aperti.push(a);
    const id = voceV3("v3-sbagliata", "chiave-sbagliata");
    const r = await withTenant(T, () =>
      provaBinding("127.0.0.1", { ...SENZA_CREDENZIALE, protocol_type: "snmp", port: a.porta, credential_id: id }, "2c")
    );
    assert.equal(r.success, false);
    assert.match(r.message, /^SNMPv3: .+/);
    assert.ok(!r.message.includes("chiave-sbagliata"), "il motivo non contiene la chiave");
  });

  it("SNMP verso una voce a community: come prima, con la versione dell'apparato", async () => {
    const a = await avviaAgenteFinto({ versioni: ["2c"], valori: { "1.3.6.1.2.1.1.1.0": "Linux finto" } });
    aperti.push(a);
    const id = withTenant(T, () => createCredential({ name: "community", credential_type: "snmp", encrypted_password: encrypt("comunita") }).id);
    const r = await withTenant(T, () =>
      provaBinding("127.0.0.1", { ...SENZA_CREDENZIALE, protocol_type: "snmp", port: a.porta, credential_id: id }, "2c")
    );
    assert.deepEqual(r, { success: true, message: "SNMP raggiungibile (v2c)" });
    assert.deepEqual(a.versioniViste(), ["2c"]);
  });
});
