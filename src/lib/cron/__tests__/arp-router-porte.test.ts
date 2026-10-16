// Topologia fase 2b, Task 1b. Fino alla v0.3.279 i MAC per porta di un router
// venivano dall'ARP: `interface=` è l'interfaccia L3 (bridge, VLAN, VRRP), non il
// cavo — sul cliente A 747 righe su 753 non provavano niente. Ora il router
// scrive in mac_port_entries solo la bridge host sulle porte fisiche; l'ARP
// resta per IP↔MAC. Un errore della bridge host non ferma l'ARP e si vede nel
// resoconto, senza MAC né IP nel log.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { runArpPoll } from "@/lib/cron/jobs";
import type { RouterClient } from "@/lib/devices/router-client";
import { parseMikrotikInterfaceTypes, parseMikrotikMacTable } from "@/lib/devices/mikrotik-porte";

const T = "TESTARPROUTER";
const db = () => getTenantDb(T);

beforeEach(() => {
  db().exec("DELETE FROM mac_port_entries; DELETE FROM arp_entries; DELETE FROM hosts; DELETE FROM network_devices; DELETE FROM networks;");
  db().exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'LAN prova')");
  db().exec(
    "INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll) "
    + "VALUES (1, 'RTR-1', '192.0.2.1', 'router', 'mikrotik', 'ssh', 1, 1)",
  );
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

// ARP in forma vera: gli IP stanno su bridge, VLAN e su una porta instradata.
const ARP = [
  { ip: "192.0.2.10", mac: "02:00:00:00:30:01", interface_name: "bridge" },
  { ip: "192.0.2.11", mac: "02:00:00:00:30:02", interface_name: "vlan10" },
  { ip: "192.0.2.12", mac: "02:00:00:00:30:03", interface_name: "ether2" },
];
const INTERFACCE = [
  " 0  RS name=ether2 default-name=ether2 type=ether mtu=1500",
  " 1  RS name=ether3 default-name=ether3 type=ether mtu=1500",
  " 2  RS name=sfp-sfpplus1 default-name=sfp-sfpplus1 type=ether mtu=1500",
  " 3  R  name=bridge type=bridge mtu=auto",
  " 4  R  name=vlan10 type=vlan mtu=1500",
].join("\n");
const BRIDGE_HOST = [
  " 0 DL  mac-address=02:00:00:00:10:03 on-interface=ether3 bridge=bridge",
  " 1 D   mac-address=02:00:00:00:30:01 vid=10 on-interface=ether3 bridge=bridge",
  " 2 D   mac-address=02:00:00:00:30:04 vid=10 on-interface=sfp-sfpplus1 bridge=bridge",
  " 3 D   mac-address=02:00:00:00:30:05 vid=10 on-interface=vlan10 bridge=bridge",
].join("\n");

function clientFinto(over: Partial<RouterClient> = {}): RouterClient {
  return {
    async getArpTable() { return ARP; },
    async testConnection() { return true; },
    // Lo schema porte SNMP del router: con questo l'ARP finiva in mac_port_entries.
    async getPortSchema() {
      return ["bridge", "vlan10", "ether2", "ether3"].map((port_name, i) => ({
        port_index: i + 1, port_name, status: "up" as const, speed: null, duplex: null, vlan: null, poe_status: null, poe_power_mw: null,
        trunk_neighbor_name: null, trunk_neighbor_port: null, stp_state: null,
      }));
    },
    async getBridgeHosts() { return parseMikrotikMacTable(BRIDGE_HOST); },
    async getInterfaceTypes() { return parseMikrotikInterfaceTypes(INTERFACCE); },
    ...over,
  };
}
const righe = () =>
  (db().prepare("SELECT mac, port_name, source FROM mac_port_entries ORDER BY mac").all() as Array<{ mac: string; port_name: string; source: string }>)
    .map((r) => [r.mac, r.port_name, r.source]);

function catturaLog<R>(fn: () => Promise<R>): Promise<{ righe: string[]; esito: R }> {
  const out: string[] = [];
  const orig = { warn: console.warn, error: console.error };
  console.warn = (...a: unknown[]) => { out.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { out.push(a.map(String).join(" ")); };
  return fn().then((esito) => ({ righe: out, esito })).finally(() => { console.warn = orig.warn; console.error = orig.error; });
}

test("il router scrive i MAC per porta dalla bridge host (solo porte fisiche, fonte device); l'ARP non scrive più", async () => {
  await withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => clientFinto() }));
  assert.deepEqual(righe(), [
    ["02:00:00:00:30:01", "ether3", "device"],
    ["02:00:00:00:30:04", "sfp-sfpplus1", "device"],
  ]);
  const arp = db().prepare("SELECT COUNT(*) AS n FROM arp_entries").get() as { n: number };
  assert.equal(arp.n, 3, "l'ARP resta per IP↔MAC");
});

test("router senza bridge host (non MikroTik SSH): nessuna riga MAC per porta, l'ARP resta", async () => {
  const esito = await withTenant(T, () =>
    runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => clientFinto({ getBridgeHosts: undefined, getInterfaceTypes: undefined }) }));
  assert.deepEqual(righe(), []);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM arp_entries").get() as { n: number }).n, 3);
  assert.equal(esito.error, undefined);
});

test("bridge host che fallisce: l'ARP si legge lo stesso, il resoconto lo dice, il log non ha MAC né IP", async () => {
  const { righe: log, esito } = await catturaLog(() =>
    withTenant(T, () => runArpPoll(null, {
      skipDhcpLeases: true,
      creaClientRouter: async () => clientFinto({
        async getBridgeHosts() {
          throw Object.assign(new Error("connect ETIMEDOUT 192.0.2.1:22 02:00:00:00:30:01"), { code: "ETIMEDOUT" });
        },
      }),
    })));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM arp_entries").get() as { n: number }).n, 3);
  assert.deepEqual(righe(), []);
  assert.match(esito.phase ?? "", /porte fisiche non lette.*RTR-1.*ETIMEDOUT/);
  const mie = log.filter((r) => /porte fisiche/.test(r));
  assert.equal(mie.length, 1, `una riga di log: ${log.join(" | ")}`);
  assert.match(mie[0], /#1/);
  assert.doesNotMatch(log.join("\n"), /192\.0\.2\.|02:00:00/, "niente IP né MAC nel log");
});
