// Sync del controller UniFi nel DB del tenant (tappa 2, Task 4), provata sulla
// risposta vera di stat/device (fixture anonimizzata del controller di DTS:
// SW-1, SW-11, AP-3, SW-2) con un tenant temporaneo e una sorgente finta al
// posto del controller. Niente rete.
//
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta
// lì). I tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di
// prova, come tutto npm test.
import { removeTestHubDb } from "./support/hub-isolato";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { UnifiApiError } from "../unifi-api";
import { parseStatDeviceResponse, parseUnifiDevice, type UnifiDevice } from "../unifi-device";
import {
  syncUnifiForTenant,
  unifiSyncFailure,
  type UnifiDeviceSource,
  type UnifiSyncResult,
} from "../unifi-sync";

const T = "TESTUNIFISYNC";
const T_ALTRO = "TESTUNIFISYNCALTRO";

const FIXTURE = path.join(__dirname, "fixtures", "unifi-stat-device.json");
const FIXTURE_DEVICES = parseStatDeviceResponse(JSON.parse(fs.readFileSync(FIXTURE, "utf-8")));

/** Copia fresca della risposta vera, eventualmente ritoccata su un apparato. */
function risposta(ritocco?: { nome: string; con: Partial<UnifiDevice> }): UnifiDevice[] {
  const copia = structuredClone(FIXTURE_DEVICES);
  if (!ritocco) return copia;
  return copia.map((d) => (d.name === ritocco.nome ? { ...d, ...ritocco.con } : d));
}

/**
 * Un apparato della risposta vera reso offline come il controller manda SW-2
 * (state 0, niente lldp_table, porte coi soli campi statici): forma vera.
 */
function offline(nome: string): UnifiDevice {
  const grezzo = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { data: Array<Record<string, unknown>> };
  const sw2 = grezzo.data.find((x) => x.name === "SW-2");
  const raw = grezzo.data.find((x) => x.name === nome);
  assert.ok(sw2 && raw);
  const statici = new Set(Object.keys((sw2.port_table as Array<Record<string, unknown>>)[0]));
  const porte = (raw.port_table as Array<Record<string, unknown>>).map((p) =>
    Object.fromEntries(Object.entries(p).filter(([k]) => statici.has(k))),
  );
  const copia: Record<string, unknown> = { ...raw, state: 0, port_table: porte };
  delete copia.lldp_table;
  const d = parseUnifiDevice(copia);
  assert.ok(d);
  return d;
}

function sorgente(devices: UnifiDevice[]): UnifiDeviceSource & { chiamate: number } {
  const s = {
    chiamate: 0,
    async listDevices() {
      s.chiamate++;
      return devices;
    },
  };
  return s;
}

function sync(devices: UnifiDevice[] = risposta()) {
  return withTenant(T, () => syncUnifiForTenant({ source: sorgente(devices) }));
}

function conta(tenant: string, tabella: string, where = "1=1", ...args: unknown[]): number {
  return (getTenantDb(tenant).prepare(`SELECT COUNT(*) AS n FROM ${tabella} WHERE ${where}`).get(...args) as { n: number }).n;
}

interface NdRow {
  id: number;
  name: string;
  host: string;
  device_type: string;
  vendor: string;
  protocol: string;
  model: string | null;
  serial_number: string | null;
  firmware: string | null;
  enabled: number;
  use_for_arp_poll: number;
  host_id: number | null;
  physical_device_id: number | null;
  classification: string | null;
}

function apparato(nome: string): NdRow {
  const r = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE name = ?").get(nome) as NdRow | undefined;
  assert.ok(r, `network_device ${nome} assente`);
  return r;
}

function inserisciApparato(campi: { name: string; host: string; device_type: string; vendor: string; protocol: string }): number {
  return Number(
    getTenantDb(T)
      .prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES (?, ?, ?, ?, ?)")
      .run(campi.name, campi.host, campi.device_type, campi.vendor, campi.protocol).lastInsertRowid,
  );
}

function inserisciRete(cidr = "10.99.0.0/24"): number {
  return Number(getTenantDb(T).prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(cidr, cidr).lastInsertRowid);
}

