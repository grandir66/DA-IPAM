/**
 * Parità del dominio «ARP, vicini, rotte e porte» (NUC-2 gruppo 1b, T3-06).
 *
 * Le cinque funzioni con testo diverso nelle due copie (nome della variabile
 * del database, il tipo della sorgente preso da un altro modulo) e
 * `markHostsOffline`, che la discovery chiama a ogni giro e che il piano vuole
 * provata qui, sono confrontate con la copia congelata della vecchia facciata:
 * stesso valore, stesse tabelle. `upsertSwitchPorts` nella facciata era già
 * una delega alla copia tenant: ora è la stessa funzione, come dice la prova
 * d'identità.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/arp-vecchia-facciata";
import { APPARATO, HOST, RETE_SERVER, RETE_UFFICI, retiHostCredenziali, stessoEsito } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Legami MAC-IP, porte, vicini e rotte come li lascia il giro ARP/SNMP del giorno prima. */
function conRete(db: Database.Database): void {
  retiHostCredenziali(db);
  const m = db.prepare(
    `INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id, vendor, hostname, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-10-01T08:00:00.000Z', ?)`,
  );
  m.run("001a2b3c4d02", "00:1A:2B:3C:4D:02", "10.40.0.20", "arp", APPARATO.router, RETE_UFFICI, HOST.pcAmmin, "Dell", "pc-ammin", "2026-10-12T08:00:00.000Z");
  m.run("001a2b3c4d05", "00:1A:2B:3C:4D:05", "10.41.0.10", "dhcp", APPARATO.router, RETE_SERVER, HOST.srvDb, null, null, "2026-10-11T08:00:00.000Z");
  db.prepare("INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed) VALUES (?, ?, ?, ?, ?, ?)").run(
    APPARATO.switchCore, "00:1A:2B:3C:4D:99", "1/1", 10, "up", "1G",
  );
  db.prepare(
    "INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol) VALUES (?, ?, ?, ?, ?)",
  ).run(APPARATO.switchCore, "1/48", "vecchio-vicino", "ge-0/0/1", "lldp");
  db.prepare(
    "INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, active) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(APPARATO.router, "0.0.0.0/0", "192.0.2.1", "ether1", "static", 1);
}

const ORA = ["first_seen", "last_seen", "updated_at", "created_at", "attr_at", "changed_at", "discovered_at", "collected_at", "timestamp"];

test("upsertMacIpMapping: MAC nuovo, MAC con IP cambiato (storico), MAC con lo stesso IP", () => {
  const casi = [
    ["umim1", { mac: "00-1a-2b-3c-4d-0b", ip: "10.40.0.70", source: "arp", source_device_id: APPARATO.router, network_id: RETE_UFFICI, vendor: "HP" }],
    ["umim2", { mac: "00:1a:2b:3c:4d:02", ip: "10.40.0.21", source: "dhcp", hostname: "pc-ammin" }],
    ["umim3", { mac: "001A.2B3C.4D05", ip: "10.41.0.10", source: "arp", host_id: HOST.srvDb, vendor: "Dell" }],
  ] as const;
  for (const [nome, input] of casi) {
    stessoEsito({
      nome,
      fixture: conRete,
      facciata: () => vecchia.upsertMacIpMapping(input),
      tenant: () => tenant.upsertMacIpMapping(input),
      funzioni: [vecchia.upsertMacIpMapping, tenant.upsertMacIpMapping],
      tabelle: ["mac_ip_mapping", "mac_ip_history"],
      colonneOra: ORA,
    });
  }
});

test("getMacIpMappings: stessi legami con ogni filtro", () => {
  for (const [nome, opzioni] of [
    ["gmim1", undefined],
    ["gmim2", { network_id: RETE_UFFICI }],
    ["gmim3", { source: "dhcp" as const }],
    ["gmim4", { q: "4d:05" }],
    ["gmim5", { q: "10.40", limit: 1 }],
  ] as const) {
    stessoEsito({
      nome,
      fixture: conRete,
      facciata: () => vecchia.getMacIpMappings(opzioni),
      tenant: () => tenant.getMacIpMappings(opzioni),
      funzioni: [vecchia.getMacIpMappings, tenant.getMacIpMappings],
      tabelle: [],
      colonneOra: ORA,
    });
  }
});

test("upsertMacPortEntries, upsertNeighbors, upsertRoutes: sostituiscono le righe dell'apparato", () => {
  const voci = [
    { mac: "00:1A:2B:3C:4D:02", port_name: "1/5", vlan: 10, port_status: "up" as const, speed: "1G" },
    { mac: "00:1A:2B:3C:4D:04", port_name: "1/7", vlan: null, port_status: null, speed: null },
  ];
  stessoEsito({
    nome: "umpe",
    fixture: conRete,
    facciata: () => vecchia.upsertMacPortEntries(APPARATO.switchCore, voci),
    tenant: () => tenant.upsertMacPortEntries(APPARATO.switchCore, voci),
    funzioni: [vecchia.upsertMacPortEntries, tenant.upsertMacPortEntries],
    tabelle: ["mac_port_entries"],
    colonneOra: ORA,
  });
  // Un vicino con il MAC di un host: la copia ricalcola l'attribuzione di quell'host.
  const vicini = [
    { localPort: "1/48", remoteDevice: "gw-sede", remotePort: "ether2", protocol: "lldp", remoteIp: "10.40.0.1" },
    { localPort: "1/40", remoteDevice: "nas-01", remotePort: "eth0", protocol: "lldp", remoteMac: "00:1A:2B:3C:4D:04", remotePlatform: "DSM 7.2" },
    { localPort: "1/40", remoteDevice: "nas-01", remotePort: "eth0", protocol: "lldp", remoteMac: "00:1A:2B:3C:4D:04" },
  ];
  stessoEsito({
    nome: "un",
    fixture: conRete,
    facciata: () => vecchia.upsertNeighbors(APPARATO.switchCore, vicini),
    tenant: () => tenant.upsertNeighbors(APPARATO.switchCore, vicini),
    funzioni: [vecchia.upsertNeighbors, tenant.upsertNeighbors],
    tabelle: ["device_neighbors", "hosts"],
    colonneOra: ORA,
  });
  const rotte = [
    { destination: "0.0.0.0/0", gateway: "192.0.2.1", interface_name: "ether1", protocol: "static", distance: 1, active: true },
    { destination: "10.41.0.0/24", gateway: null, interface_name: "bridge-srv", protocol: "connected", metric: 0, active: true },
    { destination: "172.16.0.0/16", gateway: "10.40.0.254", interface_name: null, protocol: "ospf", active: false },
  ];
  stessoEsito({
    nome: "ur",
    fixture: conRete,
    facciata: () => vecchia.upsertRoutes(APPARATO.router, rotte),
    tenant: () => tenant.upsertRoutes(APPARATO.router, rotte),
    funzioni: [vecchia.upsertRoutes, tenant.upsertRoutes],
    tabelle: ["routing_table"],
    colonneOra: ORA,
  });
});

test("markHostsOffline: con gli IP scansionati, senza, e con nessun host online", () => {
  const casi = [
    ["mho1", RETE_UFFICI, ["10.40.0.2"], ["10.40.0.2", "10.40.0.20", "10.40.0.30"]],
    ["mho2", RETE_UFFICI, ["10.40.0.2", "10.40.0.40"], undefined],
    ["mho3", RETE_SERVER, [], undefined],
    ["mho4", RETE_UFFICI, ["10.40.0.2"], ["10.40.0.2"]],
  ] as const;
  for (const [nome, rete, online, scansionati] of casi) {
    const e = stessoEsito({
      nome,
      fixture: conRete,
      facciata: () => vecchia.markHostsOffline(rete, [...online], scansionati ? [...scansionati] : undefined),
      tenant: () => tenant.markHostsOffline(rete, [...online], scansionati ? [...scansionati] : undefined),
      funzioni: [vecchia.markHostsOffline, tenant.markHostsOffline],
      tabelle: ["hosts"],
      colonneOra: ORA,
    });
    if (nome === "mho1") {
      const stato = Object.fromEntries((e.tabelleTenant.hosts as Array<{ ip: string; status: string }>).map((h) => [h.ip, h.status]));
      assert.equal(stato["10.40.0.20"], "offline", "un host scansionato e muto va offline");
      assert.equal(stato["10.40.0.40"], "online", "un host non scansionato resta com'era");
    }
  }
});
