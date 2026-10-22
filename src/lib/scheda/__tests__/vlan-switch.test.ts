/**
 * Tab VLAN degli switch (piano 2026-10-22 accorpamento, Task 11; artboard SwitchVlan V1-V7): matrice porte × VLAN e striscia
 * dalle uscite vere (anonime) dei tre switch dell'hub, passate da leggiVlanSwitch → scriviVlanSwitch → leggiVlanSwitchDb.
 * Caso 5 del piano: la ProMax non dichiara gli untagged e scrive le PortList al contrario → U dedotta dal PVID, matrice
 * «dedotta». Senza lettura (spenta o mai fatta) la matrice resta quella di prima: colonne dai PVID di switch_ports.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/vlan-switch.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, leggiVlanSwitchDb, scriviVlanSwitch, withTenant, type VlanSwitchDb } from "@/lib/db-tenant";
import { leggiVlanSwitch } from "@/lib/devices/snmp-vlan";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";
import { vlanDistinte, type PortaSwitch } from "../porte-da-guardare";
import { fonteVlanSwitch, matriceVlanSwitch, sezioniMatriceSwitch, type MatriceVlanSwitch, type PortaPerMatrice } from "../vlan-switch";

const T = "TESTVLANSWITCHSCHEDA";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

type VoceGrezza = { oid: string; hex?: string; num?: number; str?: string };
type Fixture = { walks: Record<string, { oid: string; voci: VoceGrezza[] | null; codice: string | null }> };
const FIXTURE = path.join(__dirname, "..", "..", "devices", "__tests__", "fixtures");

function lettore(nome: string): LettoreSnmp {
  const f = JSON.parse(fs.readFileSync(path.join(FIXTURE, nome), "utf8")) as Fixture;
  const walk = async (oid: string): Promise<VoceSnmp[]> => {
    const w = Object.values(f.walks).find((x) => x.oid === oid);
    if (!w) return [];
    if (!w.voci) throw Object.assign(new Error("finto"), { code: w.codice ?? "errore" });
    return w.voci.map((v) => ({ oid: v.oid, value: v.hex !== undefined ? Buffer.from(v.hex, "hex") : v.num ?? v.str ?? "" }));
  };
  return Object.assign(walk, { get: async () => [] as VoceSnmp[] });
}

async function dbDa(id: number, fixture: string): Promise<VlanSwitchDb> {
  getTenantDb(T).prepare(`INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, enabled)
    VALUES (?, ?, ?, 'switch', 'other', 'snmp_v2', 1)`).run(id, `SW-${id}`, `192.0.2.${id}`);
  const l = await leggiVlanSwitch(lettore(fixture));
  assert.equal(l.esito, "letto");
  withTenant(T, () => scriviVlanSwitch(id, l, new Date(Date.UTC(2026, 9, 22, 8, 0))));
  return withTenant(T, () => leggiVlanSwitchDb(id));
}

const porta = (i: number, nome: string, status: PortaPerMatrice["status"] = "up", vlan: number | null = null): PortaPerMatrice =>
  ({ port_index: i, port_name: nome, status, vlan });

/** Come le scrive la lettura SNMP dell'hub per il 48POE: 52 prese (49-52 a 10G) e 26 aggregati (ifIndex 66-91). */
const porte48 = (): PortaPerMatrice[] => [
  ...Array.from({ length: 52 }, (_, k) => porta(k + 1, `Slot: 0 Port: ${k + 1} ${k < 48 ? "Gigabit" : "10G"} - Level`, k === 7 ? "down" : "up", 1)),
  ...Array.from({ length: 26 }, (_, k) => porta(66 + k, `Link Aggregate ${k + 1}`, k === 0 ? "up" : "disabled", 1)),
];
/** ProMax: «Port 1»…«Port 48», «SFP+ 1»…«SFP+ 4». */
const porteProMax = (): PortaPerMatrice[] =>
  Array.from({ length: 52 }, (_, k) => porta(k + 1, k < 48 ? `Port ${k + 1}` : `SFP+ ${k - 47}`, "up", null));

const cella = (m: MatriceVlanSwitch, ifIndex: number, vlan: number) => {
  const r = m.righe.find((x) => x.if_index === ifIndex);
  const k = m.colonne.findIndex((c) => c.id === vlan);
  assert.ok(r && k >= 0, `porta ${ifIndex} / VLAN ${vlan}`);
  return r.celle[k];
};

