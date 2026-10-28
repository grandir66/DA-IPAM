/**
 * Reti del trunk nel wizard (28/10): cosa si propone sotto la rete nativa e
 * quando una riga scelta non va.
 *
 * Run: node --import tsx --test src/lib/onboarding/__tests__/reti-trunk.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { erroriScelte, proposteTrunk, siSovrappongono, type ReteTrunkVista } from "@/lib/onboarding/reti-trunk";

const rete = (vid: number, cidr: string, dispositivi = 3, gateway_ip: string | null = null): ReteTrunkVista => ({
  vid, cidr, gateway_ip, maschera: "dedotta", dispositivi,
});

test("sovrapposizione: contenute, uguali, vicine", () => {
  assert.equal(siSovrappongono("10.0.0.0/22", "10.0.2.0/24"), true);
  assert.equal(siSovrappongono("10.0.2.0/24", "10.0.2.0/24"), true);
  assert.equal(siSovrappongono("10.0.4.0/24", "10.0.0.0/22"), false);
  assert.equal(siSovrappongono("storta", "10.0.0.0/24"), false);
});

test("la rete nativa del wizard non si ripropone; le esistenti restano segnate", () => {
  const p = proposteTrunk(
    [rete(0, "192.168.1.0/24", 40), rete(20, "10.20.0.0/24", 5, "10.20.0.1"), rete(30, "10.30.0.0/24", 12)],
    [{ id: 7, name: "Server", cidr: "10.30.0.0/24" }],
    "192.168.1.0/24",
  );
  assert.deepEqual(p.map((x) => x.cidr), ["10.30.0.0/24", "10.20.0.0/24"], "più dispositivi prima, senza la nativa");
  assert.deepEqual(p[0].esistente, { id: 7, name: "Server" });
  assert.equal(p[1].esistente, null);
  assert.equal(p[1].nome, "VLAN 20");
  assert.equal(p[1].gateway, "10.20.0.1");
});

test("senza rete nativa scritta la VLAN senza tag si propone per prima", () => {
  const p = proposteTrunk([rete(20, "10.20.0.0/24", 50), rete(0, "192.168.1.0/24", 2)], [], null);
  assert.deepEqual(p.map((x) => [x.vid, x.nome]), [[0, "VLAN nativa 192.168.1.0/24"], [20, "VLAN 20"]]);
});

test("righe scelte: nome, rete, maschera, gateway, sovrapposizioni", () => {
  const ok = { vid: 20, cidr: "10.20.0.0/24", gateway: "10.20.0.1", nome: "Uffici" };
  assert.deepEqual(erroriScelte([ok], "192.168.1.0/24"), [null]);
  const [e1, e2, e3, e4, e5, e6] = erroriScelte(
    [
      { ...ok, nome: " " },
      { ...ok, cidr: "10.20.0.0" },
      { ...ok, cidr: "10.0.0.0/8" },
      { ...ok, cidr: "10.20.0.5/24" },
      { ...ok, cidr: "10.21.0.0/24", gateway: "10.20.0.1" },
      { ...ok, cidr: "192.168.1.0/25", gateway: "" },
    ],
    "192.168.1.0/24",
  );
  assert.match(e1 ?? "", /nome/);
  assert.match(e2 ?? "", /rete non valida/);
  assert.match(e3 ?? "", /\/16 a \/30/);
  assert.match(e4 ?? "", /indirizzo di rete/);
  assert.match(e5 ?? "", /gateway non sta dentro/);
  assert.match(e6 ?? "", /rete nativa/);
  const doppie = erroriScelte([ok, { ...ok, nome: "Doppione", cidr: "10.20.0.0/23", gateway: "" }], null);
  assert.match(doppie[0] ?? "", /Doppione/);
});
