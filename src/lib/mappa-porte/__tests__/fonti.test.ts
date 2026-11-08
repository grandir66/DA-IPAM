// Riccardo, 07/11: «trova un sistema per evitare che ad ogni iterazione si perdano dati». Ogni lettura riscriveva `switch_ports`
// e `arp_entries`, e l'ultimo lettore cancellava gli altri: PoE e uplink del controller duravano mezz'ora.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as tenant from "@/lib/db-tenant";
import { unisciStrati } from "@/lib/mappa-porte/completa";
import { cercaRotte, leggiIngresso, ricalcolaMappaPorte } from "@/lib/mappa-porte/calcolo";
import { dalloSnapshot } from "@/lib/mappa-porte/parser";
import { giroParserDelTenant } from "@/lib/mappa-porte/giro-parser";
import { scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { snapshotSchema, type AcquisitionSnapshot } from "@/lib/acquisition/schema";
import { rotteDelGateway, parseRoutingResponse } from "@/lib/integrations/unifi-reti";
import type { RigaPorta } from "@/lib/mappa-porte/tipi";

const T = "TESTMAPPAFONTI";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
const d = () => getTenantDb(T);
const AT = "2026-11-07T08:00:00.000Z";
const porta = (o: Partial<RigaPorta>): RigaPorta => ({ device_id: 1, port_index: 5, port_name: "Slot: 0 Port: 5", status: "up", speed: null, vlan: null, poe_status: null, poe_power_mw: null, stp_state: null, is_uplink: 0, ...o });
const strato = (o: object) => ({ device_id: 1, fonte: "controller", port_index: 5, port_name: "CAM-185", valori: JSON.stringify({ poe_status: "delivering", poe_power_mw: 4200, is_uplink: 1 }), letto_il: AT, ...o });
const riga = (p: Partial<Parameters<typeof tenant.upsertSwitchPorts>[1][number]>) => ({ port_index: 5, port_name: "Port 5", status: "up", speed: null, duplex: null, vlan: null, poe_status: null, poe_power_mw: null, mac_count: 0, is_trunk: 0, single_mac: null, single_mac_vendor: null, single_mac_ip: null, single_mac_hostname: null, host_id: null, trunk_neighbor_name: null, trunk_neighbor_port: null, trunk_primary_device_id: null, trunk_primary_name: null, stp_state: null, ...p }) as Parameters<typeof tenant.upsertSwitchPorts>[1][number];

test("gli strati riempiono i buchi della riga e non la sovrascrivono; nomi diversi si abbinano per indice", () => {
  const [p] = unisciStrati([porta({ poe_status: "off" })], [strato({})]);
  assert.equal(p.poe_status, "off", "la riga vince dove ha un valore");
  assert.equal(p.poe_power_mw, 4200);
  assert.equal(p.is_uplink, 1, "l'uplink del controller c'è anche se il giro l'ha azzerato");
  assert.equal(p.port_name, "Slot: 0 Port: 5");
});

test("una porta che solo uno strato conosce entra; uno strato rovinato si salta", () => {
  const r = unisciStrati([porta({})], [strato({ port_index: 9, port_name: "SFP+ 1", valori: '{"status":"up"}' }), strato({ port_index: 10, port_name: "SFP+ 2", valori: "{" })]);
  assert.deepEqual(r.map((x) => x.port_name), ["Slot: 0 Port: 5", "SFP+ 1"]);
});

const sez = <D,>(data: D, status = "ok") => ({ status, collected_at: AT, sources: ["ssh:prova"], warnings: [], data });
const iface = (name: string, if_index: number, o: object = {}) => ({ name, if_index, description: null, kind: "physical", admin_status: "up", oper_status: "up", speed_bps: 1e9, reported_speed_bps: null, duplex: "full", mtu: null, mac: null, counters: {}, pvid: 10, ...o });
const snap = (o: object = {}): AcquisitionSnapshot => snapshotSchema.parse({
  schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "192.0.2.60", collected_at: AT, duration_ms: 10, status: "ok",
  identity: sez(null, "unsupported"), interfaces: sez([iface("1", 1), iface("2", 2, { oper_status: "down", speed_bps: null })]),
  vlans: sez([{ id: 10, name: null, tagged_ports: ["2"], untagged_ports: ["1"], forbidden_ports: [] }]),
  forwarding: sez([{ mac: "02:00:00:00:60:01", vlan_id: 10, fdb_id: null, bridge_port: null, if_index: 1, port: null, status: null }, { mac: "02:00:00:00:60:02", vlan_id: null, fdb_id: null, bridge_port: null, if_index: 77, port: null, status: null }]),
  neighbors: sez([{ local_port: "2", remote_chassis: "02:00:00:00:60:03", remote_port: "Port 1", system_name: null, system_description: null, management_addresses: [], capabilities: [], ttl_seconds: null }]),
  spanning_tree: sez({ enabled: null, protocol: null, ports: [] }, "unsupported"), aggregation: sez([]),
  poe: sez([{ port: "1", enabled: true, status: "Delivering", power_watts: 3.5 }]), sensors: sez([], "skipped"),
  network: sez({ ipv4_addresses: [], arp: [{ address: "192.0.2.70", mac: "02:00:00:00:60:04", if_index: 1, type: null }] }), ...o,
});

test("lo snapshot di un parser diventa righe della mappa: tabella MAC, ARP, vicini, VLAN, PoE", () => {
  const r = dalloSnapshot(3, snap(), "2026-11-07 08:00:00");
  assert.deepEqual(r.macPorte.map((m) => [m.mac, m.port_name, m.source]), [["02:00:00:00:60:01", "1", "parser"]], "un MAC senza porta nota non si inventa una porta");
  assert.deepEqual(r.arp.map((a) => [a.ip, a.interface_name]), [["192.0.2.70", "1"]]);
  assert.equal(r.vicini[0].remote_mac, "02:00:00:00:60:03");
  assert.deepEqual(r.mkPorte, [{ device_id: 3, interface: "1", pvid: 10 }]);
  assert.equal(r.mkVlan[0].tagged, "2");
  assert.deepEqual(JSON.parse(r.porte[0].valori), { status: "up", speed: "1000 Mbps", duplex: "full", poe_status: "delivering", poe_power_mw: 3500 });
});

test("una sezione non letta vale «non so»: non produce righe", () => {
  const r = dalloSnapshot(3, snap({ forwarding: sez([], "unsupported"), vlans: sez([], "error") }), "2026-11-07 08:00:00");
  assert.deepEqual([r.macPorte.length, r.mkVlan.length, r.mkPorte.length], [0, 0, 0]);
});

test("rotte del gateway UniFi: forma vera di rest/routing, connesse ricavate dalle reti", () => {
  const statiche = parseRoutingResponse({ meta: { rc: "ok" }, data: [{ "static-route_nexthop": "192.0.2.254", "static-route_network": "198.51.100.0/24", "static-route_type": "nexthop-route", enabled: true, "static-route_distance": 1 }, { name: "senza rete" }] });
  const r = rotteDelGateway([{ id: "a", nome: "LAN", purpose: "corporate", vlan: null, vlan_enabled: false, ip_subnet: "192.0.2.1/24" }, { id: "b", nome: "WAN", purpose: "wan", vlan: null, vlan_enabled: null }], statiche);
  assert.deepEqual(r.map((x) => [x.destination, x.gateway, x.protocol]), [["192.0.2.0/24", null, "connected"], ["198.51.100.0/24", "192.0.2.254", "static"]]);
  assert.throws(() => parseRoutingResponse({ meta: { rc: "error", msg: "api.err" } }));
});

test("il giro dei parser non parte da spenta, e non tocca niente", async () => {
  await withTenant(T, async () => assert.deepEqual(await giroParserDelTenant({ collect: () => { throw new Error("non doveva partire"); }, adesso: () => new Date() }), { letti: 0, saltati: 0, falliti: 0 }));
});

test("acceso, il giro salta i PC registrati come switch e chi non ha un collector", async () => {
  await withTenant(T, async () => {
    d().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, port, enabled) VALUES (3, 'PC', '192.0.2.3', 'switch', 'other', 'winrm', 5985, 1)");
    scriviInterruttore("mappa_dati", true, "prova");
    const e = await giroParserDelTenant({ collect: () => { throw new Error("non doveva partire"); }, adesso: () => new Date() });
    assert.equal(e.letti + e.falliti, 0);
    scriviInterruttore("mappa_dati", false, "prova");
  });
});