function inserisciHost(networkId: number, ip: string, mac: string | null): number {
  return Number(
    getTenantDb(T)
      .prepare("INSERT INTO hosts (network_id, ip, mac, status) VALUES (?, ?, ?, 'online')")
      .run(networkId, ip, mac).lastInsertRowid,
  );
}

beforeEach(() => {
  deleteTenantDatabase(T);
  deleteTenantDatabase(T_ALTRO);
});

after(() => {
  deleteTenantDatabase(T);
  deleteTenantDatabase(T_ALTRO);
  closeHubDb();
  removeTestHubDb();
});

test("prima sync: i 4 apparati diventano network_devices ubiquiti, spenti per gli altri job", async () => {
  const r = await sync();
  assert.deepEqual(r.errors, []);
  assert.equal(r.total, 4);
  assert.equal(r.added, 4);
  assert.equal(r.updated, 0);
  assert.equal(r.skipped, 0);
  assert.equal(conta(T, "network_devices"), 4);

  const sw1 = apparato("SW-1");
  assert.equal(sw1.host, "10.99.0.7");
  assert.equal(sw1.device_type, "switch");
  assert.equal(sw1.classification, "switch");
  assert.equal(sw1.vendor, "ubiquiti");
  assert.equal(sw1.protocol, "api");
  assert.equal(sw1.model, "US8P60");
  assert.equal(sw1.serial_number, "SN000001");
  assert.equal(sw1.firmware, "7.2.123.16565");
  // Nati spenti: DA-IPAM non li interroga direttamente (il poll ARP proverebbe
  // SNMP "public" su ognuno); i dati arrivano dal controller.
  assert.equal(sw1.enabled, 0);
  assert.equal(sw1.use_for_arp_poll, 0);
  assert.equal(apparato("AP-3").device_type, "access_point");
});

test("prima sync: porte e vicini LLDP per apparato, coi nomi risolti nella risposta", async () => {
  const r = await sync();
  const ports = (nome: string) => conta(T, "switch_ports", "device_id = ?", apparato(nome).id);
  const vicini = (nome: string) => conta(T, "device_neighbors", "device_id = ?", apparato(nome).id);
  assert.equal(ports("SW-1"), 8);
  assert.equal(ports("SW-11"), 26);
  assert.equal(ports("SW-2"), 5);
  assert.equal(ports("AP-3"), 0);
  assert.equal(r.portsUpserted, 8 + 26 + 5);
  assert.equal(vicini("SW-1"), 3);
  assert.equal(vicini("AP-3"), 1);
  assert.equal(vicini("SW-2"), 0);
  assert.equal(r.neighborsUpserted, conta(T, "device_neighbors"));

  const db = getTenantDb(T);
  const p6 = db
    .prepare("SELECT remote_device_name, remote_mac, protocol FROM device_neighbors WHERE device_id = ? AND local_port = 'Port 6'")
    .get(apparato("SW-1").id) as { remote_device_name: string; remote_mac: string; protocol: string };
  assert.deepEqual(p6, { remote_device_name: "SW-11", remote_mac: "02:00:00:00:00:04", protocol: "lldp" });
  const ap = db
    .prepare("SELECT remote_device_name, remote_port FROM device_neighbors WHERE device_id = ?")
    .get(apparato("AP-3").id) as { remote_device_name: string; remote_port: string };
  assert.deepEqual(ap, { remote_device_name: "SW-1", remote_port: "Port 7" });
  const porta6 = db
    .prepare("SELECT trunk_neighbor_name, trunk_neighbor_port FROM switch_ports WHERE device_id = ? AND port_index = 6")
    .get(apparato("SW-1").id) as { trunk_neighbor_name: string; trunk_neighbor_port: string };
  assert.deepEqual(porta6, { trunk_neighbor_name: "SW-11", trunk_neighbor_port: "Port 14" });
});

test("seconda sync con la stessa risposta: niente di nuovo, stessi conteggi", async () => {
  await sync();
  const prima = {
    nd: conta(T, "network_devices"),
    porte: conta(T, "switch_ports"),
    vicini: conta(T, "device_neighbors"),
  };
  const r = await sync();
  assert.deepEqual(r.errors, []);
  assert.equal(r.added, 0);
  assert.equal(r.updated, 4);
  assert.deepEqual(
    { nd: conta(T, "network_devices"), porte: conta(T, "switch_ports"), vicini: conta(T, "device_neighbors") },
    prima,
  );
});

