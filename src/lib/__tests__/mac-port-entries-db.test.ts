import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  cleanupOldMacPortEntries, closeTenantDb, deleteTenantDatabase, getAllHostsEnriched, getHostById, getMacPortEntriesByDevice, getTenantDb,
  upsertMacPortEntries, withTenant,
} from "@/lib/db-tenant";

const T = "TESTMACPORT";
const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);
const riga = (mac: string, port_name: string) => ({ mac, port_name, vlan: null, port_status: null, speed: null });
type Riga = { mac: string; port_name: string; first_seen: string; timestamp: string; source: string };
const leggi = () => db().prepare("SELECT mac, port_name, first_seen, timestamp, source FROM mac_port_entries ORDER BY mac, port_name").all() as Riga[];

beforeEach(() => {
  db().exec("DELETE FROM mac_port_entries; DELETE FROM hosts; DELETE FROM networks; DELETE FROM network_devices;");
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api')");
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("una seconda lettura aggiorna la riga, tiene first_seen, e non cancella i MAC non visti", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-1 day'), first_seen = datetime('now','-1 day')");
  const ieri = leggi();
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "device"));
  const oggi = leggi();
  assert.equal(oggi.length, 2);                        // il ...02 resta: «visto l'ultima volta» ieri
  assert.equal(oggi[0].first_seen, ieri[0].first_seen); // la prima volta non avanza
  assert.ok(oggi[0].timestamp > ieri[0].timestamp);
  assert.equal(oggi[1].timestamp, ieri[1].timestamp);
});

test("getMacPortEntriesByDevice mostra solo l'ultimo giro della fonte", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-1 hour')");
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "device"));
  assert.deepEqual(w(() => getMacPortEntriesByDevice(1)).map((r) => r.mac), ["AA:00:00:00:00:01"]);
});

test("le righe più vecchie di 30 giorni si tolgono, le altre restano", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-31 days') WHERE mac = 'AA:00:00:00:00:01'");
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-29 days') WHERE mac = 'AA:00:00:00:00:02'");
  assert.equal(w(() => cleanupOldMacPortEntries()), 1);
  assert.deepEqual(leggi().map((r) => r.mac), ["AA:00:00:00:00:02"]);
});

test("la stessa porta letta da un'altra fonte aggiorna la riga: source cambia, first_seen resta", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "device"));
  db().exec("UPDATE mac_port_entries SET first_seen = datetime('now','-2 days')");
  const prima = leggi()[0];
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "unifi"));
  const dopo = leggi();
  assert.equal(dopo.length, 1);
  assert.equal(dopo[0].source, "unifi");
  assert.equal(dopo[0].first_seen, prima.first_seen);
});

test("lo stesso (MAC, porta) due volte nel giro (es. su due VLAN) non fa fallire il giro: una riga sola", () => {
  // Con il vecchio INSERT semplice il secondo inserimento violava l'indice
  // UNIQUE (device_id, mac, port_name) e la transazione perdeva l'intero giro.
  w(() => upsertMacPortEntries(1, [
    { mac: "AA:00:00:00:00:01", port_name: "Port 3", vlan: 10, port_status: "up", speed: "1G" },
    { mac: "AA:00:00:00:00:01", port_name: "Port 3", vlan: 20, port_status: "up", speed: "1G" },
    riga("AA:00:00:00:00:02", "Port 4"),
  ], "device"));
  assert.deepEqual(leggi().map((r) => `${r.mac}@${r.port_name}`), ["AA:00:00:00:00:01@Port 3", "AA:00:00:00:00:02@Port 4"]);
});

test("riaprire il database del cliente (riavvio, LRU) non toglie le righe di pochi giorni", () => {
  // La pulizia «one-shot» all'apertura (v0.2.651) toglieva tutto ciò che era più
  // vecchio di 24 ore: a ogni riavvio il «visto l'ultima volta» spariva.
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-2 days') WHERE mac = 'AA:00:00:00:00:01'");
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-31 days') WHERE mac = 'AA:00:00:00:00:02'");
  closeTenantDb(T);
  assert.deepEqual(leggi().map((r) => r.mac), ["AA:00:00:00:00:01"]);
});

test("la porta di un host è quella vista per ultima, non la riga creata per ultima", () => {
  // Con l'aggiornamento sul posto il rowid non dice più «la lettura più recente»:
  // un MAC tornato su una porta dove era già stato ha la riga più vecchia.
  db().exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db().exec("INSERT INTO hosts (id, network_id, ip, mac, status) VALUES (1, 1, '10.0.0.50', 'AA:00:00:00:00:09', 'online')");
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:09", "Port 3")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-2 hours')");
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:09", "Port 5")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-1 hour') WHERE port_name = 'Port 5'");
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:09", "Port 3")], "device"));
  assert.equal(w(() => getHostById(1))?.switch_port?.port_name, "Port 3");
  assert.equal(w(() => getAllHostsEnriched()).find((h) => h.id === 1)?.switch_port, "Port 3");
});
