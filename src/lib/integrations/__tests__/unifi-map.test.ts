// Mapping puro controller UniFi → righe del DB tenant, provato sulla risposta
// vera di stat/device (controller di DTS, 12/10, ridotta e anonimizzata):
// SW-1 con LLDP verso SW-11 e AP-3, AP-3 appeso a SW-1 (porta 7), SW-11 con
// LLDP verso altri (anche apparati fuori dalla risposta), SW-2 offline senza
// LLDP. I test d'esempio del piano (LLDP dentro le porte, `lldp_chassis_id`)
// avevano una forma che il controller non manda: correzione 1 del piano.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStatDeviceResponse, parseUnifiDevice, type UnifiDevice } from "../unifi-device";
import {
  buildUnifiMacIndex,
  mapUnifiDevice,
  mapUnifiDeviceType,
  mapUnifiLldp,
  mapUnifiPorts,
  mapUnifiUplink,
} from "../unifi-map";
import { normalizeMacForStorage } from "@/lib/utils";

const FIXTURE = path.join(__dirname, "fixtures", "unifi-stat-device.json");
const devices = parseStatDeviceResponse(JSON.parse(fs.readFileSync(FIXTURE, "utf-8")));
const index = buildUnifiMacIndex(devices);

function byName(name: string): UnifiDevice {
  const d = devices.find((x) => x.name === name);
  assert.ok(d, `apparato ${name} assente dalla fixture`);
  return d;
}

/** Apparato costruito passando dal parser, così ha la forma vera. */
function device(raw: Record<string, unknown>): UnifiDevice {
  const d = parseUnifiDevice(raw);
  assert.ok(d);
  return d;
}

test("tipo: usw→switch, uap→access_point, ugw/udm/uxg→router, ignoto→null", () => {
  assert.equal(mapUnifiDeviceType("usw"), "switch");
  assert.equal(mapUnifiDeviceType("uap"), "access_point");
  assert.equal(mapUnifiDeviceType("ugw"), "router");
  assert.equal(mapUnifiDeviceType("udm"), "router");
  assert.equal(mapUnifiDeviceType("uxg"), "router");
  assert.equal(mapUnifiDeviceType("boh"), null);
  assert.equal(mapUnifiDeviceType(null), null);
  assert.equal(mapUnifiDeviceType(""), null);
});

test("apparato SW-1: nome, ip, mac, modello, seriale, firmware, vendor ubiquiti", () => {
  const r = mapUnifiDevice(byName("SW-1"));
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.deepEqual(r.device, {
    name: "SW-1",
    host: "10.99.0.7",
    device_type: "switch",
    vendor: "ubiquiti",
    model: "US8P60",
    serial_number: "SN000001",
    firmware: "7.2.123.16565",
    mac: "02:00:00:00:00:08",
  });
  const ap = mapUnifiDevice(byName("AP-3"));
  assert.ok(ap.ok);
  assert.equal(ap.device.device_type, "access_point");
});

test("apparato: mac normalizzato nella forma del DB (AA:BB:CC:DD:EE:FF)", () => {
  const r = mapUnifiDevice(device({ type: "usw", name: "X", ip: "10.0.0.1", mac: "aa-bb-cc-dd-ee-0f" }));
  assert.ok(r.ok);
  assert.equal(r.device.mac, "AA:BB:CC:DD:EE:0F");
});

test("apparato di tipo ignoto o senza IP: scartato con un motivo, mai un device_type fuori dal CHECK", () => {
  const ignoto = mapUnifiDevice(device({ type: "uph", name: "Telefono", ip: "10.0.0.2", mac: "aa:bb:cc:dd:ee:01" }));
  assert.equal(ignoto.ok, false);
  assert.match(ignoto.ok ? "" : ignoto.reason, /tipo/);
  const senzaIp = mapUnifiDevice(device({ type: "usw", name: "Nuovo", mac: "aa:bb:cc:dd:ee:02" }));
  assert.equal(senzaIp.ok, false);
  assert.match(senzaIp.ok ? "" : senzaIp.reason, /IP/);
});

test("apparato non adottato (in attesa o di un altro controller): scartato col motivo; adopted assente non scarta", () => {
  const attesa = mapUnifiDevice(
    device({ type: "uap", model: "U7PRO", ip: "192.168.1.20", mac: "aa:bb:cc:dd:ee:05", adopted: false, state: 1 }),
  );
  assert.equal(attesa.ok, false);
  assert.match(attesa.ok ? "" : attesa.reason, /adottato/);
  const ignoto = mapUnifiDevice(device({ type: "uap", name: "AP", ip: "10.0.0.5", mac: "aa:bb:cc:dd:ee:06" }));
  assert.ok(ignoto.ok);
  assert.equal(mapUnifiDevice(byName("SW-1")).ok, true);
});