after(() => deleteTenantDatabase(T));
beforeEach(() => withTenant(T, () => {
  d().exec(`DELETE FROM mappa_porte_fonti; DELETE FROM mappa_porte_visti; DELETE FROM mappa_porte_rotte; DELETE FROM mappa_porte_oggetti; DELETE FROM routing_table; DELETE FROM arp_entries; DELETE FROM switch_ports; DELETE FROM mac_port_entries; DELETE FROM network_devices;`);
  d().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, port) VALUES (1, 'SW', '192.0.2.1', 'switch', 'ubiquiti', 'snmp_v2', 161), (2, 'RT', '192.0.2.2', 'router', 'mikrotik', 'ssh', 22)");
}));

test("il controller scrive, il giro riscrive: lo strato del controller resta e la mappa lo vede", () => {
  withTenant(T, () => {
    tenant.upsertSwitchPorts(1, [riga({ port_name: "CAM-185", poe_status: "delivering", poe_power_mw: 4200, is_uplink: 1 })], "controller");
    tenant.upsertSwitchPorts(1, [riga({ port_name: "Slot: 0 Port: 5" })]);
    assert.equal((d().prepare("SELECT is_uplink FROM switch_ports WHERE device_id = 1").get() as { is_uplink: number }).is_uplink, 0, "switch_ports, che legge la Topologia, non cambia");
    const [p] = leggiIngresso().porte.filter((x) => x.device_id === 1);
    assert.deepEqual([p.poe_power_mw, p.is_uplink], [4200, 1]);
  });
});

