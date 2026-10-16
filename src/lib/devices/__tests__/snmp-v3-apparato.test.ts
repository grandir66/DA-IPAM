/**
 * Lettura dati di un apparato SNMPv3 (tappa 2 credenziali, T4, 15/10).
 *
 * INCIDENTE: le cinque sessioni v3 degli apparati (lettura dati, client
 * switch e router, sonda interfacce, walk dei NAS) avevano authNoPriv e MD5
 * fissi: una v3 authPriv SHA/AES non entrava mai. E un apparato `snmp_v3`
 * senza una v3 leggibile ripiegava in silenzio sulla community, cioè su
 * «public» in v1. Ora le opzioni vengono dal record e la v3 che manca è un
 * errore che si vede.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/devices/__tests__/snmp-v3-apparato.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { createCredential, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { getDeviceInfoFromSnmp } from "@/lib/devices/device-info";
import { avviaAgenteV3, utenteShaAes, type AgenteV3 } from "@/lib/protocols/__tests__/support/agente-snmp-v3";
import { avviaAgenteFinto, type AgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";
import type { NetworkDevice } from "@/types";

const T = "TESTSNMPV3APP";
const aperti: Array<AgenteV3 | AgenteFinto> = [];
after(async () => {
  for (const a of aperti) await a.chiudi();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function voceV3(nome: string, privProtocol: string): number {
  return withTenant(T, () =>
    createCredential({
      name: nome,
      credential_type: "snmp",
      encrypted_username: encrypt("monitor"),
      security_level: "authPriv",
      auth_protocol: "SHA",
      encrypted_auth_key: encrypt("chiave-auth-123"),
      priv_protocol: privProtocol,
      encrypted_priv_key: encrypt("chiave-priv-456"),
    }).id
  );
}

/** Dalla 2g la voce dell'apparato sta solo nell'archivio (binding SNMP), mai nelle colonne di network_devices. */
function apparatoV3(credentialId: number | null): NetworkDevice {
  return withTenant(T, () => {
    const db = getTenantDb(T);
    const id = Number(
      db
        .prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('R', '127.0.0.1', 'router', 'mikrotik', 'snmp_v3', 161)")
        .run().lastInsertRowid
    );
    if (credentialId !== null) {
      db.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, 'snmp', 161, 0)")
        .run(id, credentialId);
    }
    return db.prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
  });
}

test("apparato snmp_v3 con una v3 authPriv SHA/AES: la lettura dati entra (prima authNoPriv/MD5 fisso)", async () => {
  const a = await avviaAgenteV3({ utente: utenteShaAes(), sysDescr: "Router finto v3" });
  aperti.push(a);
  const device = apparatoV3(voceV3("v3-router", "AES"));
  const info = await withTenant(T, () => getDeviceInfoFromSnmp(device, a.porta));
  assert.equal(info.sysdescr, "Router finto v3");
  assert.deepEqual(a.errori, []);
});

test("apparato snmp_v3 senza v3: errore che si vede, nessuna richiesta a community (prima «public» in v1)", async () => {
  const a = await avviaAgenteFinto({ versioni: ["1", "2c"], valori: { "1.3.6.1.2.1.1.1.0": "risponde a chiunque" } });
  aperti.push(a);
  const device = apparatoV3(null);
  await assert.rejects(withTenant(T, () => getDeviceInfoFromSnmp(device, a.porta)), /Credenziale SNMPv3 assente o illeggibile/);
  assert.deepEqual(a.richieste, [], "nessun pacchetto a community");
});

test("apparato snmp_v3 con una v3 DES: errore col motivo, nessuna sessione", async () => {
  const device = apparatoV3(voceV3("v3-des", "DES"));
  await assert.rejects(withTenant(T, () => getDeviceInfoFromSnmp(device, 9)), /DES non è supportato da Node 22: usa AES/);
});
