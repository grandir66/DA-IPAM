/**
 * Decisione (a) di fine giro 2: con l'interruttore acceso e un collector per l'apparato, i giri pianificati non
 * riscrivono le colonne di `switch_ports` che il collector fornisce; continuano a scrivere MAC per porta e ciò che il
 * collector non legge. Interruttore spento, «classica» scelta o nessuno snapshot usabile = comportamento di oggi
 * (`upsertSwitchPorts`, riga intera).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/giri.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as tenant from "@/lib/db-tenant";
import { snapshotSchema, type AcquisitionSnapshot, type DeviceInterface } from "@/lib/acquisition/schema";
import { applicaSnapshot } from "@/lib/acquisizione-modulare/applica";
import { salvaSnapshot } from "@/lib/acquisizione-modulare/archivio";
import { scriviPorteDelGiro, type PortaDelGiro } from "@/lib/acquisizione-modulare/giri";

const T = "TESTACQGIRI";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
const AT = "2026-10-22T08:00:00.000Z";
type Stato = "ok" | "partial" | "unsupported" | "error" | "skipped";
const sez = <D>(data: D, status: Stato = "ok") => ({ status, collected_at: AT, sources: ["ssh:prova"], warnings: [], data });
const iface = (name: string, o: Partial<DeviceInterface> = {}): DeviceInterface => ({ name, if_index: null, description: null, kind: "physical", admin_status: "up", oper_status: "up", speed_bps: 1e9, reported_speed_bps: 1e9, duplex: "full", mtu: null, mac: null, counters: {}, pvid: 20, ...o });

function snap(o: Partial<Record<keyof AcquisitionSnapshot, unknown>> = {}): AcquisitionSnapshot {
  return snapshotSchema.parse({
    schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "192.0.2.60", collected_at: AT, duration_ms: 10, status: "ok",
    identity: sez({ manufacturer: "HPE", model: "Aruba 2540", firmware: "YC.16.11.0020", serial_number: "LAB002", hostname: "sw-giri", mac: null, sys_object_id: null, uptime_seconds: null }),
    interfaces: sez([iface("1"), iface("2", { oper_status: "down", speed_bps: null, pvid: null }), iface("49", { if_index: 49 })]),
    vlans: sez([]), forwarding: sez([]), neighbors: sez([], "unsupported"),
    spanning_tree: sez({ enabled: true, protocol: "rstp", ports: [{ port: "1", instance: "CIST", state: "forwarding", role: "root" }] }),
    aggregation: sez([]), poe: sez([], "unsupported"), sensors: sez([], "skipped"),
    network: sez({ ipv4_addresses: [], arp: [] }),
    ...o,
  });
}

/** Le porte come le scrive il giro di sempre (ProCurve via SSH: tipo di porta in `speed`, nessun PVID, MAC per porta). */
const giro = (o: Partial<PortaDelGiro> = {}): PortaDelGiro[] => [
  { port_index: 1, port_name: "1", status: "up", speed: "100/1000T", duplex: null, vlan: 1, poe_status: null, poe_power_mw: null, mac_count: 1, is_trunk: 0, single_mac: "02:00:00:00:02:01", single_mac_vendor: null, single_mac_ip: "192.0.2.10", single_mac_hostname: "pc-uno", host_id: null, trunk_neighbor_name: null, trunk_neighbor_port: null, trunk_primary_device_id: null, trunk_primary_name: null, stp_state: null, ...o },
  { port_index: 2, port_name: "2", status: "up", speed: "100/1000T", duplex: null, vlan: 7, poe_status: null, poe_power_mw: null, mac_count: 0, is_trunk: 0, single_mac: null, single_mac_vendor: null, single_mac_ip: null, single_mac_hostname: null, host_id: null, trunk_neighbor_name: null, trunk_neighbor_port: null, trunk_primary_device_id: null, trunk_primary_name: null, stp_state: null },
];

let dev = 0;
const d = () => getTenantDb(T);
const porta = (nome: string) => d().prepare("SELECT port_index, port_name, status, speed, duplex, vlan, mac_count, single_mac, stp_state FROM switch_ports WHERE device_id = ? AND port_name = ?").get(dev, nome) as Record<string, unknown> | undefined;
const nomi = () => (d().prepare("SELECT port_name FROM switch_ports WHERE device_id = ? ORDER BY port_index").all(dev) as Array<{ port_name: string }>).map((r) => r.port_name);
const salvaEApplica = (s: AcquisitionSnapshot) => applicaSnapshot(dev, salvaSnapshot(dev, s, { credenziali: {}, utente: null }), s);
const device = () => tenant.getNetworkDeviceById(dev)!;