test("48POE: completa, 13 colonne, striscia contata a mano sulla fixture (aggregati fuori)", async () => {
  const db = await dbDa(7, "qbridge-static-48.json");
  const m = matriceVlanSwitch({ porte: porte48(), db });
  assert.equal(m.qualita, "completa");
  assert.deepEqual(m.colonne.map((c) => c.id), [1, 2, 4, 5, 6, 7, 15, 16, 20, 40, 88, 133, 666]);
  assert.ok(m.colonne.every((c) => c.nome !== null));
  // Fixture: 1-46 e 51 egress su tutte le 13 (untagged la 1, il resto tagged), 47-48 untagged la 40 e tagged le altre;
  // 49, 50, 52 nessun egress, solo il PVID 1. Trunk = almeno una T: 1-48 tranne le porte con solo il PVID → 45; access 7.
  assert.deepEqual(m.striscia, { vlan: 13, trunk: 45, access: 7, senza_vlan: 0 });
  assert.equal(cella(m, 1, 1), "U");
  assert.equal(cella(m, 1, 40), "T");
  assert.equal(cella(m, 47, 40), "U");
  assert.equal(cella(m, 47, 1), "T");
  assert.equal(cella(m, 49, 1), "U"); // solo PVID: U implicita
  assert.equal(cella(m, 49, 40), null);
  // Righe: stesso ordine di switch_ports, PVID dalla lettura, stato dalla porta.
  assert.equal(m.righe.length, 78);
  assert.equal(m.righe[0]!.porta, "Porta 1");
  assert.equal(m.righe[46]!.pvid, 40);
  assert.equal(m.righe[7]!.stato, "inattiva");
  assert.equal(m.righe.find((r) => r.if_index === 49)!.gruppo, "sfp");
  assert.equal(m.righe.find((r) => r.if_index === 49)!.porta, "SFP+ 49");
  assert.equal(m.righe.find((r) => r.if_index === 67)!.gruppo, "aggregato");
  assert.equal(m.righe.find((r) => r.if_index === 67)!.stato, "disabilitata");
});

test("ProMax: dedotta (untagged non dichiarati, PortList al contrario), U dal PVID, 20 porte senza VLAN", async () => {
  const db = await dbDa(10, "qbridge-current-promax.json");
  assert.ok(db.porte.every((p) => p.untagged === null));
  assert.equal(db.lettura?.ordine_bit, "inverso");
  const m = matriceVlanSwitch({ porte: porteProMax(), db });
  assert.equal(m.qualita, "dedotta");
  assert.equal(m.colonne.length, 13);
  // Fixture: ifIndex 1-32 con PVID; 31 in egress su VLAN diverse dal PVID (trunk), 1 solo col PVID; 33-52 niente.
  assert.deepEqual(m.striscia, { vlan: 13, trunk: 31, access: 1, senza_vlan: 20 });
  assert.equal(cella(m, 1, 1), "U"); // egress e PVID = VLAN → U
  assert.equal(cella(m, 1, 2), "T"); // egress e PVID ≠ VLAN → T
  const s = sezioniMatriceSwitch(m);
  assert.deepEqual(s.senza.map((r) => r.if_index), Array.from({ length: 20 }, (_, k) => 33 + k));
  assert.ok(s.porte.every((r) => r.gruppo === "porta" && !r.senza_vlan));
  assert.deepEqual(s.sfp, []); // le SFP+ 49-52 sono senza VLAN: stanno nel gruppo chiuso, non due volte
});

test("dedotta anche con untagged dichiarati se l'ordine dei bit è al contrario", () => {
  const db: VlanSwitchDb = {
    vlan: [{ vlan_id: 10, nome: "uno" }],
    porte: [{ vlan_id: 10, if_index: 1, egress: true, untagged: false }],
    pvid: [{ if_index: 1, pvid: 10 }],
    lettura: { letto_il: "2026-10-22 08:00:00", tabella: "static", mappa_porte: "base_port", n_vlan: 1, ordine_bit: "inverso", porte_senza_mappa: 0 },
  };
  const m = matriceVlanSwitch({ porte: [porta(1, "Port 1")], db });
  assert.equal(m.qualita, "dedotta");
  assert.equal(m.righe[0]!.celle[0], "U");
});

test("completa: untagged prima, poi tagged, poi PVID; colonna anche per un PVID senza VLAN letta; nome assente null", () => {
  const db: VlanSwitchDb = {
    vlan: [{ vlan_id: 10, nome: "uno" }, { vlan_id: 20, nome: null }],
    porte: [
      { vlan_id: 10, if_index: 1, egress: true, untagged: true },
      { vlan_id: 20, if_index: 1, egress: true, untagged: false },
      { vlan_id: 20, if_index: 2, egress: true, untagged: false },
    ],
    pvid: [{ if_index: 1, pvid: 10 }, { if_index: 2, pvid: 20 }, { if_index: 3, pvid: 30 }],
    lettura: { letto_il: "2026-10-22 08:00:00", tabella: "static", mappa_porte: "base_port", n_vlan: 2, ordine_bit: "standard", porte_senza_mappa: 0 },
  };
  const m = matriceVlanSwitch({ porte: [porta(1, "Port 1"), porta(2, "Port 2", "down"), porta(3, "Port 3", "disabled"), porta(4, "Port 4")], db });
  assert.equal(m.qualita, "completa");
  assert.deepEqual(m.colonne.map((c) => [c.id, c.nome]), [[10, "uno"], [20, null], [30, null]]);
  assert.deepEqual(m.righe.map((r) => r.celle), [["U", "T", null], [null, "T", null], [null, null, "U"], [null, null, null]]);
  assert.deepEqual(m.righe.map((r) => r.stato), ["attiva", "inattiva", "disabilitata", "attiva"]);
  assert.deepEqual(m.righe.map((r) => r.pvid), [10, 20, 30, null]);
  assert.deepEqual(m.striscia, { vlan: 3, trunk: 2, access: 1, senza_vlan: 1 });
  assert.deepEqual(sezioniMatriceSwitch(m).senza.map((r) => r.porta), ["Porta 4"]);
});

