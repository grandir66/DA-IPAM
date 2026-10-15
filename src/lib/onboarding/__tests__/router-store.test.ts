/**
 * Modifica del router già creato dal wizard (tappa 4 credenziali, revisione
 * del 15/10).
 *
 * Incidente (revisione): tornando «Indietro» e cambiando la credenziale del
 * router, il wizard mandava il PUT dell'apparato, che scrive solo le colonne
 * `credential_id`, `snmp_credential_id` e `protocol`. I binding creati da
 * `creaApparato` restavano quelli vecchi, e chi usa davvero le credenziali
 * (`getDeviceCredentials`, `getDeviceCommunityString`) legge prima il binding:
 * il wizard diceva «Router aggiornato» e il polling usava la voce vecchia. Anche
 * la porta dell'apparato restava quella di prima (22 con una voce sulla 2222,
 * 161 passando da SNMP a SSH).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/onboarding/__tests__/router-store.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-router-wizard";

import { withTenant, getTenantDb, deleteTenantDatabase, getDeviceCredentials, getDeviceCommunityString, getNetworkDeviceById } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { creaApparato } from "@/lib/devices/crea-apparato";
import { modificaRouterDelWizard } from "../router-store";

const T = "TESTROUTERWIZARD";
let ultimoHost = 0;

function crea(campi: Record<string, unknown>): number {
  ultimoHost += 1;
  const esito = withTenant(T, () =>
    creaApparato({ name: "Router", host: `10.50.0.${ultimoHost}`, device_type: "router", vendor: "mikrotik", ...campi }),
  );
  assert.ok(esito.ok, esito.ok ? "" : esito.error);
  return esito.device.id;
}

function binding(id: number): [string, number | null, number][] {
  const righe = getTenantDb(T)
    .prepare(`SELECT protocol_type, credential_id, port FROM device_credential_bindings WHERE device_id = ? ORDER BY protocol_type, sort_order, id`)
    .all(id) as { protocol_type: string; credential_id: number | null; port: number }[];
  return righe.map((r) => [r.protocol_type, r.credential_id, r.port]);
}

/** Cosa userà davvero il sistema: utente SSH, community e porta dell'apparato. */
function inUso(id: number) {
  return withTenant(T, () => {
    const d = getNetworkDeviceById(id);
    assert.ok(d);
    return {
      utente: getDeviceCredentials(d)?.username ?? null,
      community: getDeviceCommunityString(d),
      porta: d.port,
      colonne: [d.protocol, d.credential_id ?? null, d.snmp_credential_id ?? null],
    };
  });
}

function modifica(corpo: Record<string, unknown>) {
  return withTenant(T, () => modificaRouterDelWizard(corpo));
}

