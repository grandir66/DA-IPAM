/**
 * Apparato snmp_v3 senza una v3 leggibile: nessuna sessione apre la community
 * (tappa 2 credenziali, T4; revisione della 2a, 15/10).
 *
 * INCIDENTE (mutazione dei revisori): rimesso in switch-client il ripiego sulla
 * community, senza createV3Session, le prove restavano verdi, perché
 * l'invariante di snmp-sessione.test guarda solo `createV3Session(` e solo la
 * lettura dati (snmp-v3-apparato.test) eseguiva il caso. Qui lo si esegue per
 * ogni famiglia che apre una sessione su un apparato: la sessione degli switch
 * e delle letture della topologia (apriSessioneSnmpApparato, via creaWalkSnmp e
 * createSwitchClient), il client ARP del router, la sonda delle interfacce e il
 * walk limitato dei NAS. L'apparato ha una voce SNMP v1/v2c in colonna: con il
 * ripiego la sessione partirebbe a community.
 *
 * Dove la porta viene dall'apparato (switch e topologia) l'agente finto a
 * community è su quella porta: le sue `richieste` devono restare vuote. Router,
 * sonda e walk limitato vanno sempre sulla 161: lì conta l'errore.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/devices/__tests__/snmp-v3-senza-v3.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { createCredential, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaWalkSnmp, createSwitchClient } from "@/lib/devices/switch-client";
import { createRouterClient } from "@/lib/devices/router-client";
import { probeDeviceInterfaces } from "@/lib/devices/interface-probe";
import { snmpSubwalkLimitedForDevice } from "@/lib/scanner/snmp-query";
import { V3_ASSENTE } from "@/lib/protocols/snmp-sessione";
import { avviaAgenteFinto, type AgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";
import type { NetworkDevice } from "@/types";

const T = "TESTSNMPV3SENZA";
const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";
const SENZA_V3 = new RegExp(V3_ASSENTE);
let agente: AgenteFinto;
let device: NetworkDevice;

before(async () => {
  agente = await avviaAgenteFinto({ versioni: ["1", "2c"], valori: { [OID_SYSDESCR]: "risponde a chiunque" } });
  device = withTenant(T, () => {
    const community = createCredential({ name: "community v2c", credential_type: "snmp", encrypted_password: encrypt("comunita-di-prova") }).id;
    const db = getTenantDb(T);
    const id = Number(
      db
        .prepare(
          "INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id) VALUES ('Senza v3', '127.0.0.1', 'switch', 'other', 'snmp_v3', ?, ?)"
        )
        .run(agente.porta, community).lastInsertRowid
    );
    return db.prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
  });
});

after(async () => {
  await agente?.chiudi();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("letture della topologia (creaWalkSnmp → apriSessioneSnmpApparato): walk e GET rifiutati, nessun pacchetto a community", async () => {
  const walk = await withTenant(T, () => creaWalkSnmp(device, 2000));
  await assert.rejects(withTenant(T, () => walk("1.3.6.1.2.1.2.2.1.2")), SENZA_V3);
  await assert.rejects(withTenant(T, () => walk.get([OID_SYSDESCR])), SENZA_V3);
  assert.deepEqual(agente.richieste, [], "nessuna richiesta a community");
});

test("client degli switch: tabella MAC e porte senza nessun pacchetto a community", async () => {
  const client = await withTenant(T, () => createSwitchClient(device));
  const esiti = await withTenant(T, () => Promise.allSettled([client.getMacTable(), client.getPortSchema()]));
  for (const e of esiti) {
    if (e.status === "rejected") assert.match(String(e.reason instanceof Error ? e.reason.message : e.reason), SENZA_V3);
  }
  assert.deepEqual(agente.richieste, [], "nessuna richiesta a community");
});

test("client ARP del router: la tabella ARP è rifiutata con l'errore della v3", async () => {
  const client = await withTenant(T, () => createRouterClient(device));
  await assert.rejects(withTenant(T, () => client.getArpTable()), SENZA_V3);
  assert.deepEqual(agente.richieste, []);
});

test("sonda delle interfacce: il walk fallisce con l'errore della v3, che si legge negli avvisi", async () => {
  const esito = await withTenant(T, () => probeDeviceInterfaces(device));
  assert.ok(esito.warnings.some((w) => SENZA_V3.test(w)), esito.warnings.join("\n"));
  assert.deepEqual(esito.interfaces, []);
  assert.deepEqual(agente.richieste, []);
});

test("walk limitato (NAS): rifiutato con l'errore della v3", async () => {
  await assert.rejects(withTenant(T, () => snmpSubwalkLimitedForDevice(device, "1.3.6.1.2.1.25.2.3.1", 10, 2000)), SENZA_V3);
  assert.deepEqual(agente.richieste, []);
});