test("seconda sync quando l'host della rete ha un MAC diverso dal controller: riconosciuto per seriale", async () => {
  // L'apparato creato si aggancia all'host con lo stesso IP; se la scansione ha
  // visto un altro MAC, i MAC noti non devono farlo passare per un IP conteso.
  const rete = inserisciRete();
  inserisciHost(rete, "10.99.0.7", "AA:AA:AA:AA:AA:03");
  const r1 = await sync();
  assert.deepEqual(r1.errors, []);
  assert.equal(r1.added, 4);
  const r2 = await sync();
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.added, 0);
  assert.equal(r2.updated, 4);
  assert.equal(r2.skipped, 0);
  assert.equal(conta(T, "network_devices", "host = '10.99.0.7'"), 1);
});

test("apparato già censito trovato per seriale con IP e MAC ignoti: aggiornato e spostato", async () => {
  const id = inserisciApparato({ name: "sw cantina", host: "10.99.0.250", device_type: "switch", vendor: "ubiquiti", protocol: "snmp_v2" });
  getTenantDb(T).prepare("UPDATE network_devices SET serial_number = 'sn000004' WHERE id = ?").run(id);
  const r = await sync();
  assert.deepEqual(r.errors, []);
  assert.equal(r.added, 3);
  const row = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NdRow;
  assert.equal(row.host, "10.99.0.26"); // SW-2
  assert.equal(row.model, "USMINI");
});

test("zero sospetto: port_table e lldp_table vuote per SW-1 non cancellano porte e vicini, e lo dice", async () => {
  await sync();
  const id = apparato("SW-1").id;
  assert.equal(conta(T, "switch_ports", "device_id = ?", id), 8);
  assert.equal(conta(T, "device_neighbors", "device_id = ?", id), 3);

  const r = await sync(risposta({ nome: "SW-1", con: { port_table: [], lldp_table: [] } }));
  assert.equal(conta(T, "switch_ports", "device_id = ?", id), 8);
  assert.equal(conta(T, "device_neighbors", "device_id = ?", id), 3);
  const testo = r.errors.join("\n");
  assert.match(testo, /SW-1.*porte/);
  assert.match(testo, /SW-1.*vicini/);
  // Gli altri apparati si aggiornano lo stesso.
  assert.equal(conta(T, "switch_ports", "device_id = ?", apparato("SW-11").id), 26);
});

test("apparato offline: porte e vicini dell'ultima sync restano com'erano, ed è fra gli offline", async () => {
  await sync();
  const id = apparato("SW-1").id;
  const db = getTenantDb(T);
  const istantanea = () => ({
    porte: db
      .prepare(
        `SELECT port_index, port_name, status, speed, poe_status, poe_power_mw, mac_count, is_trunk,
                trunk_neighbor_name, trunk_neighbor_port
           FROM switch_ports WHERE device_id = ? ORDER BY port_index`,
      )
      .all(id),
    vicini: db
      .prepare(
        "SELECT local_port, remote_device_name, remote_port, remote_mac, protocol FROM device_neighbors WHERE device_id = ? ORDER BY local_port",
      )
      .all(id),
  });
  const prima = istantanea();
  assert.equal(prima.porte.length, 8);
  assert.equal(prima.vicini.length, 3);
  // L'ultimo stato buono: uplink verso SW-11 sulla 6, l'AP alimentato sulla 7.
  assert.match(JSON.stringify(prima.porte), /"port_index":6[^}]*"trunk_neighbor_name":"SW-11"/);
  assert.match(JSON.stringify(prima.porte), /"port_index":7[^}]*"poe_status":"delivering"/);

  const r = await sync(risposta().map((d) => (d.name === "SW-1" ? offline("SW-1") : d)));
  assert.deepEqual(istantanea(), prima);
  assert.deepEqual(r.errors, []);
  assert.ok(r.offline.some((x) => x.startsWith("SW-1")), r.offline.join("; "));
  // I fatti dell'apparato si aggiornano lo stesso.
  assert.equal(r.updated, 4);
});

