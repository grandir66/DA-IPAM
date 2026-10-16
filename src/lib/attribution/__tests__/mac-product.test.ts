// src/lib/attribution/__tests__/mac-product.test.ts
//
// Test PURI su `resolveMacProductMatch` (nessun I/O, fixture di righe passate
// a mano — niente hub.db coinvolto): coprono i casi TDD del piano (longest-
// prefix, hostname_pattern che matcha/non matcha, regex invalida ignorata,
// entry disabilitata ignorata, nessun match → null).
//
// Un test aggiuntivo di integrazione (`matchMacProduct` a 2 argomenti, contro
// il vero hub.db seedato da `seedBuiltinMacProductMap`) verifica il wiring
// end-to-end con un prefisso Ubiquiti reale (00156D, verificato sulla KB).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMacProductMatch, matchMacProduct } from "../mac-product";
import type { MacProductMapRow } from "@/lib/db-hub";

let _id = 1;
function row(overrides: Partial<MacProductMapRow> = {}): MacProductMapRow {
  return {
    id: _id++,
    mac_prefix: "AABBCC",
    hostname_pattern: null,
    vendor: "acme",
    product_family: null,
    category: null,
    confidence: 0.7,
    source: "domarc",
    enabled: 1,
    note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveMacProductMatch (puro)", () => {
  it("longest-prefix: una entry a 9 cifre vince su una a 6 cifre per lo stesso MAC", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", vendor: "generic-vendor", product_family: "Generico", category: "network" }),
      row({ mac_prefix: "AABBCCDDE", vendor: "specific-vendor", product_family: "Specifico", category: "network.switch" }),
    ];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", null);
    assert.deepEqual(m, { vendor: "specific-vendor", product_family: "Specifico", category: "network.switch", confidence: 0.7 });
  });

  it("longest-prefix: 7 cifre vince su 6 quando non c'è una entry a 9", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", product_family: "Livello-6" }),
      row({ mac_prefix: "AABBCCD", product_family: "Livello-7" }),
    ];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", null);
    assert.equal(m?.product_family, "Livello-7");
  });

  it("hostname_pattern che MATCHA l'hostname → riga applicata", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", hostname_pattern: "^ap-", product_family: "UniFi AP", category: "network.access_point" }),
    ];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", "ap-piano2");
    assert.deepEqual(m, { vendor: "acme", product_family: "UniFi AP", category: "network.access_point", confidence: 0.7 });
  });

  it("hostname_pattern che NON matcha l'hostname → riga ignorata, nessun'altra entry → null", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", hostname_pattern: "^ap-", product_family: "UniFi AP" }),
    ];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", "sw-core1");
    assert.equal(m, null);
  });

  it("hostname_pattern che non matcha, ma esiste una riga generica (senza pattern) sullo stesso prefisso → usa quella", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", hostname_pattern: "^ap-", product_family: "UniFi AP" }),
      row({ mac_prefix: "AABBCC", hostname_pattern: null, product_family: "Generico Acme" }),
    ];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", "sw-core1");
    assert.equal(m?.product_family, "Generico Acme");
  });

  it("hostname assente (null) con riga a hostname_pattern → non matcha, fallback a riga generica se presente", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", hostname_pattern: "^ap-", product_family: "UniFi AP" }),
      row({ mac_prefix: "AABBCC", hostname_pattern: null, product_family: "Generico" }),
    ];
    assert.equal(resolveMacProductMatch(entries, "AABBCCDDEEFF", null)?.product_family, "Generico");
  });

  it("pattern regex non compilabile → riga IGNORATA (nessuna eccezione), fallback alla riga generica", () => {
    const entries = [
      row({ mac_prefix: "AABBCC", hostname_pattern: "(unclosed", product_family: "Pattern rotto" }),
      row({ mac_prefix: "AABBCC", hostname_pattern: null, product_family: "Generico" }),
    ];
    assert.doesNotThrow(() => resolveMacProductMatch(entries, "AABBCCDDEEFF", "qualsiasi"));
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", "qualsiasi");
    assert.equal(m?.product_family, "Generico");
  });

  it("pattern regex non compilabile, nessuna riga generica alternativa → null (mai eccezione)", () => {
    const entries = [row({ mac_prefix: "AABBCC", hostname_pattern: "(unclosed", product_family: "Pattern rotto" })];
    assert.doesNotThrow(() => resolveMacProductMatch(entries, "AABBCCDDEEFF", "qualsiasi"));
    assert.equal(resolveMacProductMatch(entries, "AABBCCDDEEFF", "qualsiasi"), null);
  });

  it("entry disabilitata (enabled=0) → ignorata, anche se il prefisso matcherebbe", () => {
    const entries = [row({ mac_prefix: "AABBCC", enabled: 0, product_family: "Disabilitata" })];
    assert.equal(resolveMacProductMatch(entries, "AABBCCDDEEFF", null), null);
  });

  it("entry disabilitata al prefisso più lungo → si prova comunque il prefisso più corto", () => {
    const entries = [
      row({ mac_prefix: "AABBCCDDE", enabled: 0, product_family: "Disabilitata (9 cifre)" }),
      row({ mac_prefix: "AABBCC", enabled: 1, product_family: "Attiva (6 cifre)" }),
    ];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", null);
    assert.equal(m?.product_family, "Attiva (6 cifre)");
  });

  it("nessun match → null", () => {
    const entries = [row({ mac_prefix: "FFEEDD" })];
    assert.equal(resolveMacProductMatch(entries, "AABBCCDDEEFF", null), null);
  });

  it("categoria non valida in DB → toMatch la annulla (category: null), non propaga uno slug sporco", () => {
    const entries = [row({ mac_prefix: "AABBCC", category: "not-a-real-category" })];
    const m = resolveMacProductMatch(entries, "AABBCCDDEEFF", null);
    assert.equal(m?.category, null);
  });
});

describe("matchMacProduct (integrazione contro il vero hub.db, seed Ubiquiti)", () => {
  // Prefisso OUI reale Ubiquiti (verificato su data/attribution-kb.sqlite) seedato
  // da seedBuiltinMacProductMap in db-hub.ts con hostname_pattern "^ap-".
  it("MAC Ubiquiti noto + hostname 'ap-...' → UniFi AP / network.access_point", () => {
    const m = matchMacProduct("00:15:6D:AA:BB:CC", "ap-piano2");
    assert.ok(m, "atteso un match per il prefisso Ubiquiti seedato 00156D + hostname ap-*");
    assert.equal(m!.vendor, "ubiquiti");
    assert.equal(m!.product_family, "UniFi AP");
    assert.equal(m!.category, "network.access_point");
    assert.ok(m!.confidence <= 0.7, "il seed deve avere confidence <= 0.7");
  });

  it("MAC Ubiquiti noto ma hostname che non matcha nessun pattern seed → null (niente riga generica)", () => {
    assert.equal(matchMacProduct("00:15:6D:AA:BB:CC", "desktop-marco"), null);
  });

  it("MAC sconosciuto (nessun prefisso in mac_product_map) → null", () => {
    assert.equal(matchMacProduct("FF:FF:FF:11:22:33", "ap-piano2"), null);
  });

  it("MAC vuoto/non normalizzabile → null, nessuna eccezione", () => {
    assert.equal(matchMacProduct("", "ap-piano2"), null);
    assert.equal(matchMacProduct("not-a-mac", "ap-piano2"), null);
  });
});
