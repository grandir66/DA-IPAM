/**
 * La prova di una credenziale verso un indirizzo (terzo giro di sicurezza, 16/11/2026). La rotta prendeva
 * l'indirizzo dal corpo e ci provava la credenziale: chi amministrava l'interfaccia la faceva arrivare in
 * chiaro a una macchina sua. Ora l'indirizzo deve stare in una rete dell'inventario o essere già conosciuto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bersaglioProvaAmmesso } from "../bersaglio-prova";

const noto = { reti: ["192.168.10.0/24", "10.0.0.0/16"], nomi: ["sw-core.lan", "172.16.5.9", "FW01"] };

test("un indirizzo dentro una rete dell'inventario passa", () => {
  assert.equal(bersaglioProvaAmmesso("192.168.10.77", noto), true);
  assert.equal(bersaglioProvaAmmesso("10.0.200.1", noto), true);
});

test("un indirizzo fuori da ogni rete e non conosciuto è rifiutato", () => {
  assert.equal(bersaglioProvaAmmesso("203.0.113.50", noto), false);
  assert.equal(bersaglioProvaAmmesso("192.168.11.1", noto), false);
  assert.equal(bersaglioProvaAmmesso("server-di-un-altro.example.com", noto), false);
});

test("un host o un apparato già in inventario passa, per indirizzo o per nome", () => {
  assert.equal(bersaglioProvaAmmesso("172.16.5.9", noto), true);
  assert.equal(bersaglioProvaAmmesso("SW-CORE.lan", noto), true);
  assert.equal(bersaglioProvaAmmesso("fw01", noto), true);
});

test("forme strane non passano: indirizzo con spazi, vuoto, rete malformata in inventario", () => {
  assert.equal(bersaglioProvaAmmesso("", noto), false);
  assert.equal(bersaglioProvaAmmesso("192.168.10.7 203.0.113.5", noto), false);
  assert.equal(bersaglioProvaAmmesso("999.1.1.1", noto), false);
  assert.equal(bersaglioProvaAmmesso("192.168.10.7", { reti: ["non-una-rete"], nomi: [] }), false);
});
