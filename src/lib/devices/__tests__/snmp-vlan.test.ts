// Il lettore delle VLAN degli switch (Q-BRIDGE-MIB) sulle uscite VERE dei tre switch dell'hub, lette il 22/10 in sola
// lettura (scripts/leggi-qbridge.ts) e rese anonime (nomi delle VLAN → parole neutre, il resto com'è):
// SW-CED-48POE-242 (qbridge-static-48), SW-CED-16XG-241 (qbridge-static-16xg), SW-ING-ProMax-239 (qbridge-current-promax).
//
// Tre cose viste sul dato vero, non nelle MIB (piano, Task 7):
// - il 16XG dichiara in dot1qVlanStaticUntaggedPorts le porte 1-16 «untagged» in tutte le VLAN tranne la 1, anche dove la
//   VLAN non esce; la tabella Current dice il vero (VLAN 1 untagged, PVID 1). Le porte si leggono dalla Current quando c'è;
//   un untagged fuori dall'egress non vale.
// - la ProMax scrive le PortList al contrario (bit meno significativo dell'ultimo ottetto = porta 0): letta come dice la
//   MIB darebbe le porte 32-63 di uno switch che ne ha 32. L'ordine si sceglie da quante porte cadono fra quelle note.
// - la ProMax risponde a dot1qVlanCurrentUntaggedPorts, ma 16 bit su 48 contraddicono il PVID (porta 1 untagged nella
//   VLAN 1 e nella 4): con l'ordine al contrario gli untagged dichiarati non valgono (null, U dedotta dal PVID).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { leggiVlanSwitch, OID_QBRIDGE, portePortList, type LetturaVlanSwitch } from "@/lib/devices/snmp-vlan";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";

type VoceGrezza = { oid: string; hex?: string; num?: number; str?: string };
type Fixture = { walks: Record<string, { oid: string; voci: VoceGrezza[] | null; codice: string | null }> };

function carica(nome: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) as Fixture;
}

/** Il lettore finto: risponde con le voci registrate per quell'OID; una walk non letta lancia col suo codice. */
function lettore(f: Fixture, chiamate: string[] = []): LettoreSnmp {
  const walk = async (oid: string): Promise<VoceSnmp[]> => {
    chiamate.push(oid);
    const w = Object.values(f.walks).find((x) => x.oid === oid);
    if (!w) return [];
    if (!w.voci) throw Object.assign(new Error("finto"), { code: w.codice ?? "errore" });
    return w.voci.map((v) => ({ oid: v.oid, value: v.hex !== undefined ? Buffer.from(v.hex, "hex") : v.num ?? v.str ?? "" }));
  };
  return Object.assign(walk, { get: async () => [] as VoceSnmp[] });
}

const porteDi = (l: LetturaVlanSwitch, vid: number) => l.porte.filter((p) => p.vlan_id === vid);
const ifEgress = (l: LetturaVlanSwitch, vid: number) => porteDi(l, vid).map((p) => p.if_index).sort((a, b) => a - b);
const ifUntagged = (l: LetturaVlanSwitch, vid: number) => porteDi(l, vid).filter((p) => p.untagged).map((p) => p.if_index).sort((a, b) => a - b);
const pvidDi = (l: LetturaVlanSwitch, ifIndex: number) => l.pvid.find((p) => p.if_index === ifIndex)?.pvid;
const da = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const VID_HUB = [1, 2, 4, 5, 6, 7, 15, 16, 20, 40, 88, 133, 666];

test("PortList: il bit più alto del primo ottetto è la porta 1", () => {
  assert.deepEqual(portePortList(Buffer.from([0x80, 0x01])), [1, 16]);
  assert.deepEqual(portePortList(Buffer.from([0x00, 0x00])), []);
  assert.deepEqual(portePortList(Buffer.alloc(0)), []);
});

