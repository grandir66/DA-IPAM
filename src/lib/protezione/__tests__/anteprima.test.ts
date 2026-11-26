import { test } from "node:test";
import assert from "node:assert/strict";
import { anteprimaPolitica, gruppoDellaPorta, leggiFuori, passa } from "../anteprima";
import { POLITICA_VUOTA, type Politica } from "../politica";

const P: Politica = {
  sempre: ["198.51.100.0/27"],
  gruppi: { web: { aperto: false, indirizzi: ["192.0.2.0/24"] }, ssh: { aperto: false, indirizzi: [] }, console: { aperto: false, indirizzi: ["192.0.2.10"] }, dati: { aperto: true, indirizzi: [] } },
};

test("chi passa: NetBird e sempre ammessi ovunque, gli altri solo nel loro gruppo, mai su una porta fuori dai gruppi", () => {
  assert.equal(passa(P, "100.107.33.1", 22), true); // NetBird
  assert.equal(passa(P, "198.51.100.14", 9999), true); // sempre ammesso, anche fuori dai gruppi
  assert.equal(passa(P, "192.0.2.31", 443), true);
  assert.equal(passa(P, "192.0.2.31", 22), false);
  assert.equal(passa(P, "192.0.2.31", 7443), false);
  assert.equal(passa(P, "192.0.2.10", 7443), true);
  assert.equal(passa(P, "203.0.113.5", 514), true); // gruppo aperto a tutti
  assert.equal(passa(P, "203.0.113.5", 443), false);
  assert.equal(passa(P, "192.0.2.31", 10050), false); // porta fuori dai gruppi
  assert.equal(gruppoDellaPorta(3001), null);
});

test("anteprima: dice cosa entra e cosa esce, chi resterebbe fuori, e avvisa chi si sta chiudendo fuori", () => {
  const visti = [{ indirizzo: "192.0.2.31", porta: 443 }, { indirizzo: "192.0.2.31", porta: 22 }, { indirizzo: "203.0.113.77", porta: 443 }, { indirizzo: "100.107.1.1", porta: 22 }];
  const a = anteprimaPolitica(POLITICA_VUOTA, P, visti, "203.0.113.77");
  assert.deepEqual(a.cambi, ["Sempre ammessi: entra 198.51.100.0/27", "Pagina web: entra 192.0.2.0/24", "Console dei moduli: entra 192.0.2.10", "Ricezione dati: diventa aperto a tutti"]);
  assert.deepEqual(a.fuori.map((f) => `${f.indirizzo}:${f.porta}`), ["192.0.2.31:22", "203.0.113.77:443"]);
  assert.match(a.avvisi[0], /203\.0\.113\.77.*non aprirà più la pagina web/);
  assert.ok(a.avvisi.some((x) => x.startsWith("Ricezione dati resta aperto")));
  // Chi applica è in elenco: nessun avviso su di lui. Niente cambia: nessuna riga.
  assert.equal(anteprimaPolitica(P, P, [], "192.0.2.31").avvisi.some((x) => x.includes("Il tuo indirizzo")), false);
  assert.deepEqual(anteprimaPolitica(P, P, [], null).cambi, []);
  // Togliere una voce si dice.
  assert.deepEqual(anteprimaPolitica(P, { ...P, sempre: [] }, [], null).cambi, ["Sempre ammessi: esce 198.51.100.0/27"]);
});

test("set dei visti: la forma vera di `nft -j list set` con il timeout, e un testo che non è JSON dà un elenco vuoto", () => {
  // Forma letta sull'appliance di laboratorio (nftables 1.1.3), indirizzi sostituiti.
  const json = JSON.stringify({ nftables: [{ metainfo: { version: "1.1.3" } }, { set: { family: "inet", name: "fuori4", table: "daipam_accessi", type: ["ipv4_addr", "inet_service"], elem: [
    { elem: { val: { concat: ["192.0.2.63", 7443] }, timeout: 604800, expires: 604700 } },
    { elem: { val: { concat: ["192.0.2.63", 22] }, timeout: 604800, expires: 604700 } },
  ] } }] });
  assert.deepEqual(leggiFuori(json), [{ indirizzo: "192.0.2.63", porta: 7443 }, { indirizzo: "192.0.2.63", porta: 22 }]);
  assert.deepEqual(leggiFuori(JSON.stringify({ nftables: [{ set: { name: "fuori4", elem: [{ concat: ["192.0.2.1", 443] }] } }] })), [{ indirizzo: "192.0.2.1", porta: 443 }]);
  assert.deepEqual(leggiFuori("Error: No such file or directory"), []);
  assert.deepEqual(leggiFuori(JSON.stringify({ nftables: [{ set: { name: "fuori4" } }] })), []);
});
