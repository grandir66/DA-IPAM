/**
 * Reti del sensore trunk con la maschera (25/10): unione dei /24 vicini.
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/reti.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unisciReti } from "@/lib/trunk/reti";

const arp = (cidr: string, gw: string | null = "10.4.0.1") => ({ vid: 4, cidr, gateway_ip: gw, fonte: "arp" });

test("quattro /24 consecutivi con lo stesso gateway diventano una /22 dedotta", () => {
  const r = unisciReti(4, ["10.4.0.0/24", "10.4.1.0/24", "10.4.2.0/24", "10.4.3.0/24"].map((c) => arp(c)));
  assert.equal(r.length, 1);
  assert.equal(r[0].cidr, "10.4.0.0/22");
  assert.equal(r[0].maschera, "dedotta");
  assert.equal(r[0].blocchi.length, 4);
});

test("/24 sparsi con lo stesso gateway: una rete sola, maschera incerta", () => {
  const r = unisciReti(100, ["10.100.1.0/24", "10.100.7.0/24", "10.100.12.0/24"].map((c) => arp(c, "10.100.0.1")));
  assert.equal(r.length, 1);
  assert.equal(r[0].cidr, "10.100.0.0/20");
  assert.equal(r[0].maschera, "incerta");
});

test("gateway diversi restano reti diverse", () => {
  const r = unisciReti(4, [arp("10.4.0.0/24", "10.4.0.1"), arp("10.4.1.0/24", "10.4.1.1")]);
  assert.deepEqual(r.map((x) => x.cidr), ["10.4.0.0/24", "10.4.1.0/24"]);
});

test("oltre /16 non si unisce", () => {
  const r = unisciReti(4, [arp("10.4.0.0/24"), arp("10.9.0.0/24")]);
  assert.equal(r.length, 2);
});

test("un /24 dedotto dentro una rete DHCP sparisce, la DHCP resta certa", () => {
  const r = unisciReti(30, [{ vid: 30, cidr: "10.30.0.0/23", gateway_ip: "10.30.0.1", fonte: "dhcp" }, arp("10.30.1.0/24", "10.30.0.1")]);
  assert.equal(r.length, 1);
  assert.equal(r[0].maschera, "dhcp");
});

test("la correzione a mano cambia la maschera e la segna come impostata", () => {
  const r = unisciReti(4, [arp("10.4.0.0/24")], { "4|10.4.0.0/24": 23 });
  assert.equal(r[0].cidr, "10.4.0.0/23");
  assert.equal(r[0].maschera, "config");
  assert.equal(r[0].dedotta, "10.4.0.0/24");
});