test("apparato senza nome: si ripiega sul modello, poi sul MAC", () => {
  const r = mapUnifiDevice(device({ type: "uap", model: "U7PRO", ip: "10.0.0.3", mac: "aa:bb:cc:dd:ee:03" }));
  assert.ok(r.ok);
  assert.equal(r.device.name, "U7PRO");
  const r2 = mapUnifiDevice(device({ type: "uap", ip: "10.0.0.4", mac: "aa:bb:cc:dd:ee:04" }));
  assert.ok(r2.ok);
  assert.equal(r2.device.name, "AA:BB:CC:DD:EE:04");
});

test("vicini di SW-1: nome risolto per MAC fra gli apparati della risposta (SW-11, AP-3)", () => {
  const n = mapUnifiLldp(byName("SW-1"), index);
  assert.equal(n.length, 3);
  const p6 = n.find((x) => x.localPort === "Port 6");
  assert.deepEqual(p6, {
    localPort: "Port 6",
    remoteDevice: "SW-11",
    remotePort: "Port 14",
    protocol: "lldp",
    remoteMac: "02:00:00:00:00:04",
    remoteIp: "10.99.0.4",
    remotePlatform: "USL24P",
  });
  const p7 = n.find((x) => x.localPort === "Port 7");
  assert.ok(p7);
  assert.equal(p7.remoteDevice, "AP-3");
  assert.equal(p7.remoteMac, "02:00:00:00:00:05");
  assert.equal(p7.remoteIp, "10.99.0.5");
  // SW-1 vede come porta dell'AP il suo MAC; la porta vera ("eth0") la dice
  // l'AP stesso, nella sua voce LLDP che punta a SW-1 "local Port 7".
  assert.equal(p7.remotePort, "eth0");
});

test("vicino fuori dalla risposta: nome = chassis_id, niente IP inventato, porta-MAC scartata", () => {
  const p8 = mapUnifiLldp(byName("SW-1"), index).find((x) => x.localPort === "Port 8");
  assert.ok(p8);
  assert.equal(p8.remoteDevice, "02:00:00:00:00:06");
  assert.equal(p8.remoteMac, "02:00:00:00:00:06");
  assert.equal(p8.remotePort, "");
  assert.equal(p8.remoteIp, undefined);
  assert.equal(p8.remotePlatform, undefined);
});

test("AP-3: un vicino, SW-1 sulla 'Port 7' (ripulito da 'local Port 7'), porta locale eth0", () => {
  const n = mapUnifiLldp(byName("AP-3"), index);
  assert.deepEqual(n, [{
    localPort: "eth0",
    remoteDevice: "SW-1",
    remotePort: "Port 7",
    protocol: "lldp",
    remoteMac: "02:00:00:00:00:08",
    remoteIp: "10.99.0.7",
    remotePlatform: "US8P60",
  }]);
});

test("SW-11: vede SW-1 dall'altra parte del collegamento, coi MAC fuori risposta normalizzati", () => {
  const n = mapUnifiLldp(byName("SW-11"), index);
  assert.equal(n.length, 6);
  const versoSw1 = n.find((x) => x.localPort === "Port 14");
  assert.ok(versoSw1);
  assert.equal(versoSw1.remoteDevice, "SW-1");
  assert.equal(versoSw1.remotePort, "Port 6");
  const p4 = n.find((x) => x.localPort === "Port 4");
  assert.ok(p4);
  assert.equal(p4.remoteMac, "02:00:00:00:00:0E");
  assert.equal(p4.remoteDevice, "02:00:00:00:00:0E");
  assert.equal(p4.remotePort, "");
});

test("mgmt_ips: il vicino risolto prende l'IP dell'apparato; fuori risposta il primo IPv4, mai un IPv6", () => {
  // mgmt_ips manca nella fixture: forma ipotizzata (elenco di indirizzi), da verificare sul controller vero.
  const grezzo = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { data: Array<Record<string, unknown>> };
  const raw = grezzo.data.find((x) => x.name === "SW-11");
  assert.ok(raw);
  const lldp = (raw.lldp_table as Array<Record<string, unknown>>).map((e) => {
    if (e.local_port_idx === 14) return { ...e, mgmt_ips: ["fe80::1", "10.99.0.70"] }; // verso SW-1
    if (e.local_port_idx === 4) return { ...e, mgmt_ips: ["fe80::2", "10.99.0.80"] }; // fuori risposta
    if (e.local_port_idx === 7) return { ...e, chassis_id: null, mgmt_ips: ["fe80::3", "10.99.0.90"] }; // solo IP
    return e;
  });
  const n = mapUnifiLldp(device({ ...raw, lldp_table: lldp }), index);
  const versoSw1 = n.find((x) => x.localPort === "Port 14");
  assert.ok(versoSw1);
  assert.equal(versoSw1.remoteDevice, "SW-1");
  assert.equal(versoSw1.remoteIp, "10.99.0.7", "l'IP che la sync scrive in network_devices.host");
  assert.equal(n.find((x) => x.localPort === "Port 4")?.remoteIp, "10.99.0.80");
  const soloIp = n.find((x) => x.localPort === "Port 7");
  assert.ok(soloIp);
  assert.equal(soloIp.remoteDevice, "10.99.0.90");
  assert.equal(soloIp.remoteIp, "10.99.0.90");
});