/** Un AP appena adottato, con la forma vera di AP-3 ma un altro seriale e un altro MAC. */
function apNuovo(ip: string): UnifiDevice {
  const ap3 = risposta().find((d) => d.name === "AP-3");
  assert.ok(ap3);
  return { ...ap3, name: "AP-NUOVO", serial: "SN000099", mac: "02:00:00:00:00:99", ip };
}

interface NdChiave {
  name: string;
  host: string;
  serial_number: string | null;
  host_id: number | null;
}

function perId(id: number): NdChiave {
  const r = getTenantDb(T).prepare("SELECT name, host, serial_number, host_id FROM network_devices WHERE id = ?").get(id) as
    | NdChiave
    | undefined;
  assert.ok(r, `network_device ${id} assente`);
  return r;
}

test("un AP nuovo sull'IP lasciato da un apparato censito: non lo sovrascrive, anche se il controller lo elenca prima", async () => {
  await sync();
  const ap3 = apparato("AP-3").id;
  // AP-3 passa a .50 e un AP appena adottato prende .5; il controller elenca prima il nuovo.
  const r = await sync([apNuovo("10.99.0.5"), ...risposta({ nome: "AP-3", con: { ip: "10.99.0.50" } })]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 4);
  assert.deepEqual(
    { ...perId(ap3), host_id: null },
    { name: "AP-3", host: "10.99.0.50", serial_number: "SN000003", host_id: null },
  );
  assert.equal(apparato("AP-NUOVO").serial_number, "SN000099");
  assert.equal(apparato("AP-NUOVO").host, "10.99.0.5");
  assert.equal(conta(T, "network_devices", "name = 'AP-3'"), 1);
  // Il giro dopo ritrova tutti per seriale: niente doppioni.
  const r2 = await sync([apNuovo("10.99.0.5"), ...risposta({ nome: "AP-3", con: { ip: "10.99.0.50" } })]);
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.added, 0);
  assert.equal(conta(T, "network_devices"), 5);
});

test("un apparato con un altro seriale sullo stesso IP (sostituito, non più nel controller): conflitto, il censito resta", async () => {
  await sync();
  const ap3 = apparato("AP-3").id;
  const prima = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(ap3);
  const r = await sync([apNuovo("10.99.0.5"), ...risposta().filter((d) => d.name !== "AP-3")]);
  assert.equal(r.skipped, 1);
  assert.match(r.errors.join("\n"), /AP-NUOVO.*AP-3.*seriale/);
  assert.deepEqual(getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(ap3), prima);
  assert.equal(conta(T, "network_devices"), 4);
});

test("spostamento: host_id segue il nuovo IP, e un AP nuovo sul vecchio IP viene censito", async () => {
  const rete = inserisciRete();
  const h5 = inserisciHost(rete, "10.99.0.5", "02:00:00:00:00:05"); // AP-3
  const h50 = inserisciHost(rete, "10.99.0.50", null);
  await sync();
  const ap3 = apparato("AP-3").id;
  assert.equal(perId(ap3).host_id, h5);
  // AP-3 passa a .50; il poll ARP scrive su .5 il MAC dell'AP nuovo e su .50 quello di AP-3.
  const db = getTenantDb(T);
  db.prepare("UPDATE hosts SET mac = ? WHERE id = ?").run("02:00:00:00:00:99", h5);
  db.prepare("UPDATE hosts SET mac = ? WHERE id = ?").run("02:00:00:00:00:05", h50);
  const giro = () => [...risposta({ nome: "AP-3", con: { ip: "10.99.0.50" } }), apNuovo("10.99.0.5")];

  const r = await sync(giro());
  assert.deepEqual(r.errors, []);
  assert.equal(r.added, 1);
  assert.deepEqual(perId(ap3), { name: "AP-3", host: "10.99.0.50", serial_number: "SN000003", host_id: h50 });
  assert.equal(apparato("AP-NUOVO").host_id, h5);
  const r2 = await sync(giro());
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.added, 0);
  assert.equal(conta(T, "network_devices"), 5);
});

