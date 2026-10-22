// Scrittura e lettura delle VLAN degli switch (piano 2026-10-22 accorpamento, Task 8, ADR 0029): una fotografia per
// apparato (DELETE + INSERT in UNA transazione), solo da una lettura «letto». Un «non so» o un «non riuscito» lancia e le
// righe di prima restano: la regola sta in scriviVlanSwitch, non solo in chi la chiama. Le letture vengono dalle uscite
// vere (anonime) dei tre switch dell'hub, passate dal lettore del Task 7.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, leggiVlanSwitchDb, scriviVlanSwitch, withTenant } from "@/lib/db-tenant";
import { leggiVlanSwitch, type LetturaVlanSwitch } from "@/lib/devices/snmp-vlan";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";

const T = "TESTSWITCHVLANDB";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

type VoceGrezza = { oid: string; hex?: string; num?: number; str?: string };
type Fixture = { walks: Record<string, { oid: string; voci: VoceGrezza[] | null; codice: string | null }> };

/** Il lettore finto del Task 7: risponde con le voci registrate per quell'OID. */
function lettore(nome: string): LettoreSnmp {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) as Fixture;
  const walk = async (oid: string): Promise<VoceSnmp[]> => {
    const w = Object.values(f.walks).find((x) => x.oid === oid);
    if (!w) return [];
    if (!w.voci) throw Object.assign(new Error("finto"), { code: w.codice ?? "errore" });
    return w.voci.map((v) => ({ oid: v.oid, value: v.hex !== undefined ? Buffer.from(v.hex, "hex") : v.num ?? v.str ?? "" }));
  };
  return Object.assign(walk, { get: async () => [] as VoceSnmp[] });
}

