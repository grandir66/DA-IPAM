// Lettura `switch_vlan` (piano 2026-10-22 accorpamento, Task 9, ADR 0029; schema di ADR 0018): le VLAN degli switch via
// SNMP (Q-BRIDGE-MIB), letture nuove sugli switch dei clienti, quindi SPENTA di default (chiave assente = spenta).
//
// Livello completo: spenta, il giro degli switch è quello di prima (nessuna walk nuova, stesse chiamate al client, stesse
// sedici letture SNMP della topologia quando quella è accesa, nessuna riga, nessun esito, stesso resoconto); accesa, sette
// walk in sola lettura solo sugli switch con SNMP (anche quelli del controller), non su router, AP, NAS, MikroTik letti via
// SSH, switch senza SNMP; al più una volta l'ora per apparato, un lucchetto; 10 s per walk; tre esiti — «non so» e «non
// riuscito» non scrivono mai (le righe di prima restano con la loro data). «Interroga»: senza la cadenza, mai da spenta.
// Le letture vengono dalle uscite vere (anonime) dello switch a 48 porte dell'hub (fixture del Task 7).
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { encrypt } from "@/lib/crypto";
import { deleteTenantDatabase, getTenantDb, leggiVlanSwitchDb, rileggiSchemaCavi, rileggiSchemaSwitchVlan, withTenant } from "@/lib/db-tenant";
import { letturaVlanSwitch, runArpPoll, vlanSwitchDaLeggere } from "@/lib/cron/jobs";
import type { RouterClient } from "@/lib/devices/router-client";
import type { SwitchClient } from "@/lib/devices/switch-client";
import { TEMPO_WALK_MS, type LettoreSnmp, type VoceSnmp } from "@/lib/devices/snmp-walk";
import { OID_QBRIDGE } from "@/lib/devices/snmp-vlan";
import { TABELLE_SNMP } from "@/lib/devices/snmp-topologia";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import type { NetworkDevice } from "@/types";

const T = "TESTARPLETTURESWVLAN";
const db = () => getTenantDb(T);
const TABELLE = ["switch_vlan", "switch_vlan_porte", "switch_porta_pvid", "switch_vlan_lettura"];

