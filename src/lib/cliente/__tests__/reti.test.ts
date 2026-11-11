/**
 * Scheda Reti della vista cliente: reti, quadretti, scheda dell'apparato.
 * Il database è in memoria, con le sole colonne che la scheda legge.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/reti.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { nomeCategoria } from "../categorie";
import { nomeDellaPorta } from "../porte-note";
import { SCHEDE_CLIENTE } from "../registro";
import { apparatoCliente, indirizziDellaRete, retiCliente, schedaReti } from "../schede/reti";

function dbDiProva(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE networks (
      id INTEGER PRIMARY KEY,
      cidr TEXT,
      name TEXT,
      vlan_id INTEGER
    );
    CREATE TABLE hosts (
      id INTEGER PRIMARY KEY,
      network_id INTEGER,
      ip TEXT,
      status TEXT,
      custom_name TEXT,
      hostname TEXT,
      last_seen TEXT,
      open_ports TEXT,
      attr_category TEXT,
      attr_vendor_name TEXT,
      attr_os_name TEXT,
      device_manufacturer TEXT,
      vendor TEXT,
      os_info TEXT
    );
    CREATE TABLE network_devices (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE switch_ports (
      id INTEGER PRIMARY KEY,
      host_id INTEGER,
      device_id INTEGER,
      port_name TEXT,
      vlan INTEGER,
      speed TEXT,
      is_trunk INTEGER
    );
  `);
  return db;
}

test("nomeCategoria e nomeDellaPorta", () => {
  assert.equal(nomeCategoria(null), null);
  assert.equal(nomeCategoria("network"), null);
  assert.equal(nomeCategoria("sconosciuta"), null);
  assert.equal(nomeCategoria("compute.server"), "server");
  assert.equal(nomeCategoria("network.access_point"), "punto Wi-Fi");
  assert.equal(nomeCategoria("mobile.wearable"), null);
  assert.equal(nomeCategoria("iot.sensor"), "dispositivo");
  assert.equal(nomeCategoria("ot.plc"), "dispositivo");
  assert.equal(nomeDellaPorta(22), "accesso remoto");
  assert.equal(nomeDellaPorta(23), "accesso remoto non protetto");
  assert.equal(nomeDellaPorta(3389), "desktop remoto");
  assert.equal(nomeDellaPorta(1), null);
});

test("due reti, un acceso, uno spento, uno senza switch, porte illeggibili, una /16", () => {
  const db = dbDiProva();
  const rete = db.prepare("INSERT INTO networks (id, cidr, name, vlan_id) VALUES (?, ?, ?, ?)");
  rete.run(1, "10.1.1.0/30", "Ufficio", 10);
  rete.run(2, "10.2.0.0/16", "Grande", null);
  rete.run(3, "192.0.2.9/32", "Punto", null);

  const host = db.prepare(
    `INSERT INTO hosts (id, network_id, ip, status, custom_name, hostname, last_seen, open_ports, attr_category, attr_vendor_name, attr_os_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const porte = [];
  for (let n = 100; n <= 111; n++) porte.push({ port: n });
  porte.push({ port: 22 }, { port: 22 }, { port: 80 }, { port: "no" });
  host.run(
    1, 1, "10.1.1.1", "online", "Server", "srv", "2026-11-01 10:00:00",
    JSON.stringify(porte), "compute.server", "Dell", "Windows",
  );
  host.run(2, 1, "10.1.1.2", "offline", null, "Pc-spento", null, "{", null, null, null);
  host.run(3, 2, "10.2.1.5", "online", null, null, null, null, null, null, null);

  db.prepare("INSERT INTO network_devices (id, name) VALUES (1, 'SW-Piano')").run();
  const porta = db.prepare(
    "INSERT INTO switch_ports (id, host_id, device_id, port_name, vlan, speed, is_trunk) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  porta.run(1, 1, 1, "Gi1/0/5", 10, "1000 Mbps", 0);
  porta.run(2, 1, 1, "Trk1", 10, "10 Gbps", 1);

  const reti = retiCliente(db);
  assert.deepEqual(reti.map((r) => r.nome), ["Grande", "Punto", "Ufficio"]);
  const ufficio = reti.find((r) => r.nome === "Ufficio");
  const grande = reti.find((r) => r.nome === "Grande");
  const punto = reti.find((r) => r.nome === "Punto");
  assert.ok(ufficio && grande && punto);
  assert.equal(ufficio.vlan, 10);
  assert.equal(ufficio.inUso, 1);
  assert.equal(ufficio.totale, 2);
  assert.equal(grande.vlan, null);
  assert.equal(grande.inUso, 1);
  assert.equal(grande.totale, 65534);
  assert.equal(punto.totale, 1);
  assert.equal(punto.inUso, 0);

  assert.deepEqual(indirizziDellaRete(db, ufficio.id), [
    { ip: "10.1.1.1", stato: "acceso" },
    { ip: "10.1.1.2", stato: "spento" },
  ]);
  assert.deepEqual(indirizziDellaRete(db, grande.id), [
    { ip: "10.2.1.5", stato: "acceso" },
  ]);
  assert.deepEqual(indirizziDellaRete(db, punto.id), [
    { ip: "192.0.2.9", stato: "libero" },
  ]);

  const acceso = apparatoCliente(db, "10.1.1.1");
  assert.ok(acceso);
  assert.equal(acceso.nome, "Server");
  assert.equal(acceso.cosa, "Server · Dell · Windows");
  assert.equal(acceso.acceso, true);
  assert.match(acceso.vistoIl ?? "", /11:00/);
  assert.deepEqual(acceso.collegatoA, { switch: "SW-Piano", porta: "Gi1/0/5", vlan: 10, velocita: "1G" });
  assert.equal(acceso.porteAperte.length, 12);
  assert.deepEqual(acceso.porteAperte[0], { numero: 22, nome: "accesso remoto" });
  assert.equal(acceso.porteAperte.some((p) => p.numero === 111), false);
  assert.equal(acceso.porteAperte.filter((p) => p.numero === 22).length, 1);

  const spento = apparatoCliente(db, "10.1.1.2");
  assert.ok(spento);
  assert.equal(spento.nome, "Pc-spento");
  assert.equal(spento.cosa, "Non riconosciuto");
  assert.equal(spento.acceso, false);
  assert.equal(spento.vistoIl, null);
  assert.equal(spento.collegatoA, null);
  assert.deepEqual(spento.porteAperte, []);

  const sullaGrande = apparatoCliente(db, "10.2.1.5");
  assert.ok(sullaGrande);
  assert.equal(sullaGrande.nome, "10.2.1.5");
  assert.equal(sullaGrande.collegatoA, null);

  assert.equal(apparatoCliente(db, "10.9.9.9"), null);
  db.close();
});

test("la scheda Reti è nel registro", () => {
  assert.equal(schedaReti.id, "reti");
  assert.equal(schedaReti.titolo, "Reti");
  assert.equal(schedaReti.ordine, 10);
  assert.equal(schedaReti.icona, "Network");
  assert.equal(SCHEDE_CLIENTE.some((s) => s.id === "reti"), true);
});
