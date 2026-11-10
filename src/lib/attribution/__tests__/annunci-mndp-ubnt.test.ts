/**
 * MNDP e scoperta Ubiquiti come prove di riconoscimento (10/11/2026): non dichiarano capacità,
 * il mestiere si legge dal modello annunciato. Modelli veri sentiti sul trunk dell'hub.
 * Run: node --import tsx --test src/lib/attribution/__tests__/annunci-mndp-ubnt.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoriaDaAnnuncio } from "../emitters";

const a = (protocollo: string, piattaforma: string | null) => ({ protocollo, piattaforma, capacita: null });

test("MNDP: router, switch e access point dal nome della scheda", () => {
  assert.equal(categoriaDaAnnuncio(a("mndp", "CCR2004-1G-12S+2XS")), "network.router");
  assert.equal(categoriaDaAnnuncio(a("mndp", "CRS504-4XQ")), "network.switch");
  assert.equal(categoriaDaAnnuncio(a("mndp", "cAP ax")), "network.access_point");
  assert.equal(categoriaDaAnnuncio(a("mndp", "scheda mai vista")), "network");
  assert.equal(categoriaDaAnnuncio(a("mndp", null)), null);
});

test("Ubiquiti: switch, access point e gateway dal modello", () => {
  assert.equal(categoriaDaAnnuncio(a("ubnt", "USF5P")), "network.switch");
  assert.equal(categoriaDaAnnuncio(a("ubnt", "USC8")), "network.switch");
  assert.equal(categoriaDaAnnuncio(a("ubnt", "U6-LR")), "network.access_point");
  assert.equal(categoriaDaAnnuncio(a("ubnt", "UDMPRO")), "network.router");
});

test("CDP e LLDP restano com'erano: il modello MikroTik non li tocca", () => {
  assert.equal(categoriaDaAnnuncio({ protocollo: "cdp", piattaforma: null, capacita: "bridge" }), "network.switch");
});