beforeEach(() => {
  db().exec(`DELETE FROM switch_vlan; DELETE FROM switch_vlan_porte; DELETE FROM switch_porta_pvid; DELETE FROM switch_vlan_lettura;
    DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs; DELETE FROM device_neighbors;
    DELETE FROM device_credential_bindings; DELETE FROM credentials; DELETE FROM network_devices; DELETE FROM networks; DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  const ins = db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)");
  // 5 switch SNMP; 6 switch del controller con SNMP (la ProMax dell'hub risponde via SNMP: si legge anche lui).
  ins.run(5, "SW-5", "192.0.2.5", "switch", "cisco", "snmp_v2", 0, "public");
  ins.run(6, "SW-6", "192.0.2.6", "switch", "ubiquiti", "snmp_v2", 0, "public");
  // Niente per: un MikroTik letto via SSH (ha le sue letture), uno switch senza SNMP, un AP e un NAS con SNMP, un router con SNMP.
  ins.run(7, "SW-7", "192.0.2.7", "switch", "mikrotik", "ssh", 0, "public");
  ins.run(8, "SW-8", "192.0.2.8", "switch", "hp", "ssh", 0, null);
  ins.run(10, "AP-10", "192.0.2.10", "access_point", "hp", "snmp_v2", 0, "public");
  ins.run(11, "NAS-11", "192.0.2.11", "nas", "hp", "snmp_v2", 0, "public");
  ins.run(12, "RT-12", "192.0.2.12", "router", "cisco", "snmp_v2", 1, "public");
  db().exec("UPDATE network_devices SET controller_mac = '02:00:A0:10:00:06' WHERE id = 6");
  // Il MikroTik via SSH ha ANCHE una credenziale SNMP: è escluso perché letto via SSH, non perché non ha SNMP.
  const voce = Number(db().prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('Community', 'snmp', ?)")
    .run(encrypt("public")).lastInsertRowid);
  db().prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (7, ?, 'snmp', 161, 0)").run(voce);
  withTenant(T, () => { rileggiSchemaCavi(); rileggiSchemaSwitchVlan(); });
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

type VoceGrezza = { oid: string; hex?: string; num?: number; str?: string };
type Fixture = { walks: Record<string, { oid: string; voci: VoceGrezza[] | null; codice: string | null }> };
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "../../devices/__tests__/fixtures/qbridge-static-48.json"), "utf8")) as Fixture;
const QBRIDGE = Object.values(OID_QBRIDGE);
const fallisce = (code: string) => Object.assign(new Error("finto"), { code });

/**
 * La spia delle walk: chi le chiede (apparato, tempo massimo) e quali OID; ogni apparato risponde con la fixture vera.
 * `muto` = apparati che non rispondono (tempo scaduto); `rifiuta` = apparati che rispondono con un errore SNMP a tutto.
 */
function spia(muto: number[] = [], rifiuta: number[] = []) {
  const apparati: number[] = [], tempi: Array<number | undefined> = [], oids: string[] = [];
  const crea = async (device: { id: number }, tempoMs?: number): Promise<LettoreSnmp> => {
    apparati.push(device.id);
    tempi.push(tempoMs);
    const walk = async (oid: string): Promise<VoceSnmp[]> => {
      oids.push(oid);
      if (muto.includes(device.id)) throw fallisce("TEMPO_SCADUTO");
      if (rifiuta.includes(device.id)) throw fallisce("SNMP_STATO_5");
      const w = Object.values(FIXTURE.walks).find((x) => x.oid === oid);
      if (!w) return [];
      if (!w.voci) throw fallisce(w.codice ?? "errore");
      return w.voci.map((v) => ({ oid: v.oid, value: v.hex !== undefined ? Buffer.from(v.hex, "hex") : v.num ?? v.str ?? "" }));
    };
    return Object.assign(walk, { get: async (lista: string[]) => { oids.push(`get:${lista.join(",")}`); return [] as VoceSnmp[]; } });
  };
  return { crea, apparati, tempi, oids };
}

/** Un client che registra le chiamate («apparato:metodo»): il giro di prima si confronta chiamata per chiamata. */
function clientSwitch(chiamate: string[]) {
  return async (device: NetworkDevice): Promise<SwitchClient> => ({
    async getMacTable() { chiamate.push(`${device.id}:getMacTable`); return []; },
    async getPortSchema() { chiamate.push(`${device.id}:getPortSchema`); return []; },
    async testConnection() { chiamate.push(`${device.id}:testConnection`); return true; },
  });
}
const routerFinto = async (): Promise<RouterClient> => ({ async getArpTable() { return []; }, async testConnection() { return true; } });

const ora = (s: string) => new Date(`2026-10-22T${s}Z`);
const giro = (s: ReturnType<typeof spia>, quando: Date, chiamate: string[] = []) =>
  withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: routerFinto, creaClientSwitch: clientSwitch(chiamate), creaWalkSnmp: s.crea, adesso: () => quando }));
const accendi = (l: "switch_vlan" | "snmp" = "switch_vlan") => withTenant(T, () => scriviInterruttore(l, true, "admin"));
const righe = (id: number): number[] =>
  TABELLE.map((t) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ?`).get(id) as { n: number }).n);
