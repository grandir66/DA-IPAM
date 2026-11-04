/**
 * Collector stampanti (Printer-MIB RFC 3805): assemblaggio dello snapshot dai walk SNMP, con righe
 * sintetiche (nessun IP/MAC reale). Copre modello/seriale, contatore, materiali coi livelli e il
 * colore del colorante, un materiale quasi esaurito, i vassoi, lo stato e gli errori (bitmask).
 * Più resolvePrinterKind e il tipo scheda.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/printer-acquisition.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrinterSnmpFromWalks, type PrinterWalks } from "../printer-acquisition";
import { resolvePrinterKind } from "../device-info";
import { tipoScheda } from "@/lib/scheda/tipo-scheda";
import { caselleStampante, materialiOrdinati, coloreMateriale, materialeInAllarme } from "@/lib/scheda/stampante";
import type { NetworkDevice } from "@/types";

const r = (oid: string, value: unknown) => ({ oid, value });

/** Laser a colori: nero all'85%, ciano al 5% (quasi esaurito), 45.230 pagine, poco toner. */
function walksColorLaser(): PrinterWalks {
  return {
    generalRows: [
      r("1.3.6.1.2.1.43.5.1.1.16.1", "HP Color LaserJet"),
      r("1.3.6.1.2.1.43.5.1.1.17.1", "SN-ABC-123"),
    ],
    lifeRows: [r("1.3.6.1.2.1.43.10.2.1.4.1.1", 45230)],
    supplyRows: [
      // materiale 1 = nero
      r("1.3.6.1.2.1.43.11.1.1.5.1.1", 3), r("1.3.6.1.2.1.43.11.1.1.6.1.1", "Black Toner"),
      r("1.3.6.1.2.1.43.11.1.1.8.1.1", 1000), r("1.3.6.1.2.1.43.11.1.1.9.1.1", 850), r("1.3.6.1.2.1.43.11.1.1.10.1.1", 1),
      // materiale 2 = ciano (quasi esaurito)
      r("1.3.6.1.2.1.43.11.1.1.5.1.2", 3), r("1.3.6.1.2.1.43.11.1.1.6.1.2", "Cyan Toner"),
      r("1.3.6.1.2.1.43.11.1.1.8.1.2", 1000), r("1.3.6.1.2.1.43.11.1.1.9.1.2", 50), r("1.3.6.1.2.1.43.11.1.1.10.1.2", 2),
    ],
    colorantRows: [
      r("1.3.6.1.2.1.43.12.1.1.4.1.1", "black"),
      r("1.3.6.1.2.1.43.12.1.1.4.1.2", "cyan"),
    ],
    inputRows: [
      r("1.3.6.1.2.1.43.8.2.1.9.1.1", 500), r("1.3.6.1.2.1.43.8.2.1.10.1.1", 250),
      r("1.3.6.1.2.1.43.8.2.1.12.1.1", "A4"), r("1.3.6.1.2.1.43.8.2.1.13.1.1", "Vassoio 1"),
    ],
    statusRows: [r("1.3.6.1.2.1.25.3.5.1.1.1", 3)],
    errorRows: [r("1.3.6.1.2.1.25.3.5.1.2.1", Buffer.from([0x20]))], // bit "poco toner"
    alertRows: [],
  };
}

test("assembla modello, seriale e contatore pagine", () => {
  const s = buildPrinterSnmpFromWalks(walksColorLaser()).snmp!;
  assert.equal(s.model, "HP Color LaserJet");
  assert.equal(s.serial, "SN-ABC-123");
  assert.equal(s.total_pages, 45230);
  assert.equal(s.status, "pronta");
});

test("materiali: livelli %, colorante e quasi esaurito", () => {
  const s = buildPrinterSnmpFromWalks(walksColorLaser()).snmp!;
  const nero = s.supplies!.find((x) => x.colorant === "black")!;
  const ciano = s.supplies!.find((x) => x.colorant === "cyan")!;
  assert.equal(nero.level_pct, 85);
  assert.equal(nero.quasi_esaurito, false);
  assert.equal(ciano.level_pct, 5);
  assert.equal(ciano.quasi_esaurito, true);
  assert.equal(nero.type, "toner");
});

test("errori dalla bitmask hrPrinterDetectedErrorState", () => {
  const s = buildPrinterSnmpFromWalks(walksColorLaser()).snmp!;
  assert.ok(s.errors!.includes("poco toner"));
});

test("vassoi con livello", () => {
  const s = buildPrinterSnmpFromWalks(walksColorLaser()).snmp!;
  assert.equal(s.trays!.length, 1);
  assert.equal(s.trays![0].level_pct, 50);
  assert.equal(s.trays![0].media, "A4");
});

test("livello ignoto (-3 = ancora disponibile) non diventa %", () => {
  const w = walksColorLaser();
  w.supplyRows = [
    r("1.3.6.1.2.1.43.11.1.1.6.1.1", "Drum"),
    r("1.3.6.1.2.1.43.11.1.1.8.1.1", -2), r("1.3.6.1.2.1.43.11.1.1.9.1.1", -3),
  ];
  const s = buildPrinterSnmpFromWalks(w).snmp!;
  assert.equal(s.supplies![0].level_pct, null);
  assert.equal(s.supplies![0].quasi_esaurito, false);
});

test("nessuna risposta Printer-MIB → snapshot vuoto ma con fonte snmp", () => {
  const empty: PrinterWalks = {
    generalRows: [], lifeRows: [], supplyRows: [], colorantRows: [], inputRows: [], statusRows: [], errorRows: [], alertRows: [],
  };
  const snap = buildPrinterSnmpFromWalks(empty);
  assert.deepEqual(snap.sources, ["snmp"]);
  assert.equal(snap.snmp!.model, null);
  assert.equal(snap.snmp!.supplies, undefined);
});

test("resolvePrinterKind dalla classificazione (non dal vendor slug)", () => {
  const d = (p: Partial<NetworkDevice>) => p as NetworkDevice;
  assert.equal(resolvePrinterKind(d({ classification: "stampante" })), "printer");
  assert.equal(resolvePrinterKind(d({ classification: "multifunzione" })), "printer");
  assert.equal(resolvePrinterKind(d({ classification: "fotocopiatrice" })), "printer");
  assert.equal(resolvePrinterKind(d({ classification: "switch" })), null);
  // vendor "hp" da solo non basta (ambiguo coi PC): senza classificazione stampante → null
  assert.equal(resolvePrinterKind(d({ vendor: "hp", classification: null })), null);
});

test("tipoScheda: stampante/multifunzione → scheda stampante", () => {
  const base = { gestito: true, device_type: null, vendor: null, scan_target: null };
  assert.equal(tipoScheda({ ...base, classification: "stampante" }), "stampante");
  assert.equal(tipoScheda({ ...base, classification: "multifunzione" }), "stampante");
  assert.equal(tipoScheda({ ...base, classification: "fotocopiatrice" }), "stampante");
});

test("helper scheda: ordine, colore, caselle", () => {
  const snap = buildPrinterSnmpFromWalks(walksColorLaser());
  const ordinati = materialiOrdinati(snap);
  assert.equal(ordinati[0].colorant, "cyan"); // il più basso in cima
  assert.equal(coloreMateriale(ordinati[0]), "#06B6D4");
  assert.ok(materialeInAllarme(ordinati[0]));
  const caselle = caselleStampante(snap);
  assert.ok(caselle.some((c) => c.etichetta === "Pagine totali" && c.valore.includes("45")));
  assert.ok(caselle.some((c) => c.etichetta === "Materiali" && c.attenzione));
});
