// Topologia fase 2b, Task 1b: un router MikroTik dice chi è attaccato alle sue
// porte con la bridge host, non con l'ARP (che riporta bridge, VLAN e VRRP).
// Uscite in forma vera di RouterOS 7 (RB con un bridge e vlan-filtering=yes),
// con MAC e nomi inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leggiMacPorteRouter, macPorteFisiche, parseMikrotikInterfaceTypes, parseMikrotikMacTable,
} from "@/lib/devices/mikrotik-porte";

const INTERFACCE = [
  "Flags: R - RUNNING; S - SLAVE",
  " 0  RS name=ether1-2.5 default-name=ether1 type=ether mtu=1500 actual-mtu=1500 l2mtu=1514 mac-address=02:00:00:00:10:01",
  " 1  RS name=ether3 default-name=ether3 type=ether mtu=1500 actual-mtu=1500 l2mtu=1514 mac-address=02:00:00:00:10:03",
  " 2   S name=ether7 default-name=ether7 type=ether mtu=1500 actual-mtu=1500 l2mtu=1514 mac-address=02:00:00:00:10:07",
  " 3  RS name=sfp-sfpplus1 default-name=sfp-sfpplus1 type=ether mtu=1500 actual-mtu=1500 l2mtu=1514 mac-address=02:00:00:00:10:0a",
  " 4  R  name=bridge type=bridge mtu=auto actual-mtu=1500 l2mtu=1514 mac-address=02:00:00:00:10:01",
  " 5  R  name=vlan10 type=vlan mtu=1500 actual-mtu=1500 l2mtu=1510 mac-address=02:00:00:00:10:01",
  " 6  R  name=vrrp_rete10 type=vrrp mtu=1500 actual-mtu=1500 mac-address=00:00:5E:00:01:0A",
  " 7  RS name=eoip-tunnel1 type=eoip-tunnel mtu=auto actual-mtu=1458 l2mtu=65535 mac-address=02:00:00:00:10:20",
  ' 8  RS name="bond lan" type=bond mtu=1500 actual-mtu=1500 l2mtu=1514 mac-address=02:00:00:00:10:30',
].join("\n");

const BRIDGE_HOST = [
  "Flags: D - DYNAMIC; L - LOCAL",
  " 0 DL  mac-address=02:00:00:00:10:01 on-interface=bridge bridge=bridge",
  " 1 DL  mac-address=02:00:00:00:10:03 on-interface=ether3 bridge=bridge",
  " 2 D   mac-address=02:00:00:00:20:01 vid=10 on-interface=ether3 bridge=bridge",
  " 3 D   mac-address=02:00:00:00:20:01 vid=20 on-interface=ether3 bridge=bridge",
  " 4 D   mac-address=02:00:00:00:20:02 vid=10 on-interface=sfp-sfpplus1 bridge=bridge",
  " 5 D   mac-address=02:00:00:00:20:03 vid=10 on-interface=bridge bridge=bridge",
  " 6 D   mac-address=02:00:00:00:20:04 vid=10 on-interface=vlan10 bridge=bridge",
  " 7 D   mac-address=02:00:00:00:20:05 on-interface=eoip-tunnel1 bridge=bridge",
  ' 8 D   mac-address=02:00:00:00:20:06 vid=10 on-interface="bond lan" bridge=bridge',
].join("\n");

test("tipi delle interfacce: nome → tipo, anche fra virgolette", () => {
  const t = parseMikrotikInterfaceTypes(INTERFACCE);
  assert.equal(t.get("ether1-2.5"), "ether");
  assert.equal(t.get("sfp-sfpplus1"), "ether");
  assert.equal(t.get("bridge"), "bridge");
  assert.equal(t.get("vlan10"), "vlan");
  assert.equal(t.get("bond lan"), "bond");
  assert.equal(t.size, 9);
});

test("bridge host: le righe locali (L) sono i MAC del router e si scartano; vid diventa la VLAN", () => {
  const r = parseMikrotikMacTable(BRIDGE_HOST);
  assert.ok(!r.some((x) => x.mac === "02:00:00:00:10:01" || x.mac === "02:00:00:00:10:03"), "niente righe L");
  assert.deepEqual(r[0], { mac: "02:00:00:00:20:01", port_name: "ether3", vlan: 10, port_status: null, speed: null });
  assert.equal(r.length, 7);
});

test("RB con vlan-filtering: righe su ether3, sfp-sfpplus1, bridge e vlan10 → si salvano solo ether3 e sfp-sfpplus1", () => {
  const righe = macPorteFisiche(parseMikrotikMacTable(BRIDGE_HOST), parseMikrotikInterfaceTypes(INTERFACCE));
  assert.deepEqual(
    righe.map((r) => [r.mac, r.port_name]),
    [
      ["02:00:00:00:20:01", "ether3"],       // una volta sola, anche se è in due VLAN
      ["02:00:00:00:20:02", "sfp-sfpplus1"],
      ["02:00:00:00:20:06", "bond lan"],     // il bond è un fascio di cavi verso un apparato
    ],
  );
});

test("una porta che /interface print non elenca non si salva: senza tipo non è un cavo", () => {
  const hosts = parseMikrotikMacTable(" 0 D   mac-address=02:00:00:00:20:09 on-interface=ether9 bridge=bridge");
  assert.deepEqual(macPorteFisiche(hosts, new Map([["ether3", "ether"]])), []);
});

test("lettura riuscita: le righe fisiche; client senza bridge host: niente, nessun errore", async () => {
  const ok = await leggiMacPorteRouter({
    getBridgeHosts: async () => parseMikrotikMacTable(BRIDGE_HOST),
    getInterfaceTypes: async () => parseMikrotikInterfaceTypes(INTERFACCE),
  });
  assert.equal(ok.errore, null);
  assert.equal(ok.righe?.length, 3);
  assert.deepEqual(await leggiMacPorteRouter({}), { righe: null, errore: null });
});

test("bridge host che fallisce: nessuna riga, il solo codice d'errore (mai IP o MAC del messaggio)", async () => {
  const r = await leggiMacPorteRouter({
    getBridgeHosts: async () => {
      throw Object.assign(new Error("connect ETIMEDOUT 192.0.2.1:22 (02:00:00:00:20:01)"), { code: "ETIMEDOUT" });
    },
    getInterfaceTypes: async () => parseMikrotikInterfaceTypes(INTERFACCE),
  });
  assert.deepEqual(r, { righe: null, errore: "ETIMEDOUT" });
  const r2 = await leggiMacPorteRouter({
    getBridgeHosts: async () => [],
    getInterfaceTypes: async () => { throw new Error("SSH timed out talking to 192.0.2.1"); },
  });
  assert.deepEqual(r2, { righe: null, errore: "timeout" });
});
