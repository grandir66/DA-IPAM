// Scrittura dei fatti delle letture in più (spec §13.5.7, «Come si scrive»): INSERT … ON CONFLICT, `seen_at` si sposta,
// `first_seen` resta, le colonne che il lettore non conosce restano com'erano; niente DELETE del giro; potatura a 90
// giorni delle righe dell'apparato, nella stessa transazione. Le colonne nuove dei vicini con un'istruzione a parte, che
// non ferma mai la scrittura dei vicini (I34). I fatti non entrano in switch_ports (I35) né nei MAC noti che decidono
// l'abbinamento del controller (I55).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getNetworkDeviceKnownMacs, getTenantDb, getTopologyModelInput, rileggiSchemaCavi, schemaCaviPresente,
  scriviFattiTopologia, setUplinkCavi, upsertNeighbors, upsertSwitchPorts, withTenant,
} from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";

const T = "TESTTOPOCAVISCRIVE";
const db = () => getTenantDb(T);
const ORA = new Date("2026-10-15T10:00:00Z");

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices; DELETE FROM hosts;`);
  db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api')").run();
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const porta = (over: Record<string, unknown> = {}) => ({ port_key: "n:ether2", port_name: "ether2", if_kind: "physical", running: 1, stp_state: "forwarding", ...over });

test("scrive, poi aggiorna: seen_at si sposta, first_seen resta; le colonne che il lettore non conosce restano", () => {
  withTenant(T, () => {
    assert.deepEqual(scriviFattiTopologia(1, "device", { porte: [porta({ stp_role: "designated" })], bridge: [], macs: [] }, ORA), { porte: 1, bridge: 0, macs: 0 });
    const dopo = new Date("2026-10-15T11:00:00Z");
    // Il secondo giro non conosce stp_role (assente da tutte le righe): resta; stp_state letto e vuoto (null): si scrive null.
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", stp_state: null }], bridge: [], macs: [] }, dopo);
  });
  const r = db().prepare("SELECT stp_role, stp_state, if_kind, first_seen, seen_at FROM topology_port_facts").get();
  assert.deepEqual(r, { stp_role: "designated", stp_state: null, if_kind: "physical", first_seen: "2026-10-15 10:00:00", seen_at: "2026-10-15 11:00:00" });
});

test("due lettori dello stesso apparato non si sovrascrivono (la fonte è nella chiave)", () => {
  withTenant(T, () => {
    scriviFattiTopologia(2, "controller", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3 })], bridge: [], macs: [] }, ORA);
    scriviFattiTopologia(2, "snmp", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3, stp_state: "discarding" })], bridge: [], macs: [] }, ORA);
  });
  assert.deepEqual(db().prepare("SELECT source, stp_state FROM topology_port_facts ORDER BY source").all(),
    [{ source: "controller", stp_state: "forwarding" }, { source: "snmp", stp_state: "discarding" }]);
});

test("potatura: le righe dell'apparato non viste da 90 giorni se ne vanno alla scrittura dopo; quelle di 30 restano", () => {
  // 2026-07-01 = 106 giorni prima del giro (ORA, 15/10); 2026-09-15 = 30 giorni prima.
  db().prepare("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, seen_at) VALUES (1, 'device', 'n:vecchia', 'vecchia', '2026-07-01 10:00:00'), (1, 'device', 'n:recente', 'recente', '2026-09-15 10:00:00')").run();
  db().prepare("INSERT INTO topology_device_macs (device_id, mac, source, seen_at) VALUES (1, '02:00:00:00:00:99', 'device', '2026-07-01 10:00:00')").run();
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [porta()], bridge: [], macs: [{ mac: "02:00:00:00:00:01", port_key: "n:ether2" }] }, ORA));
  assert.deepEqual((db().prepare("SELECT port_key FROM topology_port_facts ORDER BY port_key").all() as Array<{ port_key: string }>).map((r) => r.port_key), ["n:ether2", "n:recente"]);
  assert.deepEqual((db().prepare("SELECT mac FROM topology_device_macs").all() as Array<{ mac: string }>).map((r) => r.mac), ["02:00:00:00:00:01"]);
});

// Regola per riga (scelta del piano dopo la revisione del Task 1, «Scelte» punto 8): una colonna che il lettore conosce
// (presente in almeno una riga) si scrive col valore della riga, null compreso; resta com'era solo una colonna assente da
// TUTTE le righe. Un COALESCE per riga terrebbe valori vecchi su righe dell'ultimo giro: un bridge diventato radice
// (root_port null = è la radice) resterebbe con la porta radice di prima, una porta uscita dal fascio col fascio di prima.
test("un null letto cancella il valore di prima: bridge diventato radice, porta uscita dal fascio", () => {
  const br = (root_port: string | null) => ({ bridge_name: "bridge", instance: 0, protocol: "rstp", root_port });
  withTenant(T, () => {
    scriviFattiTopologia(1, "device", { porte: [porta({ lag_group: "bond1" })], bridge: [br("ether1")], macs: [] }, ORA);
    scriviFattiTopologia(1, "device", { porte: [porta({ lag_group: null })], bridge: [br(null)], macs: [] }, new Date("2026-10-15T11:00:00Z"));
  });
  assert.deepEqual(db().prepare("SELECT root_port FROM topology_bridge_facts").get(), { root_port: null });
  assert.deepEqual(db().prepare("SELECT lag_group FROM topology_port_facts").get(), { lag_group: null });
});

test("bridge per istanza e MAC normalizzati; un MAC tutto zeri non si scrive", () => {
  withTenant(T, () => scriviFattiTopologia(1, "device", {
    porte: [],
    bridge: [{ bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, bridge_id: "0.02:00:a0:10:0e:02", root_id: "0.02:00:a0:10:0e:02", root_port: null }],
    macs: [{ mac: "02-00-a0-10-0e-02", port_key: "n:sfp-sfpplus1" }, { mac: "00:00:00:00:00:00", port_key: "n:lo" }],
  }, ORA));
  assert.deepEqual(db().prepare("SELECT bridge_name, instance, protocol, priority, root_port FROM topology_bridge_facts").all(),
    [{ bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, root_port: null }]);
  assert.deepEqual((db().prepare("SELECT mac FROM topology_device_macs").all() as Array<{ mac: string }>).map((r) => r.mac), ["02:00:A0:10:0E:02"]);
});

test("I35: upsertSwitchPorts riscrive switch_ports e lascia stare i fatti", () => {
  withTenant(T, () => {
    scriviFattiTopologia(2, "controller", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3 })], bridge: [], macs: [] }, ORA);
    upsertSwitchPorts(2, []);
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_port_facts").get() as { n: number }).n, 1);
});

test("I55: i MAC dei lettori nuovi non entrano nei MAC noti (la sincronizzazione del controller li usa per abbinare)", () => {
  const prima = withTenant(T, () => getNetworkDeviceKnownMacs());
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [], bridge: [], macs: [{ mac: "02:00:00:00:00:77", port_key: null }] }, ORA));
  assert.deepEqual(withTenant(T, () => getNetworkDeviceKnownMacs()), prima);
});

test("colonne nuove dei vicini: scritte a parte quando ci sono, lasciate stare quando mancano", () => {
  withTenant(T, () => {
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp", discoveredBy: "cdp,lldp,mndp", remoteCaps: "bridge" }]);
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }]);
  });
  assert.deepEqual(db().prepare("SELECT discovered_by, remote_caps, local_port_index FROM device_neighbors").get(),
    { discovered_by: "cdp,lldp,mndp", remote_caps: "bridge", local_port_index: null });
});

test("le fonti nuove (ssh, snmp, host) non entrano nell'ingresso del modello di oggi", () => {
  withTenant(T, () => {
    upsertNeighbors(2, [{ localPort: "Port 3", remoteDevice: "RTR-1", remotePort: "ether2", protocol: "lldp" }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }], "ssh");
  });
  assert.equal(withTenant(T, () => getTopologyModelInput(2)).neighbors.length, 0);
});

// Revisione del Task 1 di T2 (R7, I33): la chiave unica dei vicini non contiene la fonte, e `source = excluded.source`
// faceva sì che una lettura in più (ssh, snmp, host) sulla stessa chiave di un vicino `device`/`unifi` gli cambiasse
// fonte: il vicino usciva dalla mappa di T1 (lo stesso con uno switch MikroTik letto prima come router, Task 4). Una
// fonte nuova non tocca più la riga di una fonte di oggi; le colonne nuove dei vicini si aggiornano lo stesso, a parte.
// Al contrario una fonte di oggi sopra una nuova la riporta a `device`, e il vicino torna nella mappa di T1.
test("R7: una fonte nuova sulla stessa chiave non toglie il vicino alla mappa di T1; una di oggi sopra una nuova lo riporta", () => {
  const v = { localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" };
  const riga = () => db().prepare("SELECT source, remote_caps FROM device_neighbors").get() as { source: string; remote_caps: string | null };
  const viciniT1 = () => withTenant(T, () => getTopologyModelInput(2)).neighbors.length;
  withTenant(T, () => upsertNeighbors(1, [v]));
  assert.equal(viciniT1(), 1);
  for (const fonte of ["ssh", "snmp", "host"] as const) {
    withTenant(T, () => upsertNeighbors(1, [{ ...v, remoteCaps: `bridge-${fonte}` }], fonte));
    assert.equal(viciniT1(), 1, `il modello di T1 ha perso il vicino dopo la fonte ${fonte}`);
    // Le colonne nuove della riga `device` restano com'erano: una fonte nuova non la cambia in nessun campo (R7, I33).
    assert.deepEqual(riga(), { source: "device", remote_caps: null });
  }

  db().exec("DELETE FROM device_neighbors");
  withTenant(T, () => upsertNeighbors(1, [v], "ssh"));
  assert.equal(viciniT1(), 0);
  withTenant(T, () => upsertNeighbors(1, [v]));
  assert.equal(riga().source, "device");
  assert.equal(viciniT1(), 1);
});

// Revisione dei Task 4 e 6 di T2 (R7 vince su §13.5.1, piano «Scelte» punto 9): la potatura a 90 giorni toglieva TUTTE le
// righe vecchie dell'apparato, qualunque fonte scrivesse. Accesa la lettura SSH o SNMP su uno switch, la prima scrittura
// cancellava un vicino `device` di 91 giorni che la mappa di T1 mostra come «non visto»: accendere cambiava la mappa. Una
// fonte nuova pota solo le proprie righe; le fonti di oggi potano come prima.
test("R7: la potatura di una fonte nuova (ssh, snmp) toglie solo le sue righe; una riga device di 91 giorni resta", () => {
  const righe = () => (db().prepare("SELECT source, remote_device_name AS n FROM device_neighbors ORDER BY source, n").all() as Array<{ source: string; n: string }>)
    .map((r) => `${r.source}:${r.n}`);
  for (const fonte of ["ssh", "snmp"] as const) {
    db().exec("DELETE FROM device_neighbors");
    withTenant(T, () => {
      upsertNeighbors(1, [{ localPort: "ether5", remoteDevice: "VECCHIO-T1", remotePort: "Port 9", protocol: "lldp" }]);
      upsertNeighbors(1, [{ localPort: "ether7", remoteDevice: "VECCHIO-NUOVA", remotePort: "Port 1", protocol: "lldp" }], fonte);
    });
    db().prepare("UPDATE device_neighbors SET timestamp = datetime('now', '-91 days')").run();
    withTenant(T, () => upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }], fonte));
    assert.deepEqual(righe(), ["device:VECCHIO-T1", `${fonte}:SW-2`], `fonte ${fonte}: la riga device resta, la sua vecchia se ne va`);
  }
  // Le fonti di oggi come prima: una scrittura `device` pota tutte le righe vecchie dell'apparato.
  db().prepare("UPDATE device_neighbors SET timestamp = datetime('now', '-91 days')").run();
  withTenant(T, () => upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }]));
  assert.deepEqual(righe(), ["device:SW-2"], "la riga vecchia di T1 se ne va; quella della chiave torna `device`");
});

test("I34: una migrazione non riuscita non ferma i vicini, e il modello si calcola", () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps"); // simula lo schema a metà
  withTenant(T, () => {
    assert.equal(schemaCaviPresente(), true, "l'annotazione di prima dice ancora «presente»: l'istruzione a parte fallirà");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp", remoteCaps: "bridge" }]);
    assert.equal(rileggiSchemaCavi(), false);
    assert.equal(scriviFattiTopologia(1, "device", { porte: [porta()], bridge: [], macs: [] }, ORA), null, "senza schema non si scrive");
    assert.equal(setUplinkCavi(2, 3, "lldp_uplink"), false);
    assert.equal(buildTopologyModel(getTopologyModelInput(2)).counts.devices, 2);
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM device_neighbors").get() as { n: number }).n, 1, "il vicino c'è");
  db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
});

// Revisione del Task 7 di T2 (R7, I33): l'UPDATE delle colonne nuove non guardava la fonte, e una scrittura `host` sulla
// chiave di una riga `device` le riempiva. Le colonne nuove di una riga di oggi restano com'erano; una fonte di oggi
// sopra una riga `device` le scrive, e una fonte nuova sulla propria riga pure.
test("R7: una scrittura host sulla chiave di una riga device non ne cambia le colonne nuove", () => {
  const v = { localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" };
  const colonne = () => db().prepare("SELECT source, discovered_by, local_port_index, remote_port_index, remote_caps FROM device_neighbors").get();
  withTenant(T, () => upsertNeighbors(1, [{ ...v, discoveredBy: "lldp", localPortIndex: 7, remoteCaps: "bridge" }]));
  const prima = colonne();
  withTenant(T, () => upsertNeighbors(1, [{ ...v, discoveredBy: "host", localPortIndex: 99, remotePortIndex: 5, remoteCaps: "station" }], "host"));
  assert.deepEqual(colonne(), prima);
  db().exec("DELETE FROM device_neighbors");
  withTenant(T, () => upsertNeighbors(1, [{ ...v, remoteCaps: "station" }], "host"));
  assert.deepEqual(colonne(), { source: "host", discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: "station" });
});