test("i vicini MNDP e le porte di un altro apparato restano intatti", async () => {
  const mt = inserisciApparato({ name: "MT-1", host: "10.99.0.1", device_type: "router", vendor: "mikrotik", protocol: "ssh" });
  const db = getTenantDb(T);
  db.prepare(
    "INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac) VALUES (?, ?, ?, ?, 'mndp', ?)",
  ).run(mt, "ether2", "SW-1", "Port 1", "02:00:00:00:00:08");
  db.prepare(
    "INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol) VALUES (?, ?, ?, ?, 'mndp')",
  ).run(mt, "ether3", "MT-2", "ether1");
  db.prepare("INSERT INTO switch_ports (device_id, port_index, port_name, status) VALUES (?, 1, 'ether1', 'up')").run(mt);
  const istantanea = () => ({
    vicini: db.prepare("SELECT * FROM device_neighbors WHERE device_id = ? ORDER BY id").all(mt),
    porte: db.prepare("SELECT * FROM switch_ports WHERE device_id = ? ORDER BY id").all(mt),
    apparato: db.prepare("SELECT * FROM network_devices WHERE id = ?").get(mt),
  });
  const prima = istantanea();

  const r = await sync();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(istantanea(), prima);
});

test("apparato già censito con lo stesso IP: aggiornato, non duplicato; il nome scelto resta", async () => {
  const id = inserisciApparato({ name: "Switch ufficio", host: "10.99.0.7", device_type: "switch", vendor: "other", protocol: "snmp_v2" });
  const r = await sync();
  assert.deepEqual(r.errors, []);
  assert.equal(r.added, 3);
  assert.equal(r.updated, 1);
  assert.equal(conta(T, "network_devices", "host = '10.99.0.7'"), 1);
  const row = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NdRow;
  assert.equal(row.name, "Switch ufficio");
  assert.equal(row.vendor, "ubiquiti");
  assert.equal(row.protocol, "snmp_v2"); // come lo interroga DA-IPAM non si tocca
  assert.equal(row.enabled, 1); // né se lo interroga
  assert.equal(row.model, "US8P60");
  assert.equal(row.serial_number, "SN000001");
  assert.equal(conta(T, "switch_ports", "device_id = ?", id), 8);
});

test("apparato già censito trovato per MAC con un IP vecchio: aggiornato e spostato all'IP del controller", async () => {
  const rete = inserisciRete();
  inserisciHost(rete, "10.99.0.40", "02:00:00:00:00:04"); // il MAC di SW-11, IP di prima
  const id = inserisciApparato({ name: "switch piano 1", host: "10.99.0.40", device_type: "switch", vendor: "windows", protocol: "winrm" });
  const r = await sync();
  assert.deepEqual(r.errors, []);
  assert.equal(r.added, 3);
  assert.equal(r.updated, 1);
  const row = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NdRow;
  assert.equal(row.host, "10.99.0.4");
  assert.equal(row.vendor, "ubiquiti");
  assert.equal(row.model, "USL24P");
  assert.equal(conta(T, "network_devices", "host = '10.99.0.4'"), 1);
});

test("IP già di un altro apparato con un altro MAC: non lo sovrascrive, lo segnala", async () => {
  const rete = inserisciRete();
  inserisciHost(rete, "10.99.0.26", "AA:AA:AA:AA:AA:01"); // SW-2 ha 02:00:00:00:00:29
  const mt = inserisciApparato({ name: "MT-9", host: "10.99.0.26", device_type: "router", vendor: "mikrotik", protocol: "ssh" });
  const prima = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(mt);

  const r = await sync();
  assert.equal(r.added, 3);
  assert.equal(r.updated, 0);
  assert.equal(r.skipped, 1);
  assert.match(r.errors.join("\n"), /SW-2.*MT-9/);
  assert.deepEqual(getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(mt), prima);
  assert.equal(conta(T, "switch_ports", "device_id = ?", mt), 0);
});

