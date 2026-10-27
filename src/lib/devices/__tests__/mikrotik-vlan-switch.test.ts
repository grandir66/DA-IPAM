// Le VLAN di uno switch MikroTik in SSH nella matrice degli switch (giro del 22/10, punto 5): sui sei CORE di 70151
// RouterOS dava 0 VLAN via SNMP; `/interface bridge vlan` le dà per nome di porta, qui diventano ifIndex. Uscite nella forma
// vera di `print terse` (come in mikrotik-scheda.test.ts).
//
// Run: node --import tsx --test src/lib/devices/__tests__/mikrotik-vlan-switch.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leggiVlanSwitchMikrotik, vlanSwitchDaMikrotik } from "../mikrotik-vlan-switch";
import { parsePorteBridgeScheda, parseVlanBridge } from "../mikrotik-scheda";

const PORTE = [
  { port_index: 1, port_name: "ether1" }, { port_index: 2, port_name: "ether2" }, { port_index: 3, port_name: "ether3" },
  { port_index: 10, port_name: "sfp-sfpplus1" }, { port_index: 20, port_name: "bond1" },
];
const VLAN = [
  " 0 D bridge=BR_LAN vlan-ids=1 tagged=BR_LAN untagged= current-tagged=BR_LAN current-untagged=ether2,ether3",
  " 1   bridge=BR_LAN vlan-ids=10,20 tagged=BR_LAN,sfp-sfpplus1,bond1 untagged=ether1 current-tagged=BR_LAN,sfp-sfpplus1,bond1 current-untagged=ether1",
  " 2 X bridge=BR_LAN vlan-ids=99 tagged=sfp-sfpplus1 untagged=",
  " 3   bridge=BR_LAN vlan-ids=30-31 tagged=ether9 untagged=",
].join("\n");
const PORTE_BRIDGE = " 0   interface=ether1 bridge=BR_LAN pvid=10\n 1   interface=ether2 bridge=BR_LAN pvid=1\n 2 I interface=sfp-sfpplus1 bridge=BR_LAN pvid=1";

describe("vlanSwitchDaMikrotik", () => {
  it("VLAN espanse, membri per ifIndex (current-* se ci sono), bridge fuori, righe spente saltate, PVID dalle porte", () => {
    const l = vlanSwitchDaMikrotik(parseVlanBridge(VLAN), parsePorteBridgeScheda(PORTE_BRIDGE), PORTE);
    assert.equal(l.esito, "letto");
    assert.equal(l.tabella, "mikrotik");
    assert.deepEqual(l.vlan.map((v) => v.vlan_id), [1, 10, 20, 30, 31], "la 99 è spenta");
    const k = (p: { vlan_id: number; if_index: number; untagged: boolean | null }) => `${p.vlan_id}|${p.if_index}|${p.untagged ? "U" : "T"}`;
    assert.deepEqual(l.porte.map(k).sort(), ["1|2|U", "1|3|U", "10|1|U", "10|10|T", "10|20|T", "20|1|U", "20|10|T", "20|20|T"].sort());
    assert.equal(l.porte_senza_mappa, 1, "ether9 non è fra le porte dello switch; il bridge non conta");
    assert.deepEqual(l.pvid, [{ if_index: 1, pvid: 10 }, { if_index: 2, pvid: 1 }, { if_index: 10, pvid: 1 }]);
  });

  it("senza current-* valgono i membri configurati; nomi confrontati senza maiuscole", () => {
    const l = vlanSwitchDaMikrotik(parseVlanBridge(" 0 bridge=br vlan-ids=5 tagged=SFP-SFPPLUS1 untagged=Ether2"), null, PORTE);
    assert.deepEqual(l.porte.map((p) => [p.vlan_id, p.if_index, p.untagged]).sort(), [[5, 10, false], [5, 2, true]].sort());
    assert.deepEqual(l.pvid, []);
  });
});

describe("leggiVlanSwitchMikrotik", () => {
  it("due comandi; le VLAN che non si leggono = non riuscito col codice, niente da scrivere", async () => {
    const chiesti: string[] = [];
    const ok = await leggiVlanSwitchMikrotik(async (cmd) => { chiesti.push(cmd); return cmd.includes("bridge vlan") ? VLAN : PORTE_BRIDGE; }, PORTE);
    assert.equal(ok.esito, "letto");
    assert.equal(ok.riuscite, 2);
    assert.deepEqual(chiesti, ["/interface bridge vlan print terse without-paging", "/interface bridge port print terse without-paging"]);
    const ko = await leggiVlanSwitchMikrotik(async (cmd) => { if (cmd.includes("bridge vlan")) throw Object.assign(new Error("x"), { code: "ETIMEDOUT" }); return PORTE_BRIDGE; }, PORTE);
    assert.equal(ko.esito, "non_riuscito");
    assert.ok(ko.codice);
    assert.deepEqual(ko.porte, []);
  });
});
