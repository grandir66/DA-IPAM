/**
 * Tasto destro nella lista host della subnet (Riccardo, 08/11): testo delle celle per i
 * filtri, colonna dalla posizione, su quali host vale un'azione.
 *
 * Run: node --import tsx --test src/lib/networks/__tests__/celle-subnet.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { colonnaDaIndice, COLONNE_SUBNET, hostDelMenu, nomeHost, testoCellaSubnet, type HostCella } from "../celle-subnet";
import { passaFiltriValore } from "@/lib/discovery/filtri-valore";
import { getClassificationLabel } from "@/lib/device-classifications";

const stampante: HostCella = {
  ip: "172.16.0.21",
  status: "online",
  known_host: 1,
  ip_assignment: "dynamic",
  ad_dns_host_name: null,
  custom_name: null,
  hostname: "prn-ufficio",
  classification: "printer",
  vendor: "HP Inc.",
  notes: "",
};

test("il testo delle celle è quello che la colonna mostra", () => {
  assert.equal(testoCellaSubnet(stampante, "ip"), "172.16.0.21");
  assert.equal(testoCellaSubnet(stampante, "stato"), "Online");
  assert.equal(testoCellaSubnet(stampante, "conosciuto"), "Sì");
  assert.equal(testoCellaSubnet(stampante, "dhcp"), "DYN");
  assert.equal(testoCellaSubnet(stampante, "ad"), "No");
  assert.equal(testoCellaSubnet(stampante, "nome"), "prn-ufficio");
  assert.equal(testoCellaSubnet(stampante, "classificazione"), getClassificationLabel("printer"));
  assert.equal(testoCellaSubnet(stampante, "vendor"), "HP Inc.");
});

test("senza categoria la cella è vuota, e il vuoto si filtra come un valore", () => {
  const senza: HostCella = { ...stampante, ip: "172.16.0.22", classification: null };
  const filtri = [{ colonna: "classificazione", valore: "", escludi: false }];
  assert.equal(passaFiltriValore(filtri, (c) => testoCellaSubnet(senza, c)), true);
  assert.equal(passaFiltriValore(filtri, (c) => testoCellaSubnet(stampante, c)), false);
});

test("il nome segue l'ordine della colonna: a mano, hostname, DNS, apparato", () => {
  assert.equal(nomeHost({ ...stampante, custom_name: "Stampante 2° piano" }), "Stampante 2° piano");
  assert.equal(nomeHost({ ...stampante, hostname: null, dns_reverse: "prn.dts.local" }), "prn.dts.local");
  assert.equal(nomeHost({ ...stampante, hostname: null, device: { name: "172.16.0.21", sysname: null } }), "");
  assert.equal(nomeHost({ ...stampante, hostname: null, device: { name: "SW-1", sysname: null } }), "SW-1");
});

test("la colonna si riconosce dalla posizione; le colonne di pulsanti non filtrano", () => {
  assert.equal(COLONNE_SUBNET.length, 18);
  assert.equal(colonnaDaIndice(0), null);
  assert.equal(colonnaDaIndice(2), "ip");
  assert.equal(colonnaDaIndice(9), "classificazione");
  assert.equal(colonnaDaIndice(13), "vendor");
  assert.equal(colonnaDaIndice(99), null);
});

test("l'azione vale sulla selezione se la riga premuta ne fa parte, altrimenti sulla riga sola", () => {
  const sel = new Set([3, 5, 8]);
  assert.deepEqual(hostDelMenu(sel, 5).sort(), [3, 5, 8]);
  assert.deepEqual(hostDelMenu(sel, 9), [9]);
  assert.deepEqual(hostDelMenu(new Set(), 4), [4]);
});
