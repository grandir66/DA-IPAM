/**
 * Marca di un apparato sotto «Altro»: i nomi sono quelli veri letti sulla sonda 72729 il 04/11/2026.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/marca-rilevata.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { marcaRilevata, nomeMarca } from "@/lib/devices/marca-rilevata";

describe("marcaRilevata", () => {
  it("il GS1900: dal nome breve della scansione", () => {
    const host = { inferred_vendor: "zyxel", device_manufacturer: "Zyxel Communications Corporation", vendor: "Zyxel Communications Corporation" };
    assert.equal(marcaRilevata(host), "Zyxel");
  });

  it("gli altri apparati «Altro» del 72729", () => {
    assert.equal(marcaRilevata({ inferred_vendor: "epson", device_manufacturer: "Epson", vendor: "Seiko Epson Corporation" }), "Epson");
    assert.equal(marcaRilevata({ inferred_vendor: "kyocera", device_manufacturer: "KYOCERA Display Corporation" }), "Kyocera");
    assert.equal(marcaRilevata({ inferred_vendor: "apc", device_manufacturer: "APC UPS", vendor: "American Power Conversion Corp" }), "APC");
  });

  it("senza nome breve vale il produttore ripulito, poi il vendor dell'host", () => {
    assert.equal(marcaRilevata({ device_manufacturer: "Zyxel Communications Corporation" }), "Zyxel");
    assert.equal(marcaRilevata({ device_manufacturer: "", vendor: "TP-Link Systems Inc." }), "TP-Link");
  });

  it("nessuna fonte: nessuna marca, mai una indovinata", () => {
    assert.equal(marcaRilevata({}), null);
    assert.equal(marcaRilevata({ inferred_vendor: " ", device_manufacturer: null, vendor: "" }), null);
  });
});

describe("nomeMarca", () => {
  const CASI: Array<[string, string]> = [
    ["Microchip Technology Inc.", "Microchip"],
    ["CREVIS Co., LTD", "CREVIS"],
    ["Weintek Labs. Inc.", "Weintek"],
    ["VMware, Inc.", "VMware"],
    ["Vacon Plc", "Vacon"],
    ["Kronotech Srl", "Kronotech"],
    ["Cisco Systems, Inc", "Cisco"],
    ["Sollae Systems Co., Ltd.", "Sollae"],
    ["Shanghai B&A Technology Co., Ltd", "Shanghai B&A"],
    ["D-Link International", "D-Link"],
    ["Raspberry Pi Foundation", "Raspberry Pi"],
    ["SolarEdge Technologies", "SolarEdge"],
    ["Unify Software and Solutions GmbH & Co. KG", "Unify Software and Solutions"],
    ["Schneider Electric Japan Holdings Ltd.", "Schneider Electric Japan"],
  ];
  for (const [produttore, atteso] of CASI) {
    it(`${produttore} → ${atteso}`, () => assert.equal(nomeMarca(produttore), atteso));
  }

  it("un nome senza ragione sociale resta com'è", () => {
    assert.equal(nomeMarca("Control Techniques"), "Control Techniques");
    assert.equal(nomeMarca("Teltonika"), "Teltonika");
    assert.equal(nomeMarca("Hewlett Packard"), "Hewlett Packard");
    assert.equal(nomeMarca("HMS Industrial Networks"), "HMS Industrial Networks");
  });

  it("non svuota mai il nome", () => {
    assert.equal(nomeMarca("Limited"), "Limited");
    assert.equal(nomeMarca("Systems"), "Systems");
  });
});