test("nessun dato → solo_pvid: colonne = VLAN distinte di oggi (vlanDistinte), solo U implicite", () => {
  const porte = [porta(1, "Port 1", "up", 10), porta(2, "Port 2", "up", 20), porta(3, "Port 3", "up", 10), porta(4, "Port 4", "up", null)];
  for (const db of [null, { vlan: [], porte: [], pvid: [], lettura: null }] satisfies Array<VlanSwitchDb | null>) {
    const m = matriceVlanSwitch({ porte, db });
    assert.equal(m.qualita, "solo_pvid");
    const oggi = vlanDistinte(porte.map((p) => ({ ...p, is_trunk: 0 })) as unknown as PortaSwitch[]).map((v) => v.vlan);
    assert.deepEqual(m.colonne.map((c) => c.id), oggi);
    assert.deepEqual(m.righe.map((r) => r.celle), [["U", null], [null, "U"], ["U", null], [null, null]]);
    assert.deepEqual(m.righe.map((r) => r.pvid), [10, 20, 10, null]);
    assert.deepEqual(m.striscia, { vlan: 2, trunk: 0, access: 3, senza_vlan: 1 });
  }
});

test("sezioni: senza VLAN chiuse, SFP+ in fondo, aggregati spenti a parte", async () => {
  const db = await dbDa(7, "qbridge-static-48.json");
  const m = matriceVlanSwitch({ porte: porte48(), db });
  const s = sezioniMatriceSwitch(m);
  assert.deepEqual(s.porte.map((r) => r.if_index), Array.from({ length: 48 }, (_, k) => k + 1));
  assert.deepEqual(s.sfp.map((r) => r.if_index), [49, 50, 51, 52]);
  assert.deepEqual(s.aggregati.map((r) => r.if_index), [66]);
  assert.equal(s.aggregatiSpenti.length, 25);
  assert.deepEqual(s.senza, []);
});

test("nota della porta: uplink col vicino del trunk, altrimenti il nome dell'unico host", () => {
  const m = matriceVlanSwitch({
    porte: [
      { ...porta(1, "Port 1"), is_trunk: 1, trunk_neighbor_name: "SW-A" },
      { ...porta(2, "Port 2"), mac_count: 1, single_mac_hostname: "PC-1" },
      { ...porta(3, "Port 3"), mac_count: 3, single_mac_hostname: null },
    ],
    db: null,
  });
  assert.deepEqual(m.righe.map((r) => r.nota), ["uplink SW-A", "PC-1", null]);
});

test("riga delle fonti: ora dei dati, lettura spenta, mai letta, non riuscita col codice", () => {
  const il = "2026-10-22 08:41:00";
  assert.deepEqual(fonteVlanSwitch({ acceso: true, letto_il: il, esito: { il, comandi: 7, riusciti: 7, codice: null } }),
    { nome: "SNMP (Q-BRIDGE)", esito: "ok", quando: "22/10, 10:41" });
  assert.deepEqual(fonteVlanSwitch({ acceso: false, letto_il: il, esito: null }),
    { nome: "SNMP (Q-BRIDGE)", esito: "ok", quando: "22/10, 10:41 · lettura spenta" });
  assert.deepEqual(fonteVlanSwitch({ acceso: true, letto_il: il, esito: { il: "2026-10-22 09:41:00", comandi: 0, riusciti: 0, codice: "TEMPO_SCADUTO" } }),
    { nome: "SNMP (Q-BRIDGE)", esito: "ok", quando: "22/10, 10:41 · ultima prova 22/10, 11:41 non riuscita: TEMPO_SCADUTO" });
  assert.deepEqual(fonteVlanSwitch({ acceso: false, letto_il: null, esito: null }), { nome: "SNMP (Q-BRIDGE)", esito: "assente", nota: "lettura spenta" });
  assert.deepEqual(fonteVlanSwitch({ acceso: true, letto_il: null, esito: null }), { nome: "SNMP (Q-BRIDGE)", esito: "assente", nota: "mai letta" });
  assert.deepEqual(fonteVlanSwitch({ acceso: true, letto_il: null, esito: { il, comandi: 0, riusciti: 0, codice: "TEMPO_SCADUTO" } }),
    { nome: "SNMP (Q-BRIDGE)", esito: "assente", nota: "non riuscita: TEMPO_SCADUTO" });
});
