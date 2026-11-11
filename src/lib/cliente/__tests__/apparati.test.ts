/**
 * Scheda Apparati: il tipo di ogni foglia, le porte lette, un apparato fisico contato una volta.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/apparati.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  apparatiDelTipo,
  conteggiPerTipo,
  foglieTassonomia,
  fraseApparatoSpento,
  nomiDaSegnalare,
  porteDelloSwitch,
  quantoSpento,
  schedaApparati,
  tipoCliente,
  TIPI_CLIENTE,
} from "../schede/apparati";
import { SCHEDE_CLIENTE } from "../registro";

const ATTESI: Record<string, string> = {
  compute: "server",
  storage: "server",
  network: "rete",
  peripheral: "stampanti",
  voip: "telefoni",
  mobile: "mobili",
  av: "altro",
  iot: "altro",
  ot: "altro",
  power: "altro",
};

function dbDiProva(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE hosts (
      id INTEGER PRIMARY KEY,
      ip TEXT,
      status TEXT,
      custom_name TEXT,
      hostname TEXT,
      last_seen TEXT,
      attr_category TEXT,
      attr_vendor_name TEXT,
      attr_os_name TEXT,
      device_manufacturer TEXT,
      vendor TEXT,
      os_info TEXT,
      physical_device_id INTEGER
    );
    CREATE TABLE network_devices (
      id INTEGER PRIMARY KEY,
      name TEXT,
      host TEXT,
      device_type TEXT
    );
    CREATE TABLE switch_ports (
      id INTEGER PRIMARY KEY,
      device_id INTEGER,
      port_index INTEGER,
      port_name TEXT,
      status TEXT,
      speed TEXT,
      vlan INTEGER,
      is_trunk INTEGER,
      is_uplink INTEGER,
      host_id INTEGER,
      single_mac_hostname TEXT,
      single_mac_ip TEXT,
      trunk_neighbor_name TEXT,
      trunk_primary_name TEXT
    );
  `);
  return db;
}

test("tipoCliente copre ogni foglia della tassonomia", () => {
  const foglie = foglieTassonomia();
  assert.ok(foglie.length > 0);
  for (const foglia of foglie) {
    const tipo = tipoCliente(foglia);
    if (foglia === "compute.workstation" || foglia === "compute.laptop") {
      assert.equal(tipo, "computer", foglia);
      continue;
    }
    if (foglia === "compute.vm") {
      assert.equal(tipo, "virtuali", foglia);
      continue;
    }
    const radice = foglia.split(".")[0] ?? "";
    assert.equal(tipo, ATTESI[radice], foglia);
  }
  assert.equal(tipoCliente(null), "non_riconosciuti");
  assert.equal(tipoCliente("sconosciuta"), "non_riconosciuti");
  assert.equal(TIPI_CLIENTE.map((t) => t.tipo).join(","), "computer,server,virtuali,rete,stampanti,telefoni,mobili,altro,non_riconosciuti");
  assert.equal(schedaApparati.id, "apparati");
  assert.equal(schedaApparati.ordine, 20);
  assert.equal(SCHEDE_CLIENTE.some((s) => s.id === "apparati"), true);
});

test("due host dello stesso apparato contano una volta, e si tiene l'IP più basso", () => {
  const db = dbDiProva();
  const host = db.prepare(
    `INSERT INTO hosts (id, ip, status, custom_name, hostname, attr_category, physical_device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  host.run(1, "10.0.0.20", "online", "Alto", null, "compute.server", 7);
  host.run(2, "10.0.0.5", "offline", null, "basso", "compute.server", 7);
  host.run(3, "10.0.0.8", "online", "PC", null, "compute.workstation", null);
  host.run(4, "10.0.0.9", "online", null, null, null, null);

  const conteggi = conteggiPerTipo(db);
  assert.equal(conteggi.server, 1);
  assert.equal(conteggi.computer, 1);
  assert.equal(conteggi.non_riconosciuti, 1);

  const server = apparatiDelTipo(db, "server");
  assert.equal(server.length, 1);
  assert.equal(server[0]?.ip, "10.0.0.5");
  assert.equal(server[0]?.nome, "basso");
  assert.equal(server[0]?.acceso, false);

  const computer = apparatiDelTipo(db, "computer");
  assert.equal(computer[0]?.nome, "PC");
  assert.equal(computer[0]?.cosa, "Computer fisso");
  db.close();
});

test("l'elenco mette prima gli accesi, poi gli spenti, poi gli assenti", () => {
  const db = dbDiProva();
  const host = db.prepare(
    "INSERT INTO hosts (id, ip, status, custom_name, attr_category, last_seen) VALUES (?, ?, ?, ?, 'compute.workstation', ?)",
  );
  host.run(1, "10.0.0.3", "online", "Acceso", null);
  host.run(2, "10.0.0.2", "offline", "Spento", "ignored");
  db.prepare("UPDATE hosts SET last_seen = datetime('now', '-1 day') WHERE id = 2").run();
  host.run(3, "10.0.0.4", "offline", "Vecchio", null);
  db.prepare("UPDATE hosts SET last_seen = datetime('now', '-10 days') WHERE id = 3").run();
  host.run(4, "10.0.0.1", "offline", "Senza data", null);

  const righe = apparatiDelTipo(db, "computer");
  assert.deepEqual(righe.map((r) => r.nome), ["Acceso", "Spento", "Senza data", "Vecchio"]);
  assert.deepEqual(righe.map((r) => r.assente), [false, false, true, true]);
  db.close();
});

test("la notizia è una rete o un server spento da più di un giorno e da meno di sette", () => {
  const db = dbDiProva();
  const host = db.prepare(
    "INSERT INTO hosts (id, ip, status, custom_name, attr_category) VALUES (?, ?, 'offline', ?, ?)",
  );
  host.run(1, "10.0.0.1", "Recente", "network.switch");
  host.run(2, "10.0.0.2", "Mesi", "compute.server");
  host.run(3, "10.0.0.3", "Senza data", "network.router");
  host.run(4, "10.0.0.4", "Stampante", "peripheral.printer");
  host.run(5, "10.0.0.5", "Fresco", "compute.server");
  host.run(6, "10.0.0.6", "PC", "compute.workstation");
  db.prepare("UPDATE hosts SET last_seen = datetime('now', '-2 days') WHERE id IN (1, 4, 6)").run();
  db.prepare("UPDATE hosts SET last_seen = datetime('now', '-10 days') WHERE id = 2").run();
  db.prepare("UPDATE hosts SET last_seen = datetime('now', '-2 hours') WHERE id = 5").run();

  assert.deepEqual(nomiDaSegnalare(db), ["Recente"]);
  db.close();
});

test("porteDelloSwitch: senza righe è null; con righe tiene le fisiche, ordinate", () => {
  const db = dbDiProva();
  db.prepare("INSERT INTO hosts (id, ip, custom_name) VALUES (9, '10.1.1.9', 'Stampante')").run();
  db.prepare("INSERT INTO network_devices (id, name, host, device_type) VALUES (1, 'SW', '10.0.0.2', 'switch')").run();
  assert.equal(porteDelloSwitch(db, "10.0.0.2"), null);
  assert.equal(porteDelloSwitch(db, "10.9.9.9"), null);

  const porta = db.prepare(
    `INSERT INTO switch_ports (
      id, device_id, port_index, port_name, status, speed, vlan, is_trunk, is_uplink, host_id,
      single_mac_hostname, single_mac_ip, trunk_neighbor_name, trunk_primary_name
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  porta.run(1, 5, "Gi1/0/5", "up", "1000 Mbps", 10, 0, 0, 9, null, null, null, null);
  porta.run(2, 1, "Gi1/0/1", "down", null, null, 0, 0, null, "Telefono", "10.1.1.8", null, null);
  porta.run(3, 24, "Trk1", "up", "10 Gbps", 1, 1, 0, null, null, null, "Core", "Vecchio");
  porta.run(4, 99, "Vlan10", "up", null, 10, 0, 0, null, null, null, null, null);
  porta.run(5, 8, "Gi1/0/8", "up", null, null, 0, 1, null, null, null, "Piano 2", null);

  const porte = porteDelloSwitch(db, "10.0.0.2");
  assert.ok(porte);
  assert.deepEqual(porte.map((p) => p.numero), [1, 5, 8, 24]);
  assert.equal(porte.find((p) => p.numero === 5)?.stato, "collegata");
  assert.equal(porte.find((p) => p.numero === 5)?.velocita, "1G");
  assert.deepEqual(porte.find((p) => p.numero === 5)?.attaccato, { nome: "Stampante", ip: "10.1.1.9" });
  assert.equal(porte.find((p) => p.numero === 1)?.stato, "libera");
  assert.deepEqual(porte.find((p) => p.numero === 1)?.attaccato, { nome: "Telefono", ip: "10.1.1.8" });
  const dorsale = porte.find((p) => p.numero === 24);
  assert.equal(dorsale?.dorsale, true);
  assert.equal(dorsale?.attaccato, null);
  assert.equal(dorsale?.verso, "Core");
  assert.equal(porte.find((p) => p.numero === 8)?.verso, "Piano 2");
  assert.equal(porte.find((p) => p.numero === 8)?.dorsale, true);
  db.close();
});

test("quantoSpento: sotto le 48 ore è «da ieri», poi i giorni interi", () => {
  const adesso = new Date("2026-11-11T12:00:00.000Z");
  assert.equal(quantoSpento("2026-11-10 12:00:00", adesso), "da ieri");
  assert.equal(quantoSpento("2026-11-09 12:00:01", adesso), "da ieri");
  assert.equal(quantoSpento("2026-11-09 12:00:00", adesso), "da 2 giorni");
  assert.equal(quantoSpento("2026-11-08 12:00:00", adesso), "da 3 giorni");
});

test("un NAS con porte non apre il pannello", () => {
  const db = dbDiProva();
  db.prepare("INSERT INTO network_devices (id, name, host, device_type) VALUES (1, 'DA-FILES', '10.0.0.9', 'nas')").run();
  db.prepare(
    "INSERT INTO switch_ports (id, device_id, port_index, port_name, status) VALUES (1, 1, 1, 'Gi1/0/1', 'up')",
  ).run();
  assert.equal(porteDelloSwitch(db, "10.0.0.9"), null);

  db.prepare("INSERT INTO network_devices (id, name, host, device_type) VALUES (2, 'RTR', '10.0.0.1', 'router')").run();
  db.prepare(
    "INSERT INTO switch_ports (id, device_id, port_index, port_name, status) VALUES (2, 2, 1, 'Gi0/1', 'up')",
  ).run();
  const porte = porteDelloSwitch(db, "10.0.0.1");
  assert.equal(porte?.length, 1);
  db.close();
});

test("fraseApparatoSpento: la categoria precede l'indirizzo quando manca il nome", () => {
  const adesso = new Date("2026-11-11T12:00:00.000Z");
  const visto = "2026-11-06T12:00:00.000Z";
  assert.equal(
    fraseApparatoSpento("192.168.40.167", "192.168.40.167", "router", visto, adesso),
    "Router 192.168.40.167 spento da 5 giorni",
  );
  assert.equal(
    fraseApparatoSpento("SW-PIANO1", "192.168.40.1", "switch", visto, adesso),
    "SW-PIANO1 spento da 5 giorni",
  );
  assert.equal(
    fraseApparatoSpento("10.0.0.8", "10.0.0.8", null, visto, adesso),
    "10.0.0.8 spento da 5 giorni",
  );
});