describe("giri pianificati e colonne del collector (decisione a)", () => {
  before(() => {
    withTenant(T, () => {
      dev = Number(d().prepare("INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, port) VALUES ('sw-giri', '192.0.2.60', 'switch', 'hp', 'procurve', 'ssh', 22)").run().lastInsertRowid);
    });
  });
  after(() => deleteTenantDatabase(T));
  beforeEach(() => {
    withTenant(T, () => {
      d().prepare("DELETE FROM acquisition_snapshots WHERE device_id = ?").run(dev);
      d().prepare("DELETE FROM acquisition_source_choices WHERE device_id = ?").run(dev);
      d().prepare("DELETE FROM switch_ports WHERE device_id = ?").run(dev);
      tenant.impostaAcquisizioneModulare(true);
    });
  });

  it("acceso, con uno snapshot applicato: il giro notturno non rimette i dati vecchi e scrive i MAC per porta", () => {
    withTenant(T, () => {
      salvaEApplica(snap());
      assert.equal(porta("1")?.speed, "1000 Mbps");
      scriviPorteDelGiro(device(), giro());
      const uno = porta("1")!;
      assert.equal(uno.speed, "1000 Mbps", "velocità del collector, non il tipo di porta del giro");
      assert.equal(uno.duplex, "full");
      assert.equal(uno.vlan, 20);
      assert.equal(uno.stp_state, "forwarding");
      assert.equal(uno.mac_count, 1, "i MAC per porta li scrive ancora il giro");
      assert.equal(uno.single_mac, "02:00:00:00:02:01");
      const due = porta("2")!;
      assert.equal(due.status, "down", "lo stato è del collector");
      assert.equal(due.vlan, 7, "PVID ignoto al collector: la VLAN resta del giro");
      assert.ok(nomi().includes("49"), "la porta che solo il collector conosce resta");
    });
  });

  it("interruttore spento: il giro riscrive la riga intera come oggi", () => {
    withTenant(T, () => {
      salvaEApplica(snap());
      tenant.impostaAcquisizioneModulare(false);
      scriviPorteDelGiro(device(), giro());
      assert.equal(porta("1")?.speed, "100/1000T");
      assert.equal(porta("1")?.vlan, 1);
      assert.deepEqual(nomi(), ["1", "2"]);
    });
  });

  it("«classica» scelta: comportamento di oggi", () => {
    withTenant(T, () => {
      salvaEApplica(snap());
      tenant.salvaSceltaFonteAcquisizione(dev, "classica", null);
      scriviPorteDelGiro(device(), giro());
      assert.equal(porta("1")?.speed, "100/1000T");
    });
  });

  it("nessuno snapshot, o solo snapshot in errore: comportamento di oggi", () => {
    withTenant(T, () => {
      scriviPorteDelGiro(device(), giro());
      assert.equal(porta("1")?.speed, "100/1000T");
      const errore = snap({ status: "error", interfaces: sez([], "error") });
      salvaSnapshot(dev, errore, { credenziali: {}, utente: null });
      scriviPorteDelGiro(device(), giro({ speed: "10/100TX" }));
      assert.equal(porta("1")?.speed, "10/100TX");
    });
  });

  it("partial: protegge solo i campi che il collector ha letto", () => {
    withTenant(T, () => {
      salvaEApplica(snap({ interfaces: sez([iface("1", { speed_bps: null, duplex: null })], "partial"), spanning_tree: sez({ enabled: true, protocol: "rstp", ports: [] }, "unsupported") }));
      scriviPorteDelGiro(device(), giro({ stp_state: "blocking" }));
      const uno = porta("1")!;
      assert.equal(uno.speed, "100/1000T", "velocità non letta dal collector: la scrive il giro");
      assert.equal(uno.vlan, 20);
      assert.equal(uno.stp_state, "blocking", "spanning tree non letto: lo scrive il giro");
    });
  });
});

describe("i giri pianificati passano da scriviPorteDelGiro", () => {
  it("cron/jobs.ts non chiama più upsertSwitchPorts direttamente", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/cron/jobs.ts"), "utf8");
    assert.equal(/\bupsertSwitchPorts\s*\(/.test(src), false);
    assert.equal((src.match(/\bscriviPorteDelGiro\s*\(/g) ?? []).length, 2);
  });

  it("la scansione dei router dalla pagina Reti (bulk-scan-devices) scrive le porte allo stesso modo", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/networks/bulk-scan-devices/route.ts"), "utf8");
    assert.equal(/\bupsertSwitchPorts\s*\(/.test(src), false);
    assert.equal((src.match(/\bscriviPorteDelGiro\s*\(/g) ?? []).length, 2);
  });
});
