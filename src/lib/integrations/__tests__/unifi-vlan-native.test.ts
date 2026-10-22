// VLAN native dal controller UniFi (piano 2026-10-22 accorpamento, Task 13, ADR 0029), provate sulle risposte vere
// (anonime) del controller dell'hub del 22/10: `rest/networkconf` (18 reti: 2 corporate, 11 vlan-only, 3 wan, 2 vpn) e il
// `port_table` della ProMax (52 porte, 22 con `native_networkconf_id`). Sul controller vero `tagged_networkconf_ids` non
// c'è: le reti tagged sono `tagged_vlan_mgmt` (auto/custom/block_all) meno `excluded_networkconf_ids`. Qui si legge solo
// la nativa: è ciò che l'SNMP della ProMax non dichiara. Misurato sulla copia: sui 4 switch che dichiarano gli untagged,
// nativa del controller = PVID SNMP su 99 porte su 99 (stessa numerazione: port_idx = ifIndex).
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/unifi-vlan-native.test.ts
import { removeTestHubDb } from "./support/hub-isolato";
import path from "node:path";
import fs from "node:fs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase,
  getTenantDb,
  leggiVlanSwitchDb,
  migrateSchedaMikrotik,
  migrateSwitchVlan,
  migrateSwitchVlanNativa,
  schemaSwitchVlanNativaPresente,
  scriviVlanNativaSwitch,
  withTenant,
} from "@/lib/db-tenant";
import { DDL_SWITCH_VLAN_NATIVA, SEGNO_SWITCH_VLAN_NATIVA, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";
import { scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { parseStatDeviceResponse, type UnifiDevice } from "../unifi-device";
import { parseNetworkconfResponse, vlanDelleReti, vlanNativePorte, type UnifiRete } from "../unifi-reti";
import { syncUnifiForTenant, type UnifiDeviceSource } from "../unifi-sync";

const T = "TESTUNIFIVLANNATIVA";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const FIX = path.join(__dirname, "fixtures");
const RETI = (): UnifiRete[] => parseNetworkconfResponse(JSON.parse(fs.readFileSync(path.join(FIX, "unifi-rest-networkconf.json"), "utf8")));
const PROMAX = (): UnifiDevice[] =>
  parseStatDeviceResponse(JSON.parse(fs.readFileSync(path.join(FIX, "unifi-stat-device-promax-vlan.json"), "utf8")));

// ── Puro ─────────────────────────────────────────────────────────────────────

test("reti: 18 lette; VLAN come numero o stringa; la LAN senza VLAN è la 1; WAN e VPN fuori", () => {
  const reti = RETI();
  assert.equal(reti.length, 18);
  const m = vlanDelleReti(reti);
  assert.equal(m.get("000000000000000000000001"), 1, "corporate senza VLAN = LAN di default = VLAN 1");
  assert.equal(m.get("000000000000000000000002"), 4);
  assert.equal(m.get("000000000000000000000003"), 5, "vlan \"5\" (stringa) → 5");
  const fuori = reti.filter((r) => !["corporate", "vlan-only", "guest"].includes(r.purpose ?? ""));
  assert.equal(fuori.length, 5);
  for (const r of fuori) assert.equal(m.has(r.id), false, `${r.purpose} non è una rete di porta`);
  assert.equal(m.size, 13);
});

test("reti: risposta d'errore del controller → errore col messaggio, non lista vuota", () => {
  assert.throws(() => parseNetworkconfResponse({ meta: { rc: "error", msg: "api.err.NoPermission" } }), /NoPermission/);
  assert.throws(() => parseNetworkconfResponse({ meta: { rc: "ok" } }), /elenco delle reti/);
});

test("porte: la nativa della ProMax su 22 porte; senza nativa o con una rete ignota la porta non c'è («non so»)", () => {
  const [d] = PROMAX();
  assert.equal(d.port_table.length, 52);
  assert.equal(d.port_table.find((p) => p.port_idx === 13)?.native_networkconf_id, "000000000000000000000012");
  const n = new Map(vlanNativePorte(d, vlanDelleReti(RETI())).map((x) => [x.if_index, x.vlan_id]));
  assert.equal(n.size, 22);
  assert.deepEqual([n.get(5), n.get(13), n.get(20), n.get(40), n.get(46)], [1, 40, 5, 4, 2]);
  assert.equal(n.has(1), false, "porta 1: il controller non dà la nativa");
  // Un id che l'elenco delle reti non conosce: non si indovina.
  const ignota = { ...d, port_table: d.port_table.map((p) => (p.port_idx === 13 ? { ...p, native_networkconf_id: "ffffffffffffffffffffffff" } : p)) };
  assert.equal(vlanNativePorte(ignota, vlanDelleReti(RETI())).some((x) => x.if_index === 13), false);
});

// ── Migrazione e DB ──────────────────────────────────────────────────────────

test("migrazione: una tabella nuova, segno done:…:v1; la seconda volta niente; in transazione", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateSchedaMikrotik(db);
  migrateSwitchVlan(db);
  assert.deepEqual(migrateSwitchVlanNativa(db), DDL_SWITCH_VLAN_NATIVA.map(([n]) => n));
  assert.match(String(leggiSegno(db, SEGNO_SWITCH_VLAN_NATIVA)), /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.equal(schemaSwitchVlanNativaPresente(db), true);
  const segno = leggiSegno(db, SEGNO_SWITCH_VLAN_NATIVA);
  assert.deepEqual(migrateSwitchVlanNativa(db), []);
  assert.equal(leggiSegno(db, SEGNO_SWITCH_VLAN_NATIVA), segno);
  // Una vista con lo stesso nome: fallisce tutta, nessun segno.
  const db2 = new Database(":memory:");
  db2.exec(TENANT_SCHEMA_SQL);
  db2.exec(`CREATE VIEW ${DDL_SWITCH_VLAN_NATIVA[0][0]} AS SELECT 1 AS x`);
  assert.throws(() => migrateSwitchVlanNativa(db2));
  assert.equal(leggiSegno(db2, SEGNO_SWITCH_VLAN_NATIVA), null);
});

test("DB: fotografia per apparato (riscritta intera), letta con la data; le tabelle SNMP non si toccano", () => {
  const d = getTenantDb(T);
  d.prepare(`INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (900, 'SW-900', '192.0.2.90', 'switch', 'ubiquiti', 'snmp_v2', 1)`).run();
  withTenant(T, () => {
    assert.equal(scriviVlanNativaSwitch(900, [{ if_index: 1, vlan_id: 4 }, { if_index: 2, vlan_id: 5 }], new Date(Date.UTC(2026, 9, 22, 1, 0))), true);
    assert.equal(scriviVlanNativaSwitch(900, [{ if_index: 2, vlan_id: 7 }], new Date(Date.UTC(2026, 9, 22, 3, 0))), true);
    const l = leggiVlanSwitchDb(900);
    assert.deepEqual(l.nativa, [{ if_index: 2, vlan_id: 7 }]);
    assert.equal(l.nativa_letta_il, "2026-10-22 03:00:00");
    assert.equal(l.lettura, null, "la lettura SNMP resta «mai fatta»");
  });
});

// ── Sync ─────────────────────────────────────────────────────────────────────

function sorgente(reti: UnifiRete[] | null) {
  const s = {
    soloApparati: 0,
    conReti: 0,
    async listDevices() {
      s.soloApparati++;
      return PROMAX();
    },
    async listDevicesWithNetworks() {
      s.conReti++;
      return { devices: PROMAX(), networks: reti, networksError: reti ? null : "Il controller ha rifiutato la sessione durante la lettura delle reti" };
    },
  } satisfies UnifiDeviceSource & Record<string, unknown>;
  return s;
}

const idProMax = (): number =>
  (getTenantDb(T).prepare("SELECT id FROM network_devices WHERE host = '192.0.2.10'").get() as { id: number }).id;

test("sync con la lettura switch_vlan SPENTA: le reti non si chiedono, niente native", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("switch_vlan", false, "prova");
    const s = sorgente(RETI());
    const r = await syncUnifiForTenant({ source: s });
    assert.equal(r.added + r.updated, 1);
    assert.deepEqual([s.soloApparati, s.conReti], [1, 0]);
    assert.equal(r.vlanNativeScritte, 0);
    assert.deepEqual(leggiVlanSwitchDb(idProMax()).nativa, []);
  });
});