test("SW-2 offline e senza LLDP: nessun vicino, porte con stato sconosciuto, nessun errore", () => {
  const sw2 = byName("SW-2");
  assert.deepEqual(mapUnifiLldp(sw2, index), []);
  const ports = mapUnifiPorts(sw2, index);
  assert.equal(ports.length, 5);
  for (const p of ports) {
    assert.equal(p.status, null);
    assert.equal(p.speed, null);
    assert.equal(p.duplex, null);
    assert.equal(p.trunk_neighbor_name, null);
    assert.equal(p.is_trunk, 0);
  }
});

/**
 * Un apparato della fixture reso offline come lo manda il controller per SW-2
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
  return device(copia);
}

test("switch PoE offline (SW-1 come SW-2): lo stato PoE non è noto, non «in ricerca»", () => {
  const sw1 = offline("SW-1");
  assert.equal(sw1.state, 0);
  const ports = mapUnifiPorts(sw1, index);
  assert.equal(ports.length, 8);
  const p7 = ports.find((p) => p.port_index === 7);
  assert.ok(p7);
  assert.equal(p7.status, null);
  assert.equal(p7.poe_status, null);
  for (const p of ports) assert.equal(p.poe_status, null, `porta ${p.port_index}`);
});

test("porte di SW-1: trunk_neighbor sulla porta giusta, colonne di switch_ports", () => {
  const ports = mapUnifiPorts(byName("SW-1"), index);
  assert.equal(ports.length, 8);
  const p = (idx: number) => {
    const x = ports.find((q) => q.port_index === idx);
    assert.ok(x, `porta ${idx} assente`);
    return x;
  };
  // porta 6: uplink verso SW-11
  assert.equal(p(6).trunk_neighbor_name, "SW-11");
  assert.equal(p(6).trunk_neighbor_port, "Port 14");
  assert.equal(p(6).is_trunk, 1);
  assert.equal(p(6).status, "up");
  assert.equal(p(6).speed, "1000 Mbps");
  assert.equal(p(6).duplex, "full");
  assert.equal(p(6).mac_count, 2);
  assert.equal(p(6).stp_state, "forwarding");
  assert.equal(p(6).port_name, "name-6");
  // porta 7: l'AP, alimentato in PoE
  assert.equal(p(7).trunk_neighbor_name, "AP-3");
  assert.equal(p(7).trunk_neighbor_port, "eth0");
  assert.equal(p(7).is_trunk, 1);
  assert.equal(p(7).poe_status, "delivering");
  assert.equal(p(7).poe_power_mw, 7730);
  // porta 1: giù, nessun vicino, niente PoE
  assert.equal(p(1).status, "down");
  assert.equal(p(1).speed, null);
  assert.equal(p(1).duplex, null);
  assert.equal(p(1).trunk_neighbor_name, null);
  assert.equal(p(1).trunk_neighbor_port, null);
  assert.equal(p(1).is_trunk, 0);
  assert.equal(p(1).poe_status, null);
  assert.equal(p(1).poe_power_mw, null);
  // porta 5: PoE disponibile ma nessuno alimentato
  assert.equal(p(5).poe_status, "searching");
  assert.equal(p(5).poe_power_mw, 0);
  // colonne che il controller non dà restano vuote: le riempie la sync
  for (const q of ports) {
    assert.equal(q.vlan, null);
    assert.equal(q.single_mac, null);
    assert.equal(q.host_id, null);
    assert.equal(q.trunk_primary_device_id, null);
  }
});

test("porte di SW-11: aggregazione (LAG) e uplink contano come trunk", () => {
  const ports = mapUnifiPorts(byName("SW-11"), index);
  const p23 = ports.find((q) => q.port_index === 23);
  const p24 = ports.find((q) => q.port_index === 24);
  assert.equal(p23?.is_trunk, 1);
  assert.equal(p24?.is_trunk, 1);
  assert.equal(ports.find((q) => q.port_index === 14)?.trunk_neighbor_name, "SW-1");
  assert.equal(ports.find((q) => q.port_index === 3)?.speed, "100 Mbps");
});

test("porta disabilitata e porta senza nome", () => {
  const d = device({
    type: "usw", mac: "aa:bb:cc:dd:ee:10", ip: "10.0.0.10",
    port_table: [
      { port_idx: 1, enable: false, up: false },
      { port_idx: 2, up: true, speed: 1000, full_duplex: false },
    ],
  });
  const ports = mapUnifiPorts(d, buildUnifiMacIndex([d]));
  assert.equal(ports[0].status, "disabled");
  assert.equal(ports[0].port_name, "Port 1");
  assert.equal(ports[1].duplex, "half");
});

test("chassis_id: MAC solo se il sottotipo è mac o se manca e ha forma di MAC", () => {
  const core = device({ type: "usw", name: "CORE", mac: "aa:bb:cc:dd:ee:01", ip: "10.0.0.1", model: "USW-PRO" });
  const d = device({
    type: "usw", name: "EDGE", mac: "aa:bb:cc:dd:ee:02", ip: "10.0.0.2",
    lldp_table: [
      // MAC scritto in un'altra forma: l'indice lo trova lo stesso
      { chassis_id: "AA-BB-CC-DD-EE-01", chassis_id_subtype: "mac", local_port_idx: 1, local_port_name: "Port 1", port_id: "Port 9" },
      // vicino non UniFi che si annuncia per nome
      { chassis_id: "fw-sede", chassis_id_subtype: "local", local_port_idx: 2, port_id: "ge-0/0/1", mgmt_ips: ["10.0.0.254"] },
      // sottotipo assente e testo che non è un MAC
      { chassis_id: "server-x", local_port_idx: 3, port_id: "eno1" },
      // nessuna identità del vicino: scartata
      { local_port_idx: 4, port_id: "Port 2" },
    ],
  });
  const idx = buildUnifiMacIndex([core, d]);
  const n = mapUnifiLldp(d, idx);
  assert.equal(n.length, 3);
  assert.equal(n[0].remoteDevice, "CORE");
  assert.equal(n[0].remoteMac, "AA:BB:CC:DD:EE:01");
  assert.equal(n[0].remotePlatform, "USW-PRO");
  assert.equal(n[1].remoteDevice, "fw-sede");
  assert.equal(n[1].remoteMac, undefined);
  assert.equal(n[1].remoteIp, "10.0.0.254");
  assert.equal(n[1].localPort, "Port 2"); // 'Port <local_port_idx>' quando manca il nome
  assert.equal(n[1].remotePort, "ge-0/0/1");
  assert.equal(n[2].remoteDevice, "server-x");
  assert.equal(n[2].remoteMac, undefined);
});

test("apparato senza mac, senza port_table e senza lldp_table: nessun errore", () => {
  const nudo = device({ type: "usw", ip: "10.0.0.20" });
  const idx = buildUnifiMacIndex([nudo]);
  assert.doesNotThrow(() => mapUnifiPorts(nudo, idx));
  assert.doesNotThrow(() => mapUnifiLldp(nudo, idx));
  assert.deepEqual(mapUnifiPorts(nudo, idx), []);
  assert.deepEqual(mapUnifiLldp(nudo, idx), []);
  const r = mapUnifiDevice(nudo);
  assert.ok(r.ok);
  assert.equal(r.device.mac, null);
  assert.equal(r.device.name, "10.0.0.20");
});

test("indice per MAC: un apparato per MAC, gli apparati senza MAC restano fuori", () => {
  assert.equal(index.size, 4);
  assert.equal(index.get("02:00:00:00:00:04")?.name, "SW-11");
  assert.equal(buildUnifiMacIndex([device({ type: "usw", ip: "10.0.0.1" })]).size, 0);
});

test("mapUnifiUplink: MAC del controller e uplink normalizzati; nessun uplink verso se stessi", () => {
  for (const d of devices) {
    const f = mapUnifiUplink(d);
    assert.equal(f.controllerMac, normalizeMacForStorage(d.mac));
    const atteso = normalizeMacForStorage(d.uplink?.uplink_mac ?? null);
    if (!atteso || atteso === f.controllerMac) {
      assert.equal(f.uplinkMac, null);
      assert.equal(f.uplinkRemotePort, null);
    } else {
      assert.equal(f.uplinkMac, atteso);
      assert.equal(f.uplinkRemotePort, d.uplink?.uplink_remote_port ?? null);
    }
  }
  assert.ok(devices.some((d) => mapUnifiUplink(d).uplinkMac !== null), "la fixture vera ha almeno un uplink");
});

test("mapUnifiPorts: is_uplink come lo dice il controller", () => {
  for (const d of devices) {
    const righe = mapUnifiPorts(d, buildUnifiMacIndex(devices));
    for (const p of d.port_table) {
      assert.equal(righe.find((r) => r.port_index === p.port_idx)?.is_uplink, p.is_uplink ? 1 : 0);
    }
  }
});