test("48POE: tabelle Static, mappa delle porte del bridge, untagged dichiarati", async () => {
  const chiamate: string[] = [];
  const l = await leggiVlanSwitch(lettore(carica("qbridge-static-48.json"), chiamate));
  assert.equal(l.esito, "letto");
  assert.equal(l.tabella, "static");
  assert.equal(l.mappa_porte, "base_port");
  assert.equal(l.ordine_bit, "standard");
  assert.deepEqual(l.vlan.map((v) => v.vlan_id), VID_HUB);
  assert.equal(l.vlan[0].nome, "default");
  assert.equal(l.vlan[1].nome, "rete-a01");
  assert.deepEqual([l.letture, l.riuscite, l.codice], [7, 7, null]);
  assert.deepEqual([...chiamate].sort(), Object.values(OID_QBRIDGE).sort());
  // VLAN 4: untagged sulle porte 19-24, 37, 38, 46 (PVID 4), tagged sulle altre che la portano.
  assert.deepEqual(ifUntagged(l, 4), [...da(19, 24), 37, 38, 46]);
  assert.ok(porteDi(l, 4).every((p) => p.egress && p.untagged !== null));
  assert.ok(!ifEgress(l, 4).includes(5) && ifEgress(l, 4).includes(1));
  // La porta 66 (bit oltre le 52 fisiche) arriva come ifIndex 66 dalla mappa.
  assert.ok(ifEgress(l, 1).includes(66));
  // Un untagged fuori dall'egress non vale: la Static dice 41-44 untagged nella VLAN 1, che lì non esce.
  assert.ok(!ifEgress(l, 1).includes(41));
  assert.equal(l.pvid.length, 78);
  assert.equal(pvidDi(l, 45), 40);
});

test("16XG: si leggono le porte della Current, non gli untagged sbagliati della Static", async () => {
  const l = await leggiVlanSwitch(lettore(carica("qbridge-static-16xg.json")));
  assert.equal(l.esito, "letto");
  assert.equal(l.tabella, "static");
  assert.equal(l.mappa_porte, "base_port");
  assert.equal(l.vlan.length, 13);
  assert.ok(ifUntagged(l, 1).includes(1));
  assert.deepEqual(ifUntagged(l, 2), []);
  assert.deepEqual(ifUntagged(l, 16), [15]);
  assert.equal(pvidDi(l, 15), 16);
  assert.equal(l.pvid.length, 42);
  // Ogni porta untagged in una VLAN ha quel PVID (coerenza col dato vero).
  for (const p of l.porte.filter((x) => x.untagged)) assert.equal(pvidDi(l, p.if_index), p.vlan_id, `porta ${p.if_index}`);
});

test("ProMax: solo Current, bit = ifIndex, PortList al contrario, untagged non dichiarati", async () => {
  const l = await leggiVlanSwitch(lettore(carica("qbridge-current-promax.json")));
  assert.equal(l.esito, "letto");
  assert.equal(l.tabella, "current");
  assert.equal(l.mappa_porte, "ifindex");
  assert.equal(l.ordine_bit, "inverso");
  assert.deepEqual(l.vlan.map((v) => v.vlan_id), VID_HUB);
  assert.ok(l.vlan.every((v) => v.nome === null));
  assert.ok(l.porte.every((p) => p.untagged === null));
  assert.deepEqual(ifEgress(l, 1), [...da(1, 19), 21, 22, 23, 24, 26, 29, 32]);
  // Ogni porta esce nella VLAN del suo PVID: l'ordine scelto è quello giusto.
  for (const p of l.pvid) assert.ok(ifEgress(l, p.pvid).includes(p.if_index), `porta ${p.if_index}`);
  assert.ok(l.porte.every((p) => p.if_index >= 1 && p.if_index <= 32));
  assert.equal(l.pvid.length, 32);
  assert.equal(pvidDi(l, 14), 2);
});

test("una walk che scade: non so, e le altre non si aspettano", async () => {
  const f = carica("qbridge-static-48.json");
  f.walks.staticName = { ...f.walks.staticName, voci: null, codice: "TEMPO_SCADUTO" };
  const chiamate: string[] = [];
  const l = await leggiVlanSwitch(lettore(f, chiamate));
  assert.equal(l.esito, "non_so");
  assert.equal(l.codice, "TEMPO_SCADUTO");
  assert.equal(chiamate.length, 1);
});

test("un tempo scaduto a metà giro: non so, anche se altre walk hanno risposto", async () => {
  const f = carica("qbridge-static-48.json");
  f.walks.pvid = { ...f.walks.pvid, voci: null, codice: "TEMPO_SCADUTO" };
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.esito, "non_so");
});

test("tutte le walk rifiutate dall'agente: non riuscito", async () => {
  const f = carica("qbridge-static-48.json");
  for (const k of Object.keys(f.walks)) f.walks[k] = { ...f.walks[k], voci: null, codice: "SNMP_STATO_2" };
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.esito, "non_riuscito");
  assert.deepEqual([l.letture, l.riuscite, l.codice], [7, 0, "SNMP_STATO_2"]);
});

test("switch senza Q-BRIDGE: letto e vuoto, tabella nessuna", async () => {
  const l = await leggiVlanSwitch(lettore({ walks: {} }));
  assert.equal(l.esito, "letto");
  assert.equal(l.tabella, "nessuna");
  assert.deepEqual([l.vlan, l.porte, l.pvid], [[], [], []]);
});