const tutte = (): number => TABELLE.reduce((n, t) => n + (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0);
const lettaIl = (id: number) => withTenant(T, () => leggiVlanSwitchDb(id).lettura?.letto_il ?? null);
const apparato = (id: number) => db().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;

test("spenta (chiave assente): nessuna walk, stesse chiamate al client, nessuna riga, nessun esito, stesso resoconto", async () => {
  const chiamate: string[] = [];
  const s = spia();
  const r = await giro(s, ora("08:00:00"), chiamate);
  assert.deepEqual(s.apparati, [], "nessuna sessione SNMP nuova");
  assert.deepEqual(s.oids, []);
  // Gli apparati in ordine di nome (getNetworkDevices): AP-10, NAS-11, poi gli switch; il router non passa dal client dello switch.
  assert.deepEqual(chiamate, ["10:getMacTable", "10:getPortSchema", "11:getMacTable", "11:getPortSchema", "5:getMacTable", "5:getPortSchema",
    "6:getMacTable", "6:getPortSchema", "7:getMacTable", "7:getPortSchema", "8:getMacTable", "8:getPortSchema"]);
  assert.equal(r.phase, "ARP poll completato");
  assert.equal(tutte(), 0);
  assert.deepEqual(withTenant(T, () => leggiEsiti("switch_vlan")), {});
  // Accesa, il client dello switch riceve le stesse chiamate: la lettura si aggiunge, non sostituisce niente.
  accendi();
  const accesa: string[] = [];
  await giro(spia(), ora("08:00:00"), accesa);
  assert.deepEqual(accesa, chiamate);
});

test("spenta, con le letture SNMP della topologia accese: solo le loro sedici walk, nessuna Q-BRIDGE", async () => {
  accendi("snmp");
  const s = spia();
  await giro(s, ora("08:00:00"));
  assert.deepEqual(s.apparati, [5], "la topologia legge solo lo switch che non è del controller, come prima");
  assert.equal(s.oids.length, 16);
  assert.deepEqual(s.oids.filter((o) => QBRIDGE.includes(o as (typeof QBRIDGE)[number])), []);
  assert.equal(s.oids[0], `${TABELLE_SNMP.interfacce}.2`);
});

test("accesa: solo gli switch con SNMP (anche del controller), sette walk ciascuno, 10 s per walk; righe della fixture, esito 7 su 7", async () => {
  accendi();
  const s = spia();
  const r = await giro(s, ora("08:00:00"));
  assert.deepEqual(s.apparati, [5, 6], "non router, AP, NAS, MikroTik via SSH, switch senza SNMP");
  assert.deepEqual(s.tempi, [TEMPO_WALK_MS, TEMPO_WALK_MS]);
  assert.equal(TEMPO_WALK_MS, 10_000);
  assert.deepEqual(s.oids, [...QBRIDGE, ...QBRIDGE], "solo walk in lettura (nessun GET, nessun SET)");
  assert.deepEqual(righe(5), [13, 589, 78, 1], "le righe dello switch a 48 porte (misurate nel Task 8)");
  const l = withTenant(T, () => leggiVlanSwitchDb(5)).lettura;
  assert.deepEqual([l?.letto_il, l?.tabella, l?.mappa_porte, l?.n_vlan], ["2026-10-22 08:00:00", "static", "base_port", 13]);
  assert.deepEqual(withTenant(T, () => leggiEsiti("switch_vlan"))["5"], { il: "2026-10-22 08:00:00", comandi: 7, riusciti: 7, codice: null });
  assert.deepEqual(Object.keys(withTenant(T, () => leggiEsiti("switch_vlan"))).sort(), ["5", "6"]);
  assert.match(r.phase ?? "", /letture in più: 2 lette$/);
});

test("cadenza: mezz'ora dopo saltata, un'ora dopo riletta (nuova data)", async () => {
  accendi();
  const s = spia();
  await giro(s, ora("08:00:00"));
  const r = await giro(s, ora("08:30:00"));
  assert.deepEqual(s.apparati, [5, 6]);
  assert.match(r.phase ?? "", /2 saltate \(cadenza 2, lucchetto 0\)/);
  await giro(s, ora("09:01:00"));
  assert.deepEqual(s.apparati, [5, 6, 5, 6]);
  assert.equal(lettaIl(5), "2026-10-22 09:01:00");
});

test("lucchetto: due giri paralleli → una lettura per apparato", async () => {
  accendi();
  const s = spia();
  await Promise.all([giro(s, ora("08:00:00")), giro(s, ora("08:00:00"))]);
  assert.deepEqual(s.apparati, [5, 6]);
});

test("non so (tempo scaduto): una walk sola, nessuna scrittura, le righe di prima restano con la loro data; il giro va avanti", async () => {
  accendi();
  await giro(spia(), ora("08:00:00"));
  const prima = righe(5);
  const chiamate: string[] = [];
  const s = spia([5]);
  const r = await giro(s, ora("09:01:00"), chiamate);
  assert.deepEqual(s.oids.slice(0, 1), [OID_QBRIDGE.staticName]);
  assert.equal(s.oids.length, 1 + 7, "lo switch muto costa una walk; il 6 le sue sette");
  assert.deepEqual(righe(5), prima);
  assert.equal(lettaIl(5), "2026-10-22 08:00:00");
  assert.equal(lettaIl(6), "2026-10-22 09:01:00");
  const e = withTenant(T, () => leggiEsiti("switch_vlan"))["5"];
  assert.deepEqual([e.il, e.codice], ["2026-10-22 09:01:00", "TEMPO_SCADUTO"]);
  assert.ok(chiamate.includes("5:getMacTable"), "la tabella MAC dello switch si legge lo stesso");
  assert.match(r.phase ?? "", /1 lette, 1 non riuscita; codici: TEMPO_SCADUTO/);
});

test("non riuscito (errore SNMP su ogni walk): nessuna scrittura, esito col codice", async () => {
  accendi();
  const s = spia([], [5]);
  await giro(s, ora("08:00:00"));
  assert.deepEqual(righe(5), [0, 0, 0, 0]);
  assert.equal(withTenant(T, () => leggiEsiti("switch_vlan"))["5"].codice, "SNMP_STATO_5");
});

test("schema assente: errore SCHEMA_SWITCH_VLAN prima di aprire la sessione (nessuna walk)", async () => {
  accendi();
  db().exec("DROP TABLE switch_vlan_lettura");
  try {
    withTenant(T, () => rileggiSchemaSwitchVlan());
    const s = spia();
    await giro(s, ora("08:00:00"));
    assert.deepEqual(s.apparati, []);
    assert.equal(withTenant(T, () => leggiEsiti("switch_vlan"))["5"].codice, "SCHEMA_SWITCH_VLAN");
  } finally {
    db().exec(`CREATE TABLE switch_vlan_lettura (device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
      letto_il TEXT NOT NULL, tabella TEXT NOT NULL, mappa_porte TEXT NOT NULL, n_vlan INTEGER NOT NULL, ordine_bit TEXT NOT NULL,
      porte_senza_mappa INTEGER NOT NULL)`);
  }
});

test("quali apparati: switch con SNMP, anche del controller; non MikroTik via SSH, non senza SNMP, non AP/NAS/router", () => {
  const scelti = withTenant(T, () => [5, 6, 7, 8, 10, 11, 12].filter((id) => vlanSwitchDaLeggere(apparato(id))));
  assert.deepEqual(scelti, [5, 6]);
});

test("«Interroga»: spenta non legge; accesa legge anche entro l'ora (senza cadenza), col lucchetto", async () => {
  const s = spia();
  const d = withTenant(T, () => apparato(5));
  const spenta = await withTenant(T, () => letturaVlanSwitch(d, { creaWalkSnmp: s.crea, adesso: () => ora("08:00:00") }, { ignoraCadenza: true }));
  assert.deepEqual(spenta, { stato: "saltato", motivo: "spenta" });
  assert.deepEqual(s.apparati, []);
  accendi();
  await giro(s, ora("08:00:00"));
  const subito = await withTenant(T, () => letturaVlanSwitch(d, { creaWalkSnmp: s.crea, adesso: () => ora("08:10:00") }, { ignoraCadenza: true }));
  assert.equal(subito.stato, "letto");
  assert.equal(subito.stato === "letto" ? subito.valore : null, 13, "il numero di VLAN, per la riga del progresso");
  assert.equal(lettaIl(5), "2026-10-22 08:10:00");
  // Due «Interroga» insieme: una lettura sola.
  const prima = s.apparati.length;
  const due = await withTenant(T, () => Promise.all([0, 1].map(() =>
    letturaVlanSwitch(d, { creaWalkSnmp: s.crea, adesso: () => ora("08:20:00") }, { ignoraCadenza: true }))));
  assert.equal(s.apparati.length - prima, 1);
  assert.deepEqual(due.map((x) => (x.stato === "saltato" ? x.motivo : x.stato)).sort(), ["letto", "lucchetto"]);
  // Senza ignoraCadenza (il giro) entro l'ora: saltata.
  const giroDopo = await withTenant(T, () => letturaVlanSwitch(d, { creaWalkSnmp: s.crea, adesso: () => ora("08:30:00") }));
  assert.deepEqual(giroDopo, { stato: "saltato", motivo: "cadenza" });
});