test("IP di un apparato «other» che nel DB ha un altro MAC: anche lui non si sovrascrive", async () => {
  const rete = inserisciRete();
  inserisciHost(rete, "10.99.0.26", "AA:AA:AA:AA:AA:02");
  const altro = inserisciApparato({ name: "Stampante?", host: "10.99.0.26", device_type: "server", vendor: "other", protocol: "snmp_v2" });
  const prima = getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(altro);

  const r = await sync();
  assert.equal(r.skipped, 1);
  assert.match(r.errors.join("\n"), /SW-2.*Stampante\?.*altro MAC/);
  assert.deepEqual(getTenantDb(T).prepare("SELECT * FROM network_devices WHERE id = ?").get(altro), prima);
});

test("l'host UniFi già presente nella rete resta uno: il network_device si aggancia a lui", async () => {
  const rete = inserisciRete();
  const host = inserisciHost(rete, "10.99.0.5", "02:00:00:00:00:05"); // AP-3, già visto dalla scansione
  await sync();
  assert.equal(apparato("AP-3").host_id, host);
  assert.equal(conta(T, "hosts"), 1);
});

test("identità fisica: si collega se esiste già, non se ne crea nessuna", async () => {
  // A DTS physical_devices è vuota: la sync non deve riempirla di record fittizi.
  await sync();
  assert.equal(conta(T, "physical_devices"), 0);
  assert.equal(apparato("SW-1").physical_device_id, null);

  deleteTenantDatabase(T);
  const pd = Number(
    getTenantDb(T)
      .prepare("INSERT INTO physical_devices (vendor, serial_number, identity_confidence, identity_anchor) VALUES ('ubiquiti', 'SN000001', 100, 'serial_number')")
      .run().lastInsertRowid,
  );
  const pdMac = Number(
    getTenantDb(T)
      .prepare("INSERT INTO physical_devices (vendor, primary_mac, identity_confidence, identity_anchor) VALUES ('ubiquiti', '02:00:00:00:00:05', 80, 'primary_mac')")
      .run().lastInsertRowid,
  );
  await sync();
  assert.equal(apparato("SW-1").physical_device_id, pd);
  assert.equal(apparato("AP-3").physical_device_id, pdMac);
  assert.equal(apparato("SW-11").physical_device_id, null);
  assert.equal(conta(T, "physical_devices"), 2);
});

test("tipo ignoto o apparato senza IP: scartati col motivo, gli altri passano", async () => {
  const devices = risposta();
  devices.push({ ...structuredClone(devices[0]), name: "TELEFONO", type: "uph", mac: "02:00:00:00:00:99", ip: "10.99.0.99" });
  devices.push({ ...structuredClone(devices[0]), name: "SENZA-IP", mac: "02:00:00:00:00:98", ip: null });
  const r = await sync(devices);
  assert.equal(r.total, 6);
  assert.equal(r.added, 4);
  assert.equal(r.skipped, 2);
  assert.equal(r.skippedReasons.length, 2);
  assert.match(r.skippedReasons.join("\n"), /TELEFONO/);
  assert.match(r.skippedReasons.join("\n"), /SENZA-IP/);
  assert.deepEqual(r.errors, []);
});

test("errore del controller: nessuna scrittura, l'errore è nel risultato e la sync non lancia", async () => {
  const r = await withTenant(T, () =>
    syncUnifiForTenant({
      source: {
        async listDevices() {
          throw new UnifiApiError("auth", "Credenziali del controller rifiutate");
        },
      },
    }),
  );
  assert.match(r.errors.join("\n"), /Credenziali del controller rifiutate/);
  assert.equal(r.added, 0);
  assert.equal(conta(T, "network_devices"), 0);
});

test("controller che non restituisce nessun apparato: niente da scrivere, lo dice", async () => {
  await sync();
  const r = await sync([]);
  assert.equal(r.total, 0);
  assert.match(r.errors.join("\n"), /nessun apparato/i);
  assert.equal(conta(T, "network_devices"), 4);
  assert.equal(conta(T, "switch_ports"), 39);
});

test("senza controller indicato non si legge niente e non si scrive niente (la configurazione unica dell'hub non si usa più)", async () => {
  const r = await withTenant(T, () => syncUnifiForTenant());
  assert.match(r.errors.join("\n"), /Nessun controller indicato/);
  assert.equal(r.total, 0);
  assert.equal(conta(T, "network_devices"), 0);
});

