/**
 * Appartenenza degli IP del trunk e VLAN nativa (Riccardo, 08/11/2026): i pacchetti senza tag
 * arrivano come VID 0, la stessa rete in DA-IPAM è la VLAN 1. Dati con la forma vera, IP finti.
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/appartenenza.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appartenenzaIp, deduciVlanNativa, passaFiltroAppartenenza, vidEffettivo, vistoNellaVlan, type ReteDichiarata,
} from "../appartenenza";

const reti: ReteDichiarata[] = [
  { cidr: "172.20.0.0/17", vlan_id: 1 },
  { cidr: "172.21.0.0/22", vlan_id: 11 },
  { cidr: "172.21.16.0/20", vlan_id: 16 },
  { cidr: "10.9.9.0/24", vlan_id: null },
];
const arp = { protocolli: ["arp"], attivo: 0 };

test("senza tag e nativa nota: l'IP della rete della VLAN 1 è ufficiale", () => {
  assert.equal(appartenenzaIp({ ip: "172.20.1.120", vid: 0, ...arp }, reti, 1).tag, "ufficiale");
});

test("senza tag e nativa non nota: la stessa riga è di un'altra VLAN (il difetto misurato)", () => {
  const a = appartenenzaIp({ ip: "172.20.1.120", vid: 0, ...arp }, reti, null);
  assert.deepEqual(a, { tag: "vlan_non_ipam" });
});

test("rete dichiarata per un'altra VLAN: tag con la rete e la VLAN attese", () => {
  assert.deepEqual(appartenenzaIp({ ip: "172.21.23.3", vid: 10, ...arp }, [...reti, { cidr: "10.10.0.0/24", vlan_id: 10 }], 1),
    { tag: "altra_vlan", rete: "172.21.16.0/20", vlan: 16 });
});

test("169.254 vince su tutto: è un DHCP non riuscito", () => {
  assert.equal(appartenenzaIp({ ip: "169.254.37.43", vid: 11, ...arp }, reti, 1).tag, "link_local");
});

test("visto solo dentro un pacchetto IP: instradato, anche in una VLAN senza reti", () => {
  assert.equal(appartenenzaIp({ ip: "172.20.3.11", vid: 16, protocolli: ["ipv4"], attivo: 0 }, reti, 1).tag, "instradato");
  assert.equal(appartenenzaIp({ ip: "172.20.3.11", vid: 77, protocolli: ["ipv4"], attivo: 0 }, reti, 1).tag, "instradato");
  // Senza protocolli non si sa: resta della VLAN (le righe vecchie non spariscono dall'elenco).
  assert.equal(appartenenzaIp({ ip: "172.20.3.11", vid: 77, protocolli: [], attivo: 0 }, reti, 1).tag, "vlan_non_ipam");
  // Lo stesso IP con un protocollo che resta nella VLAN non è instradato.
  assert.equal(appartenenzaIp({ ip: "172.20.3.11", vid: 16, protocolli: ["ipv4", "mdns"], attivo: 0 }, reti, 1).tag, "altra_vlan");
});

test("VLAN senza reti in DA-IPAM, IP privato o pubblico", () => {
  assert.equal(appartenenzaIp({ ip: "93.41.1.150", vid: 21, protocolli: ["arp", "cdp"], attivo: 0 }, reti, 1).tag, "vlan_non_ipam");
  assert.equal(appartenenzaIp({ ip: "192.168.30.252", vid: 30, ...arp }, reti, 1).tag, "vlan_non_ipam");
});

test("VLAN dichiarata ma IP in nessuna rete: fuori rete o pubblico", () => {
  assert.equal(appartenenzaIp({ ip: "192.168.1.48", vid: 11, ...arp }, reti, 1).tag, "fuori_rete");
  assert.equal(appartenenzaIp({ ip: "20.20.20.2", vid: 11, ...arp }, reti, 1).tag, "pubblico");
});

test("il giro ARP del sensore conta come visto nella VLAN", () => {
  assert.equal(vistoNellaVlan([], 1), true);
  assert.equal(vistoNellaVlan(["ipv4"], 0), false);
  assert.equal(vidEffettivo(0, 1), 1);
  assert.equal(vidEffettivo(0, null), 0);
  assert.equal(vidEffettivo(11, 1), 11);
});

test("VLAN nativa dedotta dalla rete che contiene almeno metà degli IP senza tag", () => {
  const senzaTag = ["172.20.1.1", "172.20.1.2", "172.20.40.55", "192.168.1.102", "169.254.1.1"];
  assert.deepEqual(deduciVlanNativa(senzaTag, reti), { vid: 1, rete: "172.20.0.0/17", dentro: 3, totale: 4 });
});

test("niente nativa se nessuna rete con VLAN ne contiene la metà, o se non ci sono IP", () => {
  assert.equal(deduciVlanNativa(["192.168.1.1", "192.168.1.2", "172.20.0.5"], reti), null);
  assert.equal(deduciVlanNativa(["10.9.9.1", "10.9.9.2"], reti), null); // rete senza VLAN
  assert.equal(deduciVlanNativa([], reti), null);
});

test("filtro della tabella: di serie gli instradati restano fuori", () => {
  assert.equal(passaFiltroAppartenenza("", "instradato"), false);
  assert.equal(passaFiltroAppartenenza("", "ufficiale"), true);
  assert.equal(passaFiltroAppartenenza("altri", "ufficiale"), false);
  assert.equal(passaFiltroAppartenenza("altri", "link_local"), true);
  assert.equal(passaFiltroAppartenenza("tutti", "instradato"), true);
  assert.equal(passaFiltroAppartenenza("instradato", "instradato"), true);
});
