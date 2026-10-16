/**
 * «Prova» di una credenziale SNMP dalla pagina Credenziali e dalla discovery
 * (POST /api/credentials/[id]/test), tappa 2 credenziali, T4, 15/10.
 *
 * INCIDENTE: la rotta sapeva solo la community. Una voce v3 (authPriv, SHA,
 * AES) rispondeva «Community string mancante», e la porta propria della voce
 * (tappa 1) si ignorava: senza porta nel corpo si provava sempre la 161. Ora il
 * ramo si decide dalla forma del segreto e la porta è quella chiesta, poi
 * quella della voce, poi lo standard.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/prova-snmp.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { createCredential, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { avviaAgenteV3, utenteShaAes, type AgenteV3 } from "@/lib/protocols/__tests__/support/agente-snmp-v3";
import { avviaAgenteFinto, type AgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";
import { provaCredenzialeSnmpDb } from "../prova-snmp";

const T = "TESTPROVASNMPV3";
const aperti: Array<AgenteV3 | AgenteFinto> = [];

after(async () => {
  for (const a of aperti) await a.chiudi();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function voceV3(nome: string, authKey: string, port: number | null): number {
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
      port,
    }).id
  );
}

describe("provaCredenzialeSnmpDb", () => {
  it("voce v3 authPriv SHA/AES con la sua porta, senza porta nel corpo: riesce sulla porta della voce", async () => {
    const a = await avviaAgenteV3({ utente: utenteShaAes(), sysDescr: "Switch finto v3" });
    aperti.push(a);
    const id = voceV3("v3-con-porta", "chiave-auth-123", a.porta);
    const r = await provaCredenzialeSnmpDb(getTenantDb(T), id, "127.0.0.1", null);
    assert.deepEqual(r, { success: true, message: "Connessione SNMPv3 riuscita", port: a.porta });
  });

  it("la porta del corpo vince su quella della voce", async () => {
    const a = await avviaAgenteV3({ utente: utenteShaAes(), sysDescr: "Switch finto v3" });
    aperti.push(a);
    const id = voceV3("v3-porta-altra", "chiave-auth-123", 9);
    const r = await provaCredenzialeSnmpDb(getTenantDb(T), id, "127.0.0.1", a.porta);
    assert.equal(r.success, true);
    assert.equal(r.success && r.port, a.porta);
  });

  it("voce v3 con la chiave sbagliata: fallita col motivo, senza la chiave", async () => {
    const a = await avviaAgenteV3({ utente: utenteShaAes(), sysDescr: "Switch finto v3" });
    aperti.push(a);
    const id = voceV3("v3-sbagliata", "chiave-sbagliata", null);
    const r = await provaCredenzialeSnmpDb(getTenantDb(T), id, "127.0.0.1", a.porta, { timeoutMs: 1200 });
    assert.equal(r.success, false);
    if (r.success) return;
    assert.match(r.error, /^Connessione SNMPv3 fallita \(.+\)$/);
    assert.ok(!r.error.includes("chiave-sbagliata"));
  });

  it("voce a community: v2c, poi v1, e dice quale ha risposto (come prima)", async () => {
    const a = await avviaAgenteFinto({ versioni: ["1"], valori: { "1.3.6.1.2.1.1.1.0": "AP finto" } });
    aperti.push(a);
    const id = withTenant(T, () => createCredential({ name: "community", credential_type: "snmp", encrypted_password: encrypt("comunita") }).id);
    const r = await provaCredenzialeSnmpDb(getTenantDb(T), id, "127.0.0.1", a.porta, { timeoutMs: 400 });
    assert.deepEqual(r, { success: true, message: "Connessione SNMP riuscita (v1)", port: a.porta, snmp_version: "1" });
  });

  it("una voce che non vale per SNMP si rifiuta col nome e il tipo", async () => {
    const id = withTenant(T, () =>
      createCredential({ name: "win-dominio", credential_type: "windows", encrypted_username: encrypt("adm"), encrypted_password: encrypt("pw") }).id
    );
    const r = await provaCredenzialeSnmpDb(getTenantDb(T), id, "127.0.0.1", null);
    assert.equal(r.success, false);
    assert.match(!r.success ? r.error : "", /«win-dominio».*non vale per SNMP/);
  });
});