const conta = (t: string, id: number): number =>
  (getTenantDb(T).prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ?`).get(id) as { n: number }).n;
const TABELLE = ["switch_vlan", "switch_vlan_porte", "switch_porta_pvid", "switch_vlan_lettura"];
const righe = (id: number): number[] => TABELLE.map((t) => conta(t, id));

function apparato(id: number): void {
  getTenantDb(T).prepare(`INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled)
    VALUES (?, ?, ?, 'switch', 'other', 'snmp_v2', 1)`).run(id, `SW-${id}`, `192.0.2.${id}`);
}

const t1 = new Date(Date.UTC(2026, 9, 22, 8, 0));
const t2 = new Date(Date.UTC(2026, 9, 22, 9, 0));

test("48POE: si scrive la lettura vera e si rilegge uguale", async () => {
  apparato(7);
  const l = await leggiVlanSwitch(lettore("qbridge-static-48.json"));
  assert.equal(l.esito, "letto");
  assert.equal(withTenant(T, () => scriviVlanSwitch(7, l, t1)), true);
  const db = withTenant(T, () => leggiVlanSwitchDb(7));
  assert.deepEqual(db.vlan, [...l.vlan].sort((a, b) => a.vlan_id - b.vlan_id));
  const chiave = (p: { vlan_id: number; if_index: number }) => p.vlan_id * 100000 + p.if_index;
  assert.deepEqual(db.porte, [...l.porte].sort((a, b) => chiave(a) - chiave(b)));
  assert.deepEqual(db.pvid, [...l.pvid].sort((a, b) => a.if_index - b.if_index));
  assert.deepEqual(db.lettura, { letto_il: "2026-10-22 08:00:00", tabella: "static", mappa_porte: "base_port", n_vlan: 13, ordine_bit: "standard", porte_senza_mappa: l.porte_senza_mappa });
});

test("ProMax: untagged null resta null (U dedotta dal PVID), ordine al contrario e mappa ifindex si rileggono", async () => {
  apparato(10);
  const l = await leggiVlanSwitch(lettore("qbridge-current-promax.json"));
  withTenant(T, () => scriviVlanSwitch(10, l, t1));
  const db = withTenant(T, () => leggiVlanSwitchDb(10));
  assert.ok(db.porte.length > 0);
  assert.ok(db.porte.every((p) => p.untagged === null));
  assert.equal(db.lettura?.tabella, "current");
  assert.equal(db.lettura?.mappa_porte, "ifindex");
  assert.equal(db.lettura?.ordine_bit, "inverso");
});

test("seconda fotografia dello stesso apparato: sostituisce la prima (niente righe vecchie), altri apparati intatti", async () => {
  apparato(8);
  apparato(9);
  const l16 = await leggiVlanSwitch(lettore("qbridge-static-16xg.json"));
  withTenant(T, () => scriviVlanSwitch(8, l16, t1));
  withTenant(T, () => scriviVlanSwitch(9, l16, t1));
  const altro = righe(9);
  const piccola: LetturaVlanSwitch = {
    ...l16,
    vlan: [{ vlan_id: 1, nome: "default" }, { vlan_id: 20, nome: null }],
    porte: [{ vlan_id: 1, if_index: 1, egress: true, untagged: true }, { vlan_id: 20, if_index: 1, egress: true, untagged: false }],
    pvid: [{ if_index: 1, pvid: 1 }],
  };
  withTenant(T, () => scriviVlanSwitch(8, piccola, t2));
  assert.deepEqual(righe(8), [2, 2, 1, 1]);
  const db = withTenant(T, () => leggiVlanSwitchDb(8));
  assert.deepEqual(db.vlan, piccola.vlan);
  assert.deepEqual(db.porte, piccola.porte);
  assert.equal(db.lettura?.letto_il, "2026-10-22 09:00:00");
  assert.equal(db.lettura?.n_vlan, 2);
  assert.deepEqual(righe(9), altro, "l'altro apparato non si tocca");
  // Una lettura riuscita ma vuota è un fatto: la fotografia diventa vuota, con la sua data.
  withTenant(T, () => scriviVlanSwitch(8, { ...piccola, vlan: [], porte: [], pvid: [], tabella: "nessuna" }, t2));
  assert.deepEqual(righe(8), [0, 0, 0, 1]);
  assert.equal(withTenant(T, () => leggiVlanSwitchDb(8)).lettura?.n_vlan, 0);
});

test("«non so» e «non riuscito»: eccezione, e le righe di prima restano intatte", async () => {
  apparato(11);
  const l = await leggiVlanSwitch(lettore("qbridge-static-48.json"));
  withTenant(T, () => scriviVlanSwitch(11, l, t1));
  const prima = withTenant(T, () => leggiVlanSwitchDb(11));
  for (const esito of ["non_so", "non_riuscito"] as const) {
    const vuota: LetturaVlanSwitch = { ...l, esito, vlan: [], porte: [], pvid: [], codice: "TEMPO_SCADUTO" };
    assert.throws(() => withTenant(T, () => scriviVlanSwitch(11, vuota, t2)), /esito/);
  }
  assert.deepEqual(withTenant(T, () => leggiVlanSwitchDb(11)), prima);
});

test("transazione: una riga che non si scrive annulla tutta la fotografia, quella di prima resta", async () => {
  apparato(12);
  const l = await leggiVlanSwitch(lettore("qbridge-static-48.json"));
  withTenant(T, () => scriviVlanSwitch(12, l, t1));
  const prima = withTenant(T, () => leggiVlanSwitchDb(12));
  // pvid NOT NULL: l'ultima INSERT lancia dopo le DELETE e le altre INSERT.
  const rotta = { ...l, pvid: [...l.pvid, { if_index: 999, pvid: null as unknown as number }] };
  assert.throws(() => withTenant(T, () => scriviVlanSwitch(12, rotta, t2)));
  assert.deepEqual(withTenant(T, () => leggiVlanSwitchDb(12)), prima);
});

test("mai letta: liste vuote e lettura null", () => {
  apparato(13);
  assert.deepEqual(withTenant(T, () => leggiVlanSwitchDb(13)), { vlan: [], porte: [], pvid: [], lettura: null });
});

test("apparato cancellato: le sue righe se ne vanno (CASCADE, foreign_keys acceso come nell'app)", async () => {
  apparato(14);
  const d = getTenantDb(T);
  assert.equal(d.pragma("foreign_keys", { simple: true }), 1);
  const l = await leggiVlanSwitch(lettore("qbridge-static-16xg.json"));
  withTenant(T, () => scriviVlanSwitch(14, l, t1));
  assert.ok(righe(14).every((n) => n > 0));
  d.prepare("DELETE FROM network_devices WHERE id = 14").run();
  assert.deepEqual(righe(14), [0, 0, 0, 0]);
});