test("il gateway senza host si collega all'host col suo MAC; un collegamento che c'è non si tocca", () => {
  withTenant(T, () => {
    d().exec("DELETE FROM hosts; DELETE FROM networks; INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'LAN')");
    d().exec("INSERT INTO hosts (id, network_id, ip, mac, status) VALUES (5, 1, '192.0.2.9', 'A4:F8:FF:20:0E:88', 'online'), (6, 1, '192.0.2.10', '02:00:00:00:70:02', 'online')");
    tenant.collegaHostPerMac(2, "a4:f8:ff:20:0e:88");
    assert.equal(tenant.getNetworkDeviceById(2)?.host_id, 5);
    tenant.collegaHostPerMac(2, "02:00:00:00:70:02");
    assert.equal(tenant.getNetworkDeviceById(2)?.host_id, 5);
    d().exec("UPDATE network_devices SET host_id = NULL; DELETE FROM hosts");
  });
});

test("LibreNMS dà posizioni solo per gli apparati che il giro non legge", () => {
  withTenant(T, () => {
    d().exec(`DELETE FROM librenms_apparato; DELETE FROM librenms_porta; DELETE FROM librenms_mac_porta;
      INSERT INTO librenms_apparato (librenms_device_id, ip, letto_il) VALUES (1, '192.0.2.1', datetime('now')), (2, '192.0.2.2', datetime('now'));
      INSERT INTO librenms_porta (librenms_device_id, port_id, if_name, letto_il) VALUES (1, 1, '0/5', datetime('now')), (2, 2, 'ether2', datetime('now'));
      INSERT INTO librenms_mac_porta (librenms_device_id, port_id, mac, letto_il) VALUES (1, 1, '02:00:00:00:71:01', datetime('now')), (2, 2, '02:00:00:00:71:02', datetime('now'));
      INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp, source) VALUES (1, '02:00:00:00:71:03', 'Port 1', datetime('now'), 'device');`);
    const r = leggiIngresso().macPorte.filter((m) => m.source === "librenms").map((m) => [m.device_id, m.port_name]);
    assert.deepEqual(r, [[2, "ether2"]]);
    d().exec("DELETE FROM librenms_apparato; DELETE FROM librenms_porta; DELETE FROM librenms_mac_porta");
  });
});

test("un giro vuoto non cancella lo strato", () => {
  withTenant(T, () => {
    tenant.upsertSwitchPorts(1, [riga({ is_uplink: 1 })], "controller");
    tenant.upsertSwitchPorts(1, [], "controller");
    assert.equal((d().prepare("SELECT COUNT(*) AS n FROM mappa_porte_fonti").get() as { n: number }).n, 1);
  });
});

test("una voce ARP uscita dal router resta in mappa; una rotta sparita resta col segno «non più vista»", () => {
  withTenant(T, () => {
    d().exec("INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp, source) VALUES (1, '02:00:00:00:70:09', 'Port 1', datetime('now'), 'device')");
    d().exec("INSERT INTO arp_entries (device_id, mac, ip, interface_name) VALUES (2, '02:00:00:00:70:01', '192.0.2.80', 'bridge')");
    d().exec("INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, active) VALUES (2, '198.51.100.0/24', '192.0.2.254', 'ether1', 'static', 1), (2, '203.0.113.0/24', NULL, 'bridge', 'connected', 1)");
    ricalcolaMappaPorte(Date.now() - 3_600_000);
    d().exec("DELETE FROM arp_entries; DELETE FROM routing_table WHERE destination = '198.51.100.0/24'");
    ricalcolaMappaPorte();
    const o = d().prepare("SELECT ips FROM mappa_porte_oggetti WHERE mac = '02:00:00:00:70:01'").get() as { ips: string } | undefined;
    assert.ok(o, "il MAC è ancora in mappa");
    assert.ok(o.ips.includes("192.0.2.80"));
    const r = cercaRotte({ pagina: 0 }).righe;
    assert.deepEqual(r.map((x) => [x.destinazione, x.presente]), [["198.51.100.0/24", false], ["203.0.113.0/24", true]]);
  });
});

test("il giro prende anche hypervisor e Stormshield registrato come server; non gli spenti né i PC in winrm", async () => {
  const { daLeggereNelGiro } = await import("@/lib/mappa-porte/giro-parser");
  assert.equal(daLeggereNelGiro({ enabled: 1, device_type: "hypervisor", vendor: "proxmox", protocol: "ssh" }), true);
  assert.equal(daLeggereNelGiro({ enabled: 1, device_type: "server", vendor: "stormshield", protocol: "ssh" }), true);
  assert.equal(daLeggereNelGiro({ enabled: 0, device_type: "switch", vendor: "ubiquiti", protocol: "api" }), false);
  assert.equal(daLeggereNelGiro({ enabled: 1, device_type: "switch", vendor: "windows", protocol: "winrm" }), false);
  assert.equal(daLeggereNelGiro({ enabled: 1, device_type: "server", vendor: "linux", protocol: "ssh" }), false);
});
