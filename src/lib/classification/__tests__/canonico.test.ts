/**
 * Catalogo canonico delle classificazioni (decisioni V3-V6, 21/10): gli slug doppi
 * diventano un solo slug + vendor o ruolo del server.
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/classification/__tests__/canonico.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalizza, unisciRuoli, RUOLI_SERVER, ETICHETTE_RUOLI } from "../canonico";

describe("canonicalizza", () => {
  const casi: Array<[string, string, string | null, string | null]> = [
    ["server_windows", "server", "windows", null],
    ["server_linux", "server", "linux", null],
    ["nas_synology", "nas", "synology", null],
    ["nas_qnap", "nas", "qnap", null],
    ["storage", "nas", null, null],
    ["controller", "network_controller", null, null],
    ["controller_wifi", "network_controller", null, null],
    ["fotocopiatrice", "multifunzione", null, null],
    ["ont", "modem", null, null],
    ["dns_server", "server", null, "dns"],
    ["dhcp_server", "server", null, "dhcp"],
    ["mail_server", "server", null, "mail"],
    ["web_server", "server", null, "web"],
    ["database_server", "server", null, "database"],
    ["backup_server", "server", null, "backup"],
    ["nfs_server", "server", null, "nfs"],
  ];
  for (const [vecchio, nuovo, vendor, ruolo] of casi) {
    it(`${vecchio} -> ${nuovo}`, () => {
      assert.deepEqual(canonicalizza(vecchio), { classificazione: nuovo, vendor, ruolo });
    });
  }
  it("slug canonico o sconosciuto resta invariato", () => {
    for (const s of ["server", "nas", "router", "mio_custom"]) {
      assert.deepEqual(canonicalizza(s), { classificazione: s, vendor: null, ruolo: null });
    }
  });
  it("null e vuoto -> unknown (come l'insert di upsertHost)", () => {
    assert.equal(canonicalizza(null).classificazione, "unknown");
    assert.equal(canonicalizza("").classificazione, "unknown");
    assert.equal(canonicalizza(undefined).classificazione, "unknown");
  });
});

describe("unisciRuoli", () => {
  it("aggiunge, ordina e toglie i doppioni", () => {
    assert.equal(unisciRuoli(null, "dns"), '["dns"]');
    assert.equal(unisciRuoli('["web"]', "dns"), '["dns","web"]');
    assert.equal(unisciRuoli('["dns"]', "dns"), '["dns"]');
  });
  it("senza ruolo nuovo lascia com'e'; JSON rotto riparte da vuoto", () => {
    assert.equal(unisciRuoli('["web"]', null), '["web"]');
    assert.equal(unisciRuoli(null, null), null);
    assert.equal(unisciRuoli("rotto", "mail"), '["mail"]');
  });
});

describe("etichette dei ruoli", () => {
  it("una per ruolo", () => {
    for (const r of RUOLI_SERVER) assert.ok(ETICHETTE_RUOLI[r]);
    assert.equal(ETICHETTE_RUOLI.mail, "Posta");
    assert.equal(ETICHETTE_RUOLI.dc, "Domain controller");
  });
});
