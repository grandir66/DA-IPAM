/**
 * Applicazione di uno snapshot all'apparato (C2.2-C2.5): porte per campo, manuale che vince, partial che non toglie,
 * ripetizione senza effetti, una transazione (caduta a metà = niente scritto), vicini e fatti con fonte `collector`
 * che la mappa di oggi (T1) non legge: ingresso e modello di T1 identici, con la controprova che il confronto vede una
 * riga della fonte di oggi.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/applica.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as tenant from "@/lib/db-tenant";
import { snapshotSchema, type AcquisitionSnapshot, type DeviceInterface } from "@/lib/acquisition/schema";
import { applicaSnapshot } from "@/lib/acquisizione-modulare/applica";
import { salvaSnapshot } from "@/lib/acquisizione-modulare/archivio";
import { buildTopologyModel } from "@/lib/topology/model";
import { serializza } from "@/lib/topology/__tests__/support/impronta";

const T = "TESTACQAPPLICA";
const T1 = "TESTACQAPPLICAT1";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
const AT = "2026-10-22T08:00:00.000Z";
type Stato = "ok" | "partial" | "unsupported" | "error" | "skipped";
const sez = <D>(data: D, status: Stato = "ok") => ({ status, collected_at: AT, sources: ["ssh:prova"], warnings: [], data });
const iface = (name: string, o: Partial<DeviceInterface> = {}): DeviceInterface => ({ name, if_index: null, description: null, kind: "physical", admin_status: "up", oper_status: "up", speed_bps: 1e9, reported_speed_bps: 1e9, duplex: "full", mtu: null, mac: null, counters: {}, pvid: 20, ...o });
const VICINO = { local_port: "1", remote_chassis: "02:00:00:00:00:aa", remote_port: "24", system_name: "sw-core", system_description: "Lab", management_addresses: ["192.0.2.1"], capabilities: ["bridge"], ttl_seconds: 120 };

function snap(o: Partial<Record<keyof AcquisitionSnapshot, unknown>> = {}): AcquisitionSnapshot {
  return snapshotSchema.parse({
    schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "192.0.2.50", collected_at: AT, duration_ms: 10, status: "ok",
    identity: sez({ manufacturer: "HPE", model: "Aruba 2540", firmware: "YC.16.11.0020", serial_number: "LAB001", hostname: "sw-lab", mac: null, sys_object_id: null, uptime_seconds: null }),
    interfaces: sez([iface("1"), iface("2", { oper_status: "down", speed_bps: null }), iface("Trk1", { kind: "aggregate" })]),
    vlans: sez([]), forwarding: sez([]), neighbors: sez([VICINO]),
    spanning_tree: sez({ enabled: true, protocol: "rstp", ports: [{ port: "1", instance: "CIST", state: "forwarding", role: "root" }] }),
    aggregation: sez([{ name: "Trk1", protocol: "lacp", admin_status: null, oper_status: null, members: ["2"] }]), poe: sez([], "unsupported"), sensors: sez([], "skipped"),
    network: sez({ ipv4_addresses: [], arp: [] }),
    ...o,
  });
}

let dev = 0;
let hostId = 0;
const d = () => getTenantDb(T);
const porte = () => d().prepare("SELECT port_index, port_name, status, speed, vlan, mac_count, single_mac, is_uplink, stp_state, trunk_neighbor_name FROM switch_ports WHERE device_id = ? ORDER BY port_index").all(dev) as Array<Record<string, unknown>>;
const salvaEApplica = (s: AcquisitionSnapshot) => applicaSnapshot(dev, salvaSnapshot(dev, s, { credenziali: {}, utente: null }), s);

describe("applicaSnapshot", () => {
  before(() => {
    withTenant(T, () => {
      dev = Number(d().prepare("INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, port, model) VALUES ('sw-lab', '192.0.2.50', 'switch', 'hp', 'procurve', 'ssh', 22, 'Aruba vecchio')").run().lastInsertRowid);
      d().exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'lab')");
      hostId = Number(d().prepare("INSERT INTO hosts (network_id, ip, model, serial_number) VALUES (1, '192.0.2.50', 'Aruba vecchio', 'SERIALE-A-MANO')").run().lastInsertRowid);
      // Porte scritte dal giro di sempre: la 1 col MAC unico e il segno d'uplink, che il collector non conosce e non tocca.
      d().prepare("INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, vlan, mac_count, single_mac, is_uplink) VALUES (?, 1, '1', 'up', '100 Mbps', 1, 1, '02:00:00:00:01:01', 1)").run(dev);
      d().prepare("INSERT INTO switch_ports (device_id, port_index, port_name, status, mac_count) VALUES (?, 77, 'vecchia', 'down', 0)").run(dev);
      // Un vicino della fonte di oggi sulla stessa chiave che il collector riscrive: deve restare `device`.
      tenant.upsertNeighbors(dev, [{ localPort: "1", remoteDevice: "sw-core", remotePort: "24", protocol: "lldp" }], "device");
    });
  });
  after(() => { deleteTenantDatabase(T); deleteTenantDatabase(T1); });

  it("partial: aggiorna e aggiunge, non toglie; i campi che il collector non conosce restano", () => {
    withTenant(T, () => {
      const e = salvaEApplica(snap({ interfaces: sez([iface("1"), iface("2", { oper_status: "down", speed_bps: null })], "partial") }));
      assert.ok(e.scritte > 0);
      const p = porte();
      assert.deepEqual(p.map((r) => r.port_name), ["1", "2", "vecchia"], "partial non toglie «vecchia»");
      const uno = p.find((r) => r.port_name === "1")!;
      assert.equal(uno.speed, "1000 Mbps");
      assert.equal(uno.vlan, 20);
      assert.equal(uno.mac_count, 1);
      assert.equal(uno.single_mac, "02:00:00:00:01:01");
      assert.equal(uno.is_uplink, 1);
    });
  });

  it("ok: toglie la porta che nessuna interfaccia ritrova, e lo registra", () => {
    withTenant(T, () => {
      salvaEApplica(snap());
      assert.ok(!porte().some((r) => r.port_name === "vecchia"));
      const tolta = d().prepare("SELECT esito FROM acquisition_changes WHERE device_id = ? AND chiave = 'vecchia'").get(dev) as { esito: string };
      assert.equal(tolta.esito, "tolta");
    });
  });

  it("identità sull'apparato; sull'host il seriale a mano vince ed è registrato come «manuale»", () => {
    withTenant(T, () => {
      const nd = tenant.getNetworkDeviceById(dev)!;
      assert.equal(nd.model, "Aruba 2540");
      assert.equal(nd.serial_number, "LAB001");
      const h = d().prepare("SELECT model, serial_number FROM hosts WHERE id = ?").get(hostId) as { model: string; serial_number: string };
      assert.equal(h.model, "Aruba 2540", "il modello copiato dall'apparato si aggiorna");
      assert.equal(h.serial_number, "SERIALE-A-MANO", "il seriale scritto a mano resta");
      const m = d().prepare("SELECT COUNT(*) AS n FROM acquisition_changes WHERE device_id = ? AND esito = 'manuale' AND campo = 'serial_number'").get(dev) as { n: number };
      assert.ok(m.n >= 1);
    });
  });

  it("ripetere lo stesso snapshot non cambia niente", () => {
    withTenant(T, () => {
      const prima = JSON.stringify(porte());
      const e = salvaEApplica(snap());
      assert.equal(e.scritte, 0);
      assert.equal(JSON.stringify(porte()), prima);
    });
  });

  it("vicini e fatti con fonte collector; il vicino della fonte di oggi resta suo", () => {
    withTenant(T, () => {
      const fonti = d().prepare("SELECT source FROM device_neighbors WHERE device_id = ? AND local_port = '1'").all(dev) as Array<{ source: string }>;
      assert.deepEqual(fonti.map((f) => f.source), ["device"], "ON CONFLICT non prende la riga di T1");
      const fatti = d().prepare("SELECT port_name, lag_group, stp_role FROM topology_port_facts WHERE device_id = ? AND source = 'collector' ORDER BY port_name").all(dev) as Array<Record<string, unknown>>;
      assert.deepEqual(fatti, [{ port_name: "1", lag_group: null, stp_role: "root" }, { port_name: "2", lag_group: "Trk1", stp_role: null }, { port_name: "Trk1", lag_group: null, stp_role: null }]);
    });
  });

  it("caduta a metà dell'applicazione: niente scritto (una transazione)", () => {
    withTenant(T, () => {
      const prima = JSON.stringify({ p: porte(), nd: tenant.getNetworkDeviceById(dev)?.firmware });
      d().exec("CREATE TRIGGER prova_caduta BEFORE INSERT ON acquisition_changes BEGIN SELECT RAISE(ABORT, 'caduta di prova'); END");
      try {
        assert.throws(() => salvaEApplica(snap({ identity: sez({ manufacturer: "HPE", model: "Aruba 2540", firmware: "YC.16.11.9999", serial_number: "LAB001", hostname: "sw-lab", mac: null, sys_object_id: null, uptime_seconds: null }), interfaces: sez([iface("1", { speed_bps: 1e8 })], "partial") })), /caduta di prova/);
      } finally {
        d().exec("DROP TRIGGER prova_caduta");
      }
      assert.equal(JSON.stringify({ p: porte(), nd: tenant.getNetworkDeviceById(dev)?.firmware }), prima);
    });
  });
});

describe("T1 bit per bit con vicini e fatti `collector`", () => {
  it("ingresso e modello della mappa di oggi identici; controprova con la fonte di oggi", () => {
    withTenant(T1, () => {
      const db = getTenantDb(T1);
      db.exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES
        (1, 'SW-A', '192.0.2.61', 'switch', 'hp', 'ssh'), (2, 'SW-B', '192.0.2.62', 'switch', 'hp', 'ssh')`);
      const ADESSO = Date.now();
      const foto = () => { const input = tenant.getTopologyModelInput(2, ADESSO); return serializza({ input, modello: buildTopologyModel(input) }); };
      const prima = foto();
      const vicino = [{ localPort: "1", remoteDevice: "SW-B", remotePort: "1", protocol: "lldp", remoteIp: "192.0.2.62", discoveredBy: "lldp", remoteCaps: "bridge" }];
      tenant.upsertNeighbors(1, vicino, "collector");
      tenant.scriviFattiTopologia(1, "collector", { porte: [{ port_key: "n:1", port_name: "1", port_index: null, if_kind: "physical", running: 1, lag_group: null, stp_role: "root", stp_state: "forwarding" }], bridge: [], macs: [] });
      assert.equal(foto(), prima, "con vicini e fatti collector la mappa di oggi non cambia");
      tenant.upsertNeighbors(2, [{ localPort: "1", remoteDevice: "SW-A", remotePort: "1", protocol: "lldp", remoteIp: "192.0.2.61" }], "device");
      assert.notEqual(foto(), prima, "controprova: un vicino della fonte di oggi la cambia");
    });
  });
});

// 70151, 22/10: le VLAN dei Comware arrivano solo dal collector (SNMP tooBig su ogni riga delle porte): l'acquisizione le
// scrive nelle tabelle della matrice, una volta; ripetere lo stesso snapshot non riscrive.
describe("applicaSnapshot: VLAN della scheda dal collector", () => {
  const T2 = "TESTACQAPPLICAVLAN";
  let sw = 0;
  const vlan = (id: number, name: string, tagged: string[], untagged: string[]) => ({ id, name, description: null, tagged_ports: tagged, untagged_ports: untagged, forbidden_ports: [] });
  const conVlan = () => snap({
    collector: "hp-comware",
    interfaces: sez([iface("XGE1/0/1", { if_index: 101, pvid: 1 }), iface("XGE1/0/2", { if_index: 102, pvid: 20 })]),
    vlans: sez([vlan(1, "default", [], ["XGE1/0/1"]), vlan(20, "uffici", ["XGE1/0/1"], ["XGE1/0/2"])]),
    neighbors: sez([]), aggregation: sez([]), spanning_tree: sez({ enabled: true, protocol: "rstp", ports: [] }),
  });
  const applica = (s: AcquisitionSnapshot) => applicaSnapshot(sw, salvaSnapshot(sw, s, { credenziali: {}, utente: null }), s);
  before(() => {
    withTenant(T2, () => {
      sw = Number(getTenantDb(T2).prepare("INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, port) VALUES ('sw-irf', '192.0.2.70', 'switch', 'hp', 'comware', 'ssh', 22)").run().lastInsertRowid);
    });
  });
  after(() => deleteTenantDatabase(T2));

  it("scrive VLAN, porte taggate e non taggate e PVID con fonte collector, e lo registra", () => {
    withTenant(T2, () => {
      const e = applica(conVlan());
      const v = tenant.leggiVlanSwitchDb(sw);
      assert.equal(v.lettura?.tabella, "collector");
      assert.deepEqual(v.vlan.map((x) => x.vlan_id), [1, 20]);
      assert.deepEqual(v.porte.map((p) => `${p.vlan_id}|${p.if_index}|${p.untagged ? "U" : "T"}`), ["1|101|U", "20|101|T", "20|102|U"]);
      assert.deepEqual(v.pvid, [{ if_index: 101, pvid: 1 }, { if_index: 102, pvid: 20 }]);
      const righe = getTenantDb(T2).prepare("SELECT destinazione, campo, dopo FROM acquisition_changes WHERE device_id = ? AND destinazione = 'vlan'").all(sw) as Array<{ destinazione: string; campo: string; dopo: string }>;
      assert.equal(righe.length, 1);
      assert.match(righe[0]!.dopo, /2 VLAN, 1 porte taggate/);
      assert.ok(e.scritte >= 1);
    });
  });

  it("lo stesso snapshot non riscrive la fotografia né la registra di nuovo", () => {
    withTenant(T2, () => {
      const prima = tenant.leggiVlanSwitchDb(sw).lettura?.letto_il;
      applica(conVlan());
      assert.equal(tenant.leggiVlanSwitchDb(sw).lettura?.letto_il, prima);
      const n = (getTenantDb(T2).prepare("SELECT COUNT(*) AS n FROM acquisition_changes WHERE device_id = ? AND destinazione = 'vlan'").get(sw) as { n: number }).n;
      assert.equal(n, 1);
    });
  });
});
