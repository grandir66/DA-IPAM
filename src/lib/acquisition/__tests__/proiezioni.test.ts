/**
 * Proiezioni pure snapshot → modifiche (piano 2026-10-21 §3, C2.1-C2.2): sezione ok/partial, null = ignoto,
 * partial non toglie, campo assente = resta, null nelle modifiche = letto e vuoto, il manuale vince.
 *
 * Run: node --import tsx --test src/lib/acquisition/__tests__/proiezioni.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { snapshotSchema, type AcquisitionSnapshot, type DeviceInterface } from "../schema";
import { campiDelCollectorPerPorta, proiettaFatti, proiettaIdentita, proiettaPorte, proiettaVicini, proietta, type PortaAttuale } from "../proiezioni";
import { ricevePorteDaSwitch } from "../catalogo";

const AT = "2026-10-22T08:00:00.000Z";
type Stato = "ok" | "partial" | "unsupported" | "error" | "skipped";
const sez = <T>(data: T, status: Stato = "ok") => ({ status, collected_at: AT, sources: ["ssh:prova"], warnings: [], data });

function iface(name: string, o: Partial<DeviceInterface> = {}): DeviceInterface {
  return { name, if_index: null, description: null, kind: "physical", admin_status: "up", oper_status: "up", speed_bps: 1e9, reported_speed_bps: 1e9, duplex: "full", mtu: null, mac: null, counters: {}, pvid: 10, ...o };
}

function snap(o: Partial<Record<keyof AcquisitionSnapshot, unknown>> = {}): AcquisitionSnapshot {
  return snapshotSchema.parse({
    schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "192.0.2.40", collected_at: AT, duration_ms: 10, status: "ok",
    identity: sez({ manufacturer: "HPE", model: "Aruba 2540", firmware: "YC.16.11.0020", serial_number: "LAB001", hostname: "sw-lab", mac: null, sys_object_id: null, uptime_seconds: null, part_number: "JL357A" }),
    interfaces: sez([iface("1"), iface("2", { oper_status: "down", speed_bps: null, pvid: null })]),
    vlans: sez([]), forwarding: sez([]), neighbors: sez([]),
    spanning_tree: sez({ enabled: true, protocol: "rstp", ports: [] }), aggregation: sez([]), poe: sez([]), sensors: sez([], "skipped"),
    network: sez({ ipv4_addresses: [], arp: [] }),
    ...o,
  });
}

const porta = (port_index: number, port_name: string, o: Partial<PortaAttuale> = {}): PortaAttuale => ({
  port_index, port_name, status: "up", speed: "1000 Mbps", duplex: "full", vlan: 10, poe_status: null, poe_power_mw: null, stp_state: null, trunk_neighbor_name: null, trunk_neighbor_port: null, ...o,
});

describe("identità", () => {
  const vuoto = { sysname: null, model: null, firmware: null, serial_number: null, part_number: null };

  it("da ok o partial entra ciò che non è null; un null non cancella", () => {
    const s = snap({ identity: sez({ manufacturer: null, model: null, firmware: "YC.16.11.0020", serial_number: null, hostname: null, mac: null, sys_object_id: null, uptime_seconds: null }, "partial") });
    const m = proiettaIdentita(s, { apparato: { ...vuoto, model: "Vecchio" }, host: null });
    assert.deepEqual(m.apparato, [{ campo: "firmware", prima: null, dopo: "YC.16.11.0020" }], "il modello letto null non tocca «Vecchio»");
  });

  it("da una sezione in errore non entra niente", () => {
    const s = snap({ identity: sez(null, "error") });
    assert.deepEqual(proiettaIdentita(s, { apparato: vuoto, host: null }).apparato, []);
  });

  it("sull'host il valore messo a mano vince; quello copiato dall'apparato si aggiorna", () => {
    const m = proiettaIdentita(snap(), {
      apparato: { ...vuoto, model: "Aruba vecchio", serial_number: "LAB000" },
      host: { model: "Aruba vecchio", firmware: null, serial_number: "SERIALE-A-MANO" },
    });
    assert.deepEqual(m.host.map((x) => x.campo).sort(), ["firmware", "model"]);
    assert.deepEqual(m.conflitti, [{ destinazione: "host", campo: "serial_number", manuale: "SERIALE-A-MANO", letto: "LAB001" }]);
  });

  it("ripetere lo stesso snapshot non cambia niente", () => {
    const s = snap();
    const dopo = { sysname: "sw-lab", model: "Aruba 2540", firmware: "YC.16.11.0020", serial_number: "LAB001", part_number: "JL357A" };
    const m = proiettaIdentita(s, { apparato: dopo, host: { model: "Aruba 2540", firmware: "YC.16.11.0020", serial_number: "LAB001" } });
    assert.deepEqual(m, { apparato: [], host: [], conflitti: [] });
  });
});

describe("porte per campo", () => {
  it("campo assente = resta: PoE in errore non porta campi PoE", () => {
    const s = snap({ poe: sez([], "error") });
    const m = proiettaPorte(s, [porta(1, "1", { poe_status: "delivering", poe_power_mw: 4200, speed: "100 Mbps" })]);
    assert.deepEqual(m.aggiorna, [{ port_index: 1, port_name: "1", campi: { speed: "1000 Mbps" }, prima: { speed: "100 Mbps" } }]);
  });

  it("null = letto e vuoto: PoE ok senza la porta, vicini ok senza vicino", () => {
    const s = snap({ poe: sez([{ port: "2", enabled: true, status: "delivering", power_watts: 3.5 }]) });
    const m = proiettaPorte(s, [porta(1, "1", { poe_status: "delivering", poe_power_mw: 4200, trunk_neighbor_name: "sw-vecchio", trunk_neighbor_port: "24" })]);
    assert.deepEqual(m.aggiorna[0].campi, { poe_status: null, poe_power_mw: null, trunk_neighbor_name: null, trunk_neighbor_port: null });
  });

  it("partial non toglie; ok toglie le porte che nessuna interfaccia ritrova", () => {
    const attuali = [porta(1, "1"), porta(2, "2", { status: "down", speed: null, vlan: null }), porta(99, "Trk9")];
    assert.deepEqual(proiettaPorte(snap({ interfaces: sez([iface("1"), iface("2", { oper_status: "down", speed_bps: null, pvid: null })], "partial") }), attuali).togli, []);
    assert.deepEqual(proiettaPorte(snap(), attuali).togli, [{ port_index: 99, port_name: "Trk9" }]);
  });

  it("si ritrova per indice, poi per nome senza spazi né maiuscole; un'interfaccia «other» non diventa porta ma non fa togliere", () => {
    const s = snap({ interfaces: sez([iface("XGE1/0/1", { if_index: 7 }), iface("Gi 1/0/2"), iface("Vlan-interface10", { kind: "other" })]) });
    const m = proiettaPorte(s, [porta(7, "TenGig1/0/1"), porta(3, "gi1/0/2"), porta(50, "Vlan-interface10")]);
    assert.deepEqual(m.aggiungi, []);
    assert.deepEqual(m.togli, []);
  });

  it("il nome vince sull'indice: righe numerate per posizione (SSH di sempre) e ifIndex SNMP del collector non si mescolano", () => {
    // Revisione del 22/10: GE1/0/1 con ifIndex 3 finiva sulla riga 3 («GE1/0/3») e la riga vera veniva tolta.
    const attuali = [porta(1, "GE1/0/1"), porta(2, "GE1/0/2"), porta(3, "GE1/0/3"), porta(4, "GE1/0/4")];
    const s = snap({ interfaces: sez([iface("GE1/0/1", { if_index: 3, speed_bps: 1e8 }), iface("GE1/0/2", { if_index: 4, speed_bps: 1e8 }), iface("GE1/0/3", { if_index: 5 }), iface("GE1/0/4", { if_index: 6 })]) });
    const m = proiettaPorte(s, attuali);
    assert.deepEqual(m.togli, []);
    assert.deepEqual(m.aggiungi, []);
    assert.deepEqual(m.aggiorna.map((u) => [u.port_name, u.campi.speed]), [["GE1/0/1", "100 Mbps"], ["GE1/0/2", "100 Mbps"]]);
  });

  it("senza nome uguale si ritrova per indice, ma solo una riga che nessun nome ha già preso", () => {
    const m = proiettaPorte(snap({ interfaces: sez([iface("XGE1/0/1", { if_index: 7, speed_bps: 1e8 })]) }), [porta(7, "Ten-GigabitEthernet1/0/1")]);
    assert.deepEqual(m.aggiorna.map((u) => u.port_name), ["Ten-GigabitEthernet1/0/1"]);
    assert.deepEqual(m.togli, []);
  });

  it("le porte nuove prendono l'indice letto, il numero del nome, o il primo libero, senza scontri", () => {
    const s = snap({ interfaces: sez([iface("5"), iface("Trk1"), iface("XGE1/0/9", { if_index: 9 })]) });
    const m = proiettaPorte(s, [porta(5, "porta-5-di-un-altro-nome")]);
    // «5» non ritrova la porta 5 (altro nome) e il suo numero è già preso: primo libero dopo il più alto (9) → 10.
    assert.deepEqual(m.aggiungi.map((a) => [a.port_name, a.port_index]), [["5", 10], ["Trk1", 11], ["XGE1/0/9", 9]]);
    assert.deepEqual(m.togli, [{ port_index: 5, port_name: "porta-5-di-un-altro-nome" }]);
  });

  it("interfacce in errore: nessuna modifica alle porte", () => {
    assert.deepEqual(proiettaPorte(snap({ interfaces: sez([], "error") }), [porta(1, "1")]), { aggiorna: [], aggiungi: [], togli: [] });
  });

  it("velocità in Mbps come le scrive l'SNMP, STP solo dal CIST", () => {
    const s = snap({ spanning_tree: sez({ enabled: true, protocol: "mstp", ports: [{ port: "1", instance: "1", state: "Blocking", role: null }, { port: "1", instance: "CIST", state: "Forwarding", role: "root" }] }) });
    const m = proiettaPorte(s, [porta(1, "1", { speed: null })]);
    assert.deepEqual(m.aggiorna[0].campi, { speed: "1000 Mbps", stp_state: "forwarding" });
  });
});

describe("vicini e fatti", () => {
  const vicino = { local_port: "1", remote_chassis: "02:00:00:00:00:aa", remote_port: "24", system_name: "sw-core", system_description: "Lab switch", management_addresses: ["192.0.2.1"], capabilities: ["Bridge", "Router"], ttl_seconds: 120 };

  it("vicini da partial sì, da errore no; chassis MAC e capacità in minuscolo", () => {
    assert.equal(proiettaVicini(snap({ neighbors: sez([vicino], "error") })), null);
    const v = proiettaVicini(snap({ neighbors: sez([vicino], "partial") }));
    assert.deepEqual(v, [{ localPort: "1", remoteDevice: "sw-core", remotePort: "24", protocol: "lldp", remoteIp: "192.0.2.1", remoteMac: "02:00:00:00:00:aa", remotePlatform: "Lab switch", discoveredBy: "lldp", remoteCaps: "bridge,router" }]);
  });

  it("fatti: solo CIST, gruppo del fascio, ogni riga con tutte le colonne", () => {
    const s = snap({
      interfaces: sez([iface("1"), iface("Trk1", { kind: "aggregate" })]),
      aggregation: sez([{ name: "Trk1", protocol: "lacp", admin_status: null, oper_status: null, members: ["1"] }]),
      spanning_tree: sez({ enabled: true, protocol: "mstp", ports: [{ port: "1", instance: "2", state: "blocking", role: "alternate" }, { port: "Trk1", instance: "0", state: "forwarding", role: "DESI" }] }),
    });
    const f = proiettaFatti(s);
    assert.deepEqual(f, [
      { port_key: "n:1", port_name: "1", port_index: null, if_kind: "physical", running: 1, lag_group: "Trk1", stp_role: null, stp_state: null },
      { port_key: "n:trk1", port_name: "Trk1", port_index: null, if_kind: "lag", running: 1, lag_group: null, stp_role: "designated", stp_state: "forwarding" },
    ]);
  });

  it("sezioni non usate si dicono", () => {
    const p = proietta(snap({ neighbors: sez([], "unsupported"), poe: sez([], "skipped") }), { identita: { apparato: { sysname: null, model: null, firmware: null, serial_number: null, part_number: null }, host: null }, porte: [] });
    assert.deepEqual(p.ignorate.map((x) => x.sezione).sort(), ["neighbors", "poe"]);
  });
});

describe("porte solo per switch e router", () => {
  const conIfaceEFatti = (collector: string) => snap({
    collector,
    interfaces: sez([iface("eth0", { if_index: 2 }), iface("bond0", { kind: "aggregate", if_index: 3 })]),
    spanning_tree: sez({ enabled: true, protocol: "rstp", ports: [{ port: "eth0", instance: "CIST", state: "forwarding", role: "root" }] }),
  });

  it("switch e router ricevono porte e fatti di porta", () => {
    for (const c of ["hp-procurve", "hp-comware", "qnap-switch", "mikrotik-routeros"]) {
      const s = conIfaceEFatti(c);
      assert.equal(proiettaPorte(s, []).aggiungi.length, 2, c);
      assert.notEqual(proiettaFatti(s), null, c);
      assert.ok(campiDelCollectorPerPorta(s).size > 0, c);
    }
  });

  it("NAS, server, hypervisor, access point, controller e storage non ricevono porte «da switch» nemmeno con interfacce ok", () => {
    for (const c of ["qnap-nas", "synology-dsm", "linux", "windows", "proxmox-ve", "ubiquiti-device", "unifi-controller", "vmware-esxi", "netapp-ontap"]) {
      const s = conIfaceEFatti(c);
      const p = proietta(s, { identita: { apparato: { sysname: null, model: null, firmware: null, serial_number: null, part_number: null }, host: null }, porte: [porta(1, "eth0")] });
      assert.deepEqual(p.porte, { aggiorna: [], aggiungi: [], togli: [] }, `${c}: le porte che ci sono già non si toccano e non se ne aggiungono`);
      assert.equal(p.fatti, null, c);
      assert.equal(campiDelCollectorPerPorta(s).size, 0, `${c}: i giri pianificati non lasciano da parte colonne che nessuno scrive`);
    }
  });

  it("un id di collector sconosciuto non scrive porte", () => {
    assert.equal(ricevePorteDaSwitch("collector-tolto"), false);
  });
});
