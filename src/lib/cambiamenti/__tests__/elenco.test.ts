import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { contaDaVedere, leggiCambiamenti, segnaVisti } from "../elenco";

const ADESSO = Date.UTC(2026, 10, 14, 12, 0, 0);

function banco() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE networks (id INTEGER PRIMARY KEY, name TEXT, cidr TEXT);
    CREATE TABLE hosts (id INTEGER PRIMARY KEY, network_id INTEGER, ip TEXT, mac TEXT, hostname TEXT, custom_name TEXT,
      vendor TEXT, first_seen TEXT);
    CREATE TABLE network_devices (id INTEGER PRIMARY KEY, name TEXT, host TEXT, device_type TEXT, vendor TEXT,
      host_id INTEGER, created_at TEXT);
    CREATE TABLE mac_ip_history (id INTEGER PRIMARY KEY, mac_normalized TEXT, ip TEXT, source TEXT, changed_at TEXT);
    CREATE TABLE dhcp_leases (id INTEGER PRIMARY KEY, mac_address TEXT, dynamic_lease INTEGER);
    CREATE TABLE mac_port_entries (id INTEGER PRIMARY KEY, device_id INTEGER, mac TEXT, port_name TEXT,
      first_seen TEXT, timestamp TEXT);
    CREATE TABLE switch_ports (id INTEGER PRIMARY KEY, device_id INTEGER, port_name TEXT, is_trunk INTEGER, is_uplink INTEGER);
    CREATE TABLE anomaly_events (id INTEGER PRIMARY KEY, host_id INTEGER, network_id INTEGER, anomaly_type TEXT,
      description TEXT, detail_json TEXT, acknowledged INTEGER DEFAULT 0, acknowledged_at TEXT, acknowledged_by TEXT,
      detected_at TEXT);
    INSERT INTO networks VALUES (1, 'Uffici', '10.0.0.0/24');
    -- un host nuovo (data con la T, come la scrive una parte del codice) e uno vecchio
    INSERT INTO hosts VALUES (1, 1, '10.0.0.5', 'AA:BB:CC:00:00:01', 'pc-nuovo', NULL, 'Dell', '2026-11-13T09:00:00');
    INSERT INTO hosts VALUES (2, 1, '10.0.0.6', 'AA:BB:CC:00:00:02', 'nas', NULL, NULL, '2026-01-01 09:00:00');
    INSERT INTO hosts VALUES (3, 1, '10.0.0.7', 'AA:BB:CC:00:00:03', 'portatile', NULL, NULL, '2026-01-01 09:00:00');
    INSERT INTO network_devices VALUES (1, 'SW-1', '10.0.0.2', 'switch', 'hp', NULL, '2026-11-12 06:30:00');
    INSERT INTO network_devices VALUES (2, 'SW-2', '10.0.0.3', 'switch', 'hp', NULL, '2026-01-01 06:30:00');
    -- il NAS passa da .20 a .6: un cambio vero
    INSERT INTO mac_ip_history VALUES (1, 'aabbcc000002', '10.0.0.20', 'arp', '2026-10-01 10:00:00');
    INSERT INTO mac_ip_history VALUES (2, 'aabbcc000002', '10.0.0.6', 'arp', '2026-11-13 10:00:00');
    -- il portatile è in DHCP: rumore
    INSERT INTO mac_ip_history VALUES (3, 'aabbcc000003', '10.0.0.50', 'arp', '2026-10-01 10:00:00');
    INSERT INTO mac_ip_history VALUES (4, 'aabbcc000003', '10.0.0.7', 'arp', '2026-11-13 11:00:00');
    INSERT INTO dhcp_leases VALUES (1, 'AA:BB:CC:00:00:03', 1);
    -- il NAS cambia presa; il portatile compare su una dorsale
    INSERT INTO mac_port_entries VALUES (1, 2, 'AA:BB:CC:00:00:02', '12', '2026-09-01 10:00:00', NULL);
    INSERT INTO mac_port_entries VALUES (2, 1, 'AA:BB:CC:00:00:02', '7', '2026-11-13 12:00:00', NULL);
    INSERT INTO mac_port_entries VALUES (3, 2, 'AA:BB:CC:00:00:03', '3', '2026-09-01 10:00:00', NULL);
    INSERT INTO mac_port_entries VALUES (4, 1, 'AA:BB:CC:00:00:03', '24', '2026-11-13 12:00:00', NULL);
    INSERT INTO switch_ports VALUES (1, 1, '24', 0, 1);
    INSERT INTO anomaly_events VALUES (1, 2, 1, 'mac_flip', 'MAC cambiato', '{"ip":"10.0.0.6","old_mac":"AA:BB:CC:00:00:09","new_mac":"AA:BB:CC:00:00:02"}', 0, NULL, NULL, '2026-11-13 13:00:00');
    INSERT INTO anomaly_events VALUES (2, 2, 1, 'uptime_anomaly', 'giù', NULL, 0, NULL, NULL, '2026-11-13 13:00:00');
  `);
  return db;
}

test("un elenco solo, con il rumore marcato e non buttato", () => {
  const db = banco();
  const tutti = leggiCambiamenti(db, { giorni: 7, adesso: ADESSO });
  const di = (tipo: string) => tutti.filter((c) => c.tipo === tipo);
  assert.deepEqual(di("oggetto_nuovo").map((c) => c.oggetto), ["pc-nuovo"]);
  assert.deepEqual(di("apparato_nuovo").map((c) => c.oggetto), ["SW-1"]);
  assert.equal(di("mac_cambiato").length, 1);
  // disponibilità e latenza restano fuori
  assert.equal(tutti.some((c) => c.chiave === "anomalia:2"), false);

  const ip = di("cambio_ip");
  assert.equal(ip.length, 2);
  const nas = ip.find((c) => c.oggetto === "nas")!;
  assert.deepEqual([nas.prima, nas.dopo, nas.rumore], ["10.0.0.20", "10.0.0.6", null]);
  assert.equal(ip.find((c) => c.oggetto === "portatile")!.rumore, "indirizzo dato dal DHCP");

  const porte = di("spostamento_porta");
  const nasPorta = porte.find((c) => c.oggetto === "nas")!;
  assert.deepEqual([nasPorta.prima, nasPorta.dopo, nasPorta.rumore], ["SW-2 · 12", "SW-1 · 7", null]);
  assert.equal(porte.find((c) => c.oggetto === "portatile")!.rumore, "porta di collegamento fra apparati");
});

test("«Visto» toglie dal conto e chiude l'anomalia", () => {
  const db = banco();
  assert.equal(contaDaVedere(db, 7, ADESSO), 5);
  segnaVisti(db, ["host:1", "anomalia:1", "robaccia"], "rg");
  assert.equal(contaDaVedere(db, 7, ADESSO), 3);
  assert.equal((db.prepare("SELECT acknowledged FROM anomaly_events WHERE id = 1").get() as { acknowledged: number }).acknowledged, 1);
  const visto = leggiCambiamenti(db, { giorni: 7, adesso: ADESSO }).find((c) => c.chiave === "host:1")!;
  assert.equal(visto.visto?.da, "rg");
});