test("sync con la lettura switch_vlan ACCESA: una sessione con le reti, 22 native scritte per lo switch", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("switch_vlan", true, "prova");
    const s = sorgente(RETI());
    const r = await syncUnifiForTenant({ source: s });
    assert.deepEqual([s.soloApparati, s.conReti], [0, 1]);
    assert.equal(r.vlanNativeScritte, 22);
    const n = leggiVlanSwitchDb(idProMax()).nativa ?? [];
    assert.equal(n.length, 22);
    assert.deepEqual(n.find((x) => x.if_index === 13), { if_index: 13, vlan_id: 40 });
  });
});

test("sync accesa ma reti non lette («non so»): gli apparati si scrivono, le native di prima restano, avviso", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("switch_vlan", true, "prova");
    const r = await syncUnifiForTenant({ source: sorgente(null) });
    assert.equal(r.added + r.updated, 1);
    assert.equal(r.vlanNativeScritte, 0);
    assert.ok(r.errors.some((e) => /reti del controller non lette/i.test(e)), r.errors.join(" | "));
    assert.equal((leggiVlanSwitchDb(idProMax()).nativa ?? []).length, 22, "un «non so» non cancella");
  });
});

test("sync accesa, switch offline: le native di prima restano", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("switch_vlan", true, "prova");
    const s = sorgente(RETI());
    s.listDevicesWithNetworks = async () => ({
      devices: PROMAX().map((d) => ({ ...d, state: 0, port_table: d.port_table.map((p) => ({ ...p, native_networkconf_id: null })) })),
      networks: RETI(),
      networksError: null,
    });
    const r = await syncUnifiForTenant({ source: s });
    assert.equal(r.vlanNativeScritte, 0);
    assert.equal((leggiVlanSwitchDb(idProMax()).nativa ?? []).length, 22);
  });
});
