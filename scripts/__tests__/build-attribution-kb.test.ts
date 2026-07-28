import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseManufLine,
  parseSysObjLine,
  normalizeMacPrefix,
  normalizeSysObjId,
} from "../build-attribution-kb";

// ─────────────────────────────────────────────────────────────────────────
// normalizeMacPrefix
// ─────────────────────────────────────────────────────────────────────────

test("normalizeMacPrefix: MA-L (24 bit) senza suffisso", () => {
  assert.deepEqual(normalizeMacPrefix("00:00:01"), { prefix: "000001", bits: 24 });
});

test("normalizeMacPrefix: /28 (MA-M) conserva 7 cifre esadecimali", () => {
  assert.deepEqual(normalizeMacPrefix("00:55:DA:00/28"), { prefix: "0055DA0", bits: 28 });
});

test("normalizeMacPrefix: /36 (MA-S) conserva 9 cifre esadecimali", () => {
  assert.deepEqual(normalizeMacPrefix("00:1B:C5:00:00/36"), { prefix: "001BC5000", bits: 36 });
});

test("normalizeMacPrefix: input vuoto o non esadecimale → null", () => {
  assert.equal(normalizeMacPrefix(""), null);
  assert.equal(normalizeMacPrefix("not-a-mac"), null);
});

test("normalizeMacPrefix: bits non tra 24/28/36 → null", () => {
  assert.equal(normalizeMacPrefix("00:00:01/30"), null);
});

// ─────────────────────────────────────────────────────────────────────────
// parseManufLine
// ─────────────────────────────────────────────────────────────────────────

test("parseManufLine: riga MA-L completa (3 campi)", () => {
  assert.deepEqual(parseManufLine("00:00:01\tXerox\tXerox Corporation"), {
    prefix: "000001",
    bits: 24,
    vendorShort: "Xerox",
    vendorName: "Xerox Corporation",
  });
});

test("parseManufLine: riga /28 (MA-M)", () => {
  assert.deepEqual(
    parseManufLine("00:55:DA:00/28\tShinkoTechno\tShinko Technos co.,ltd."),
    { prefix: "0055DA0", bits: 28, vendorShort: "ShinkoTechno", vendorName: "Shinko Technos co.,ltd." },
  );
});

test("parseManufLine: riga /36 (MA-S)", () => {
  assert.deepEqual(
    parseManufLine("00:1B:C5:00:00/36\tConverging\tConverging Systems Inc."),
    { prefix: "001BC5000", bits: 36, vendorShort: "Converging", vendorName: "Converging Systems Inc." },
  );
});

test("parseManufLine: riga a 2 campi (nome completo assente → usa nome breve)", () => {
  assert.deepEqual(parseManufLine("00:00:02\tXerox"), {
    prefix: "000002",
    bits: 24,
    vendorShort: "Xerox",
    vendorName: "Xerox",
  });
});

test("parseManufLine: riga commento → null", () => {
  assert.equal(parseManufLine("# questo è un commento"), null);
});

test("parseManufLine: riga malformata → null", () => {
  assert.equal(parseManufLine("questa riga non è TSV valido"), null);
  assert.equal(parseManufLine(""), null);
  assert.equal(parseManufLine("00:00:03"), null); // manca il nome breve
});

// ─────────────────────────────────────────────────────────────────────────
// normalizeSysObjId
// ─────────────────────────────────────────────────────────────────────────

test("normalizeSysObjId: id relativo → antepone l'arco enterprise", () => {
  assert.equal(normalizeSysObjId("14988"), "1.3.6.1.4.1.14988");
});

test("normalizeSysObjId: id assoluto (1.3.6.1...) resta invariato", () => {
  assert.equal(normalizeSysObjId("1.3.6.1.4.1.9.1.1"), "1.3.6.1.4.1.9.1.1");
});

test("normalizeSysObjId: id assoluto su arco iso.member-body (1.2.) resta invariato", () => {
  assert.equal(
    normalizeSysObjId("1.2.826.0.1.4616240.1.1.4500"),
    "1.2.826.0.1.4616240.1.1.4500",
  );
});

test("normalizeSysObjId: id non numerico → null", () => {
  assert.equal(normalizeSysObjId("abc"), null);
  assert.equal(normalizeSysObjId(""), null);
});

// ─────────────────────────────────────────────────────────────────────────
// parseSysObjLine
// ─────────────────────────────────────────────────────────────────────────

test("parseSysObjLine: riga relativa completa", () => {
  assert.deepEqual(parseSysObjLine("14988\tMikroTik\tNETWORKING\tRouterOS generic\tMikrotik"), {
    oid: "1.3.6.1.4.1.14988",
    vendor: "MikroTik",
    glpiType: "NETWORKING",
    model: "RouterOS generic",
  });
});

test("parseSysObjLine: riga con OID assoluto", () => {
  assert.deepEqual(
    parseSysObjLine("1.2.826.0.1.4616240.1.1.4500\tCisco\tSTORAGE\tciscoMCU4500"),
    { oid: "1.2.826.0.1.4616240.1.1.4500", vendor: "Cisco", glpiType: "STORAGE", model: "ciscoMCU4500" },
  );
});

test("parseSysObjLine: riga senza modello", () => {
  assert.deepEqual(parseSysObjLine("11\tHewlett-Packard"), {
    oid: "1.3.6.1.4.1.11",
    vendor: "Hewlett-Packard",
    glpiType: null,
    model: null,
  });
});

test("parseSysObjLine: riga con TYPE sconosciuto viene comunque accettata (mapping a categoria è fuori scope qui)", () => {
  assert.deepEqual(parseSysObjLine("999\tAcme\tGADGET\tThing 3000"), {
    oid: "1.3.6.1.4.1.999",
    vendor: "Acme",
    glpiType: "GADGET",
    model: "Thing 3000",
  });
});

test("parseSysObjLine: riga commento o malformata → null", () => {
  assert.equal(parseSysObjLine("# commento"), null);
  assert.equal(parseSysObjLine(""), null);
  assert.equal(parseSysObjLine("abc\tVendorSenzaOidNumerico\tNETWORKING"), null);
});