test("fuori dal contesto tenant: non legge il controller e non scrive da nessuna parte", async () => {
  const s = sorgente(risposta());
  const r = await syncUnifiForTenant({ source: s });
  assert.equal(s.chiamate, 0);
  assert.match(r.errors.join("\n"), /contesto tenant/);
  assert.equal(r.added, 0);
  assert.equal(conta(T, "network_devices"), 0);
});

test("scrive solo nel tenant del contesto", async () => {
  await sync();
  assert.equal(conta(T, "network_devices"), 4);
  assert.equal(conta(T_ALTRO, "network_devices"), 0);
  assert.equal(conta(T_ALTRO, "switch_ports"), 0);
  assert.equal(conta(T_ALTRO, "device_neighbors"), 0);
});

// ── Esito del giro: lo leggono la rotta manuale (`ok`) e il job (fallito o no) ─

function esito(campi: Partial<UnifiSyncResult> = {}): UnifiSyncResult {
  return {
    tenantCode: T,
    total: 4,
    added: 0,
    updated: 4,
    skipped: 0,
    skippedReasons: [],
    portsUpserted: 39,
    neighborsUpserted: 7,
    errors: [],
    offline: [],
    ...campi,
  };
}

test("esito: un giro senza errori è riuscito", () => {
  assert.equal(unifiSyncFailure(esito()), null);
});

test("esito: avvisi su qualche apparato, con gli altri scritti, non fanno fallire il giro", () => {
  const r = esito({ added: 3, updated: 0, skipped: 1, errors: ["SW-2 (10.99.0.26): IP conteso con «MT-9»"] });
  assert.equal(unifiSyncFailure(r), null);
});

test("esito: apparati tutti scartati per tipo ignoto o senza IP non è un fallimento", () => {
  const r = esito({ total: 2, updated: 0, skipped: 2, skippedReasons: ["TELEFONO: tipo ignoto", "SENZA-IP: senza IP"] });
  assert.equal(unifiSyncFailure(r), null);
});

test("esito: niente letto è un fallimento, col motivo", () => {
  const r = esito({ total: 0, updated: 0, portsUpserted: 0, neighborsUpserted: 0, errors: ["Controller UniFi: Credenziali rifiutate"] });
  assert.match(unifiSyncFailure(r) ?? "", /Credenziali rifiutate/);
});

test("esito: apparati letti ma nessuno scritto per errore è un fallimento, senza nomi e IP degli apparati", () => {
  const r = esito({
    total: 2,
    updated: 0,
    skipped: 2,
    portsUpserted: 0,
    neighborsUpserted: 0,
    errors: ["SW-1 (10.99.0.7): scrittura annullata", "SW-2 (10.99.0.26): IP conteso"],
  });
  const motivo = unifiSyncFailure(r) ?? "";
  assert.match(motivo, /nessuno dei 2 apparati.*2 errori/);
  // Il motivo finisce nel log dello scheduler: niente nomi né IP degli apparati.
  assert.doesNotMatch(motivo, /SW-1|SW-2|10\.99\./);
});

test("esito sulla sync vera: controller in errore e nessun controller falliscono, il giro buono no", async () => {
  const buono = await sync();
  assert.equal(unifiSyncFailure(buono), null);

  const guasto = await withTenant(T, () =>
    syncUnifiForTenant({
      source: {
        async listDevices() {
          throw new UnifiApiError("network", "Controller non raggiungibile");
        },
      },
    }),
  );
  assert.match(unifiSyncFailure(guasto) ?? "", /non raggiungibile/);

  const senza = await withTenant(T, () => syncUnifiForTenant());
  assert.match(unifiSyncFailure(senza) ?? "", /Nessun controller/);
});

// Le prove del test di connessione stanno con i controller:
// src/lib/controllers/__tests__/service.test.ts.

test("il job unifi_sync non nasce da solo: la sync non lo crea", async () => {
  await sync();
  await sync();
  assert.equal(conta(T, "scheduled_jobs", "job_type = 'unifi_sync'"), 0);
  assert.equal(conta(T_ALTRO, "scheduled_jobs", "job_type = 'unifi_sync'"), 0);
});
