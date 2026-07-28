// Test contro l'artefatto REALE e committato `data/attribution-kb.sqlite` (Task 1):
// `npm test` gira con cwd = repo root, quindi `kb.ts` (che risolve il path come
// `<cwd>/data/attribution-kb.sqlite`, vedi commento in testa a kb.ts) apre qui
// davvero il file da 5+ MB con 57.778 prefissi OUI e 9.554 sysObjectID.
//
// I prefissi/OID usati sotto sono stati scelti interrogando l'artefatto con
// sqlite3 (2026-07-28), non inventati:
//   sqlite3 data/attribution-kb.sqlite "select prefix,bits,vendor_name from oui where prefix='000001';"
//   sqlite3 data/attribution-kb.sqlite "select prefix,bits,vendor_name from oui where prefix='0055DA0';"
//   sqlite3 data/attribution-kb.sqlite "select prefix,bits,vendor_name from oui where prefix='001BC5000';"
//   sqlite3 data/attribution-kb.sqlite "select oid,vendor,glpi_type,model from sysobj where oid like '1.3.6.1.4.1.14988%';"
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kbAvailable, kbVersion, kbLookupMac, kbLookupSysObjectId } from "../kb";

describe("kb.ts — contro l'artefatto reale committato", () => {
  it("kbAvailable(): l'artefatto committato è presente e apribile", () => {
    assert.equal(kbAvailable(), true);
  });

  it("kbVersion(): torna la data ISO di generazione da kb_meta", () => {
    const v = kbVersion();
    assert.ok(v, "kbVersion() non deve essere null quando la KB è disponibile");
    assert.match(v!, /^\d{4}-\d{2}-\d{2}T/);
  });

  describe("kbLookupMac", () => {
    it("prefisso 24 bit reale (000001 → Xerox Corporation)", () => {
      const m = kbLookupMac("00:00:01:AA:BB:CC");
      assert.deepEqual(m, { vendor_name: "Xerox Corporation", vendor_short: "Xerox", bits: 24 });
    });

    it("prefisso 28 bit reale MA-M (0055DA0 → Shinko Technos co.,ltd.)", () => {
      const m = kbLookupMac("00:55:DA:0A:BB:CC");
      assert.deepEqual(m, { vendor_name: "Shinko Technos co.,ltd.", vendor_short: "ShinkoTechno", bits: 28 });
    });

    it("prefisso 36 bit reale MA-S (001BC5000 → Converging Systems Inc.)", () => {
      const m = kbLookupMac("00:1B:C5:00:0A:BC");
      assert.deepEqual(m, { vendor_name: "Converging Systems Inc.", vendor_short: "Converging", bits: 36 });
    });

    it("MAC sconosciuto (prefisso FFFFFF non allocato) → null", () => {
      assert.equal(kbLookupMac("FF:FF:FF:00:11:22"), null);
    });

    it("input vuoto o non esadecimale → null, nessuna eccezione", () => {
      assert.equal(kbLookupMac(""), null);
      assert.equal(kbLookupMac("not-a-mac"), null);
    });
  });

  describe("kbLookupSysObjectId", () => {
    it("OID relativo (14988 MikroTik) → antepone l'arco enterprise, vendor+categoria", () => {
      const m = kbLookupSysObjectId("14988");
      assert.deepEqual(m, { vendor: "Mikrotik", model: null, category: "network" });
    });

    it("OID assoluto profondo (1.3.6.1.4.1.14988.2.55) → longest-prefix su .14988.2 (modello RB260GS)", () => {
      const m = kbLookupSysObjectId("1.3.6.1.4.1.14988.2.55");
      assert.deepEqual(m, { vendor: "Mikrotik", model: "RB260GS", category: "network" });
    });

    it("OID assoluto su arco non-enterprise (1.2.826...) → match diretto, TYPE STORAGE → categoria storage", () => {
      const m = kbLookupSysObjectId("1.2.826.0.1.4616240.1.1.4500");
      assert.deepEqual(m, { vendor: "Cisco", model: "ciscoMCU4500", category: "storage" });
    });

    it("prefisso enterprises. e MIB:: vengono normalizzati come in snmp-sysobj-lookup.ts", () => {
      assert.deepEqual(kbLookupSysObjectId("enterprises.14988"), { vendor: "Mikrotik", model: null, category: "network" });
      assert.deepEqual(kbLookupSysObjectId("SNMPv2-SMI::enterprises.14988"), { vendor: "Mikrotik", model: null, category: "network" });
    });

    it("OID sconosciuto → null", () => {
      // Forma già assoluta (comincia per 1.3.6.1.4.1.) con un enterprise number
      // inesistente: niente fallback relativo, niente ancestor reale da matchare
      // (verificato con sqlite3: né ".999999999", né la sola radice "1.3.6.1.4.1"
      // esistono in sysobj — a differenza di "1.3.6.1.4.1.9", il root Cisco reale).
      assert.equal(kbLookupSysObjectId("1.3.6.1.4.1.999999999.1.2.3"), null);
    });

    it("input vuoto o non numerico → null, nessuna eccezione", () => {
      assert.equal(kbLookupSysObjectId(""), null);
      assert.equal(kbLookupSysObjectId("not-an-oid"), null);
    });
  });
});