test("VLAN fuori da 1-4094 scartate", async () => {
  const f: Fixture = { walks: {
    staticName: { oid: OID_QBRIDGE.staticName, codice: null, voci: [0, 1, 4094, 4095].map((v) => ({ oid: `${OID_QBRIDGE.staticName}.${v}`, hex: "" })) },
    staticEgress: { oid: OID_QBRIDGE.staticEgress, codice: null, voci: [0, 4095].map((v) => ({ oid: `${OID_QBRIDGE.staticEgress}.${v}`, hex: "80" })) },
  } };
  const l = await leggiVlanSwitch(lettore(f));
  assert.deepEqual(l.vlan.map((v) => v.vlan_id), [1, 4094]);
  assert.deepEqual(l.porte, []);
});

// Revisione del Task 7.
test("mappa del bridge rifiutata ed Egress rifiutate: non riuscito, non un «letto» con le porte sbagliate", async () => {
  const f = carica("qbridge-static-48.json");
  for (const k of ["basePortIfIndex", "staticEgress", "currentEgress"]) f.walks[k] = { ...f.walks[k], voci: null, codice: "SNMP_STATO_2" };
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.esito, "non_riuscito");
  assert.equal(l.codice, "SNMP_STATO_2");
  assert.deepEqual(l.codici, { staticEgress: "SNMP_STATO_2", currentEgress: "SNMP_STATO_2", basePortIfIndex: "SNMP_STATO_2" });
});

test("solo la mappa del bridge rifiutata: non riuscito (il ripiego bit = ifIndex vale solo se la mappa ha risposto vuota)", async () => {
  const f = carica("qbridge-static-48.json");
  f.walks.basePortIfIndex = { ...f.walks.basePortIfIndex, voci: null, codice: "SNMP_STATO_5" };
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.esito, "non_riuscito");
  assert.deepEqual(l.codici, { basePortIfIndex: "SNMP_STATO_5" });
});

test("VLAN con i nomi ma entrambe le Egress rifiutate: non riuscito", async () => {
  const f = carica("qbridge-static-48.json");
  for (const k of ["staticEgress", "currentEgress"]) f.walks[k] = { ...f.walks[k], voci: null, codice: "SNMP_STATO_2" };
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.esito, "non_riuscito");
});

/** Uno switch di 24 porte con PVID solo sulle 1-20 e PortList di 3 ottetti. */
function piccolo(egress: Record<number, string>): Fixture {
  return { walks: {
    currentEgress: { oid: OID_QBRIDGE.currentEgress, codice: null, voci: Object.entries(egress).map(([v, hex]) => ({ oid: `${OID_QBRIDGE.currentEgress}.0.${v}`, hex })) },
    pvid: { oid: OID_QBRIDGE.pvid, codice: null, voci: da(1, 20).map((p) => ({ oid: `${OID_QBRIDGE.pvid}.${p}`, num: 1 })) },
    basePortIfIndex: { oid: OID_QBRIDGE.basePortIfIndex, codice: null, voci: [] },
  } };
}

test("ordine al contrario solo con un margine netto: poche porte accese restano nell'ordine della MIB", async () => {
  // Standard: porte 1, 22, 23 (1 nota su 3). Al contrario: 1, 2, 23 (2 su 3): più, ma non abbastanza.
  const l = await leggiVlanSwitch(lettore(piccolo({ 1: "800006" })));
  assert.equal(l.ordine_bit, "standard");
  assert.deepEqual(ifEgress(l, 1), [1, 22, 23]);
});

test("ordine al contrario con lunghezze diverse: non si sceglie (un ottetto in meno sposterebbe le porte di 8)", async () => {
  const f = carica("qbridge-current-promax.json");
  const v = f.walks.currentEgress.voci!;
  v[1] = { ...v[1], hex: v[1].hex!.slice(2) };
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.ordine_bit, "standard");
});

test("porte del bridge senza ifIndex nella mappa: contate", async () => {
  const f = carica("qbridge-static-16xg.json");
  // La porta del bridge 1 tolta dalla mappa: esce in tutte le VLAN e ha un PVID.
  f.walks.basePortIfIndex.voci = f.walks.basePortIfIndex.voci!.filter((x) => !x.oid.endsWith(".1.4.1.2.1"));
  const l = await leggiVlanSwitch(lettore(f));
  assert.equal(l.esito, "letto");
  assert.equal(l.porte_senza_mappa, 1);
  assert.ok(!ifEgress(l, 1).includes(1));
  assert.equal((await leggiVlanSwitch(lettore(carica("qbridge-static-16xg.json")))).porte_senza_mappa, 0);
});