describe("modifica del router del wizard", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      const ins = d.prepare(
        `INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password, port) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      ins.run(1, "SSH A", "ssh", encrypt("utente-a"), encrypt("pw-a"), null);
      ins.run(2, "SSH B", "ssh", encrypt("utente-b"), encrypt("pw-b"), 2222);
      ins.run(3, "SNMP S", "snmp", null, encrypt("comm-s"), null);
      ins.run(4, "SNMP S2", "snmp", null, encrypt("comm-s2"), null);
      ins.run(5, "Windows", "windows", encrypt("admin"), encrypt("pw-w"), null);
    });
  });
  after(() => deleteTenantDatabase(T));

  it("cambiando voce SSH e voce SNMP il sistema usa le nuove, sulla porta della voce", () => {
    const id = crea({ protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    assert.deepEqual(inUso(id).utente, "utente-a");
    const esito = modifica({ device_id: id, credential_id: 2, snmp_credential_id: 4 });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.deepEqual(inUso(id), { utente: "utente-b", community: "comm-s2", porta: 2222, colonne: ["ssh", 2, 4] });
    assert.deepEqual(binding(id), [
      ["snmp", 4, 161],
      ["ssh", 2, 2222],
    ]);
  });

  it("passando da SSH a SNMP v2c: la community è quella nuova, la voce SNMP separata sparisce, porta 161", () => {
    const id = crea({ protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    const esito = modifica({ device_id: id, protocol: "snmp_v2", credential_id: 4 });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.deepEqual(inUso(id), { utente: null, community: "comm-s2", porta: 161, colonne: ["snmp_v2", 4, null] });
    assert.deepEqual(binding(id), [["snmp", 4, 161]]);
  });

  it("passando da SSH a SNMP con la stessa voce SNMP: un binding solo, senza doppioni", () => {
    const id = crea({ protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    const esito = modifica({ device_id: id, protocol: "snmp_v2", credential_id: 3 });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.deepEqual(binding(id), [["snmp", 3, 161]]);
    assert.equal(inUso(id).community, "comm-s");
  });

  it("passando da SNMP a SSH la porta torna 22 (non resta 161)", () => {
    const id = crea({ protocol: "snmp_v2", credential_id: 3 });
    assert.equal(inUso(id).porta, 161);
    const esito = modifica({ device_id: id, protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.deepEqual(inUso(id), { utente: "utente-a", community: "comm-s", porta: 22, colonne: ["ssh", 1, 3] });
    assert.deepEqual(binding(id), [
      ["snmp", 3, 161],
      ["ssh", 1, 22],
    ]);
  });

  it("togliendo la voce SNMP separata si toglie anche il suo binding", () => {
    const id = crea({ protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    const esito = modifica({ device_id: id, snmp_credential_id: null });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.deepEqual(binding(id), [["ssh", 1, 22]]);
    assert.deepEqual(inUso(id).colonne, ["ssh", 1, null]);
  });

  it("la stessa modifica due volte non crea doppioni (un nuovo tentativo dopo un errore)", () => {
    const id = crea({ protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    assert.ok(modifica({ device_id: id, credential_id: 2, snmp_credential_id: 4 }).ok);
    assert.ok(modifica({ device_id: id, credential_id: 2, snmp_credential_id: 4 }).ok);
    assert.deepEqual(binding(id), [
      ["snmp", 4, 161],
      ["ssh", 2, 2222],
    ]);
  });

  it("cambiando solo il nome i binding restano com'erano, con l'esito della prova", () => {
    const id = crea({ protocol: "ssh", credential_id: 1, snmp_credential_id: 3 });
    getTenantDb(T).prepare(`UPDATE device_credential_bindings SET test_status = 'success' WHERE device_id = ?`).run(id);
    const esito = modifica({ device_id: id, name: "Gateway" });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(esito.ok && esito.router.name, "Gateway");
    const stati = getTenantDb(T)
      .prepare(`SELECT test_status FROM device_credential_bindings WHERE device_id = ?`)
      .all(id) as { test_status: string }[];
    assert.deepEqual(stati.map((s) => s.test_status), ["success", "success"]);
  });

  it("un router del vecchio wizard (utente e community in linea) passa alle voci dell'archivio", () => {
    const id = crea({ protocol: "ssh", username: "vecchio", password: "pw-vecchia", community_string: "comm-vecchia" });
    assert.equal(inUso(id).utente, "vecchio");
    const esito = modifica({ device_id: id, credential_id: 1, snmp_credential_id: 3 });
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(inUso(id).utente, "utente-a");
    assert.equal(inUso(id).community, "comm-s");
    assert.deepEqual(binding(id), [
      ["snmp", 3, 161],
      ["ssh", 1, 22],
    ]);
  });

  it("rifiuti: voce che non vale per l'accesso, voce che non c'è, apparato che non c'è, campo sconosciuto", () => {
    const id = crea({ protocol: "ssh", credential_id: 1 });
    const windows = modifica({ device_id: id, credential_id: 5 });
    assert.equal(windows.ok, false);
    if (!windows.ok) {
      assert.equal(windows.status, 400);
      assert.match(windows.error, /non vale/);
    }
    const snmpSbagliata = modifica({ device_id: id, snmp_credential_id: 2 });
    assert.equal(snmpSbagliata.ok, false);
    const assente = modifica({ device_id: id, credential_id: 99 });
    assert.equal(assente.ok, false);
    if (!assente.ok) assert.match(assente.error, /non c'è/);
    const nessuno = modifica({ device_id: 9999, name: "x" });
    assert.equal(nessuno.ok, false);
    if (!nessuno.ok) assert.equal(nessuno.status, 404);
    const refuso = modifica({ device_id: id, community_string: "x" });
    assert.equal(refuso.ok, false);
    // Niente è cambiato dopo i rifiuti.
    assert.deepEqual(binding(id), [["ssh", 1, 22]]);
  });
});
