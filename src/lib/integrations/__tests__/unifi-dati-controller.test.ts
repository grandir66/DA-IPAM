/**
 * Dal controller UniFi tutto ciò che sa (Riccardo, 08/11): gli switch che non rispondono a SNMP né a SSH (79993-ipam-2)
 * «sono dentro al controller, che ha le informazioni»; «acquisire dai controller anche i client collegati e dove sono
 * collegati». Forme vere di `stat/device`, `rest/networkconf` e `stat/sta`; MAC e IP inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fotografiaVlanController, parseNetworkconfResponse } from "../unifi-reti";
import { mapClientsToPorts, parseStatStaResponse, vistiDalGateway } from "../unifi-clients";
import type { UnifiDevice, UnifiPort } from "../unifi-device";

const reti = parseNetworkconfResponse({ meta: { rc: "ok" }, data: [
  { _id: "lan", name: "Default", purpose: "corporate", vlan_enabled: false },
  { _id: "voip", name: "Voce", purpose: "corporate", vlan_enabled: true, vlan: 40 },
  { _id: "ospiti", name: "Ospiti", purpose: "guest", vlan_enabled: true, vlan: 50 },
  { _id: "wan", name: "WAN", purpose: "wan" },
] });
const porta = (port_idx: number, o: Partial<UnifiPort>): UnifiPort => ({
  port_idx, name: `Port ${port_idx}`, up: true, enable: true, speed: 1000, full_duplex: true, media: "GE", is_uplink: false, op_mode: "switch", port_poe: false,
  poe_enable: null, poe_mode: null, poe_power: null, mac_table_count: null, stp_state: null, aggregated_by: null, ...o,
});
const switchDi = (port_table: UnifiPort[]) => ({ type: "usw", state: 1, port_table } as unknown as UnifiDevice);

test("controller: nativa untagged, «auto» tutte le altre tagged, «custom» meno le escluse, «block_all» nessuna", () => {
  const f = fotografiaVlanController(switchDi([
    porta(1, { native_networkconf_id: "lan", tagged_vlan_mgmt: "auto" }),
    porta(2, { native_networkconf_id: "voip", tagged_vlan_mgmt: "block_all" }),
    porta(3, { native_networkconf_id: "lan", tagged_vlan_mgmt: "custom", excluded_networkconf_ids: ["ospiti"] }),
    porta(4, {}),
    porta(5, { forward: "all" }),
    porta(6, { forward: "all", portconf_id: "profilo-x" }),
  ]), reti)!;
  assert.deepEqual(f.vlan, [{ vlan_id: 1, nome: "Default" }, { vlan_id: 40, nome: "Voce" }, { vlan_id: 50, nome: "Ospiti" }]);
  const di = (i: number) => f.porte.filter((p) => p.if_index === i).map((p) => [p.vlan_id, p.untagged]);
  assert.deepEqual(di(1), [[1, true], [40, false], [50, false]]);
  assert.deepEqual(di(2), [[40, true]]);
  assert.deepEqual(di(3), [[1, true], [40, false]]);
  assert.deepEqual(di(4), [], "senza nativa né modo: non so, niente inventato");
  assert.deepEqual(di(5), [[1, true], [40, false], [50, false]], "forward «all» senza nativa né profilo = profilo di default: LAN nativa, tutte tagged");
  assert.deepEqual(di(6), [], "con un profilo di porta decide il profilo, che non leggiamo");
  assert.deepEqual(f.pvid, [{ if_index: 1, pvid: 1 }, { if_index: 2, pvid: 40 }, { if_index: 3, pvid: 1 }, { if_index: 5, pvid: 1 }]);
  assert.equal(fotografiaVlanController(switchDi([]), reti), null);
  assert.equal(fotografiaVlanController(switchDi([porta(1, {})]), []), null);
});

test("client: IP, nome e gateway; senza sw_mac vale l'ultimo apparato a monte; il motivo di chi non trova posto", () => {
  const c = parseStatStaResponse({ meta: { rc: "ok" }, data: [
    { mac: "02:00:00:00:C0:01", is_wired: true, sw_mac: "02:00:00:00:5A:01", sw_port: 5, ip: "192.0.2.10", hostname: "pc-uno", gw_mac: "02:00:00:00:9A:01", network: "Default" },
    { mac: "02:00:00:00:C0:02", is_wired: true, last_uplink_mac: "02:00:00:00:5A:01", last_uplink_remote_port: 7, ip: "192.0.2.11", gw_mac: "02:00:00:00:9A:01", vlan: 40 },
    { mac: "02:00:00:00:C0:03", is_wired: true, ip: "192.0.2.12" },
    { mac: "02:00:00:00:C0:04", is_wired: false, ap_mac: "02:00:00:00:5A:99" },
  ] });
  assert.deepEqual([c[0].ip, c[0].nome, c[0].gwMac, c[0].rete], ["192.0.2.10", "pc-uno", "02:00:00:00:9A:01", "Default"]);
  assert.deepEqual([c[1].swMac, c[1].swPort, c[1].rete], ["02:00:00:00:5A:01", 7, "VLAN 40"]);
  const devices = [{ id: 7, controller_mac: "02:00:00:00:5A:01" }, { id: 9, controller_mac: "02:00:00:00:9A:01" }];
  const r = mapClientsToPorts(c, devices, new Map([["7|5", "Port 5"]]));
  assert.deepEqual(r.byDevice.get(7), [{ mac: "02:00:00:00:C0:01", port_name: "Port 5" }, { mac: "02:00:00:00:C0:02", port_name: "Port 7" }]);
  assert.deepEqual(r.motivi, { "cablato senza apparato UniFi a monte": 1, "apparato UniFi non in inventario (02:00:00:00:5A:99)": 1 });
  assert.deepEqual(vistiDalGateway(c, devices), [
    { device_id: 9, mac: "02:00:00:00:C0:01", ip: "192.0.2.10", interfaccia: "Default" },
    { device_id: 9, mac: "02:00:00:00:C0:02", ip: "192.0.2.11", interfaccia: "VLAN 40" },
  ]);
});
