/**
 * L'account come lo vede il dominio: il limite di 3 conta i logon errati di un account, non le voci che lo contengono, e
 * una password che il DC ha detto errata non si riprova al giro dopo.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/account-windows.test.ts
 */
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chiaveAccount, ricordoDelTenant, RicordoErrate, utenteNormalizzato, VALIDITA_ERRATA_MS } from "../account-windows";

describe("utenteNormalizzato", () => {
  const casi: Array<[string, string]> = [
    ["DOM\\Mario", "mario@dom"],
    ["dom\\mario", "mario@dom"],
    ["Mario@Dom.Local", "mario@dom"],
    ["  mario@dom.local  ", "mario@dom"],
    ["mario", "mario"],
    [".\\mario", "mario"],
    ["localhost\\mario", "mario"],
  ];
  for (const [scritto, atteso] of casi) {
    it(`«${scritto}» → «${atteso}»`, () => assert.equal(utenteNormalizzato(scritto), atteso));
  }
});

describe("chiaveAccount", () => {
  it("stesso account in due forme: stessa chiave", () => {
    assert.equal(chiaveAccount("DOM\\mario", "Segreta!1"), chiaveAccount("mario@dom.local", "Segreta!1"));
  });

  it("password diversa, utente diverso: chiave diversa", () => {
    assert.notEqual(chiaveAccount("DOM\\mario", "Segreta!1"), chiaveAccount("DOM\\mario", "Segreta!2"));
    assert.notEqual(chiaveAccount("DOM\\mario", "Segreta!1"), chiaveAccount("DOM\\luigi", "Segreta!1"));
  });

  it("la chiave non porta la password, nemmeno come SHA-256 semplice: c'è il sale", () => {
    const chiave = chiaveAccount("DOM\\mario", "Segreta!1");
    assert.ok(!chiave.includes("Segreta!1"));
    assert.ok(!chiave.includes(createHash("sha256").update("Segreta!1").digest("hex")));
  });
});

describe("RicordoErrate", () => {
  function conOrologio() {
    const ora = { ms: 1_000_000 };
    return { ora, ricordo: new RicordoErrate(() => ora.ms) };
  }

  it("ricorda per 30 minuti, poi dimentica", () => {
    const { ora, ricordo } = conOrologio();
    ricordo.segna("a");
    assert.equal(ricordo.ricorda("a"), true);
    ora.ms += VALIDITA_ERRATA_MS - 1;
    assert.equal(ricordo.ricorda("a"), true);
    ora.ms += 1;
    assert.equal(ricordo.ricorda("a"), false);
    assert.equal(VALIDITA_ERRATA_MS, 30 * 60 * 1000);
  });

  it("leggere non allunga la scadenza: un giro ogni 5 minuti non la terrebbe viva per sempre", () => {
    const { ora, ricordo } = conOrologio();
    ricordo.segna("a");
    for (let i = 0; i < 5; i++) {
      ora.ms += 5 * 60 * 1000;
      ricordo.ricorda("a");
    }
    ora.ms += 5 * 60 * 1000;
    assert.equal(ricordo.ricorda("a"), false);
  });

  it("una chiave mai vista non c'è", () => {
    assert.equal(conOrologio().ricordo.ricorda("b"), false);
  });

  it("per tenant: quello che sa un cliente non vale per un altro, e lo stesso tenant ha lo stesso ricordo", () => {
    ricordoDelTenant("ACCWIN-A").segna("a");
    assert.equal(ricordoDelTenant("ACCWIN-A").ricorda("a"), true);
    assert.equal(ricordoDelTenant("ACCWIN-B").ricorda("a"), false);
  });
});
