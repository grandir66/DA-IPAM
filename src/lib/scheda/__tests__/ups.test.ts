/**
 * Vista UPS (Riccardo, 09/11/2026: «DA-IPAM riconosce un UPS ma non ne legge lo stato»). Lettura UPS-MIB (RFC 1628) e
 * APC PowerNet, striscia e riquadri della scheda, tipo di scheda e tab. I walk qui hanno la forma vera che restituisce
 * `snmpSubwalkLimitedForDevice`: OID senza punto iniziale, numeri come number, stringhe come Buffer.
 *
 * Run: node --import tsx --test src/lib/scheda/__tests__/ups.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASI_UPS, buildUpsFromWalks, type UpsWalks } from "@/lib/devices/ups-acquisition";
import { resolveUpsKind } from "@/lib/devices/device-info";
import { caselleUps, fmtAutonomia, riquadriUps } from "@/lib/scheda/ups";
import { tabDelTipo, tipoScheda } from "@/lib/scheda/tipo-scheda";
import { UPS_MIB_OIDS } from "@/lib/scanner/snmp-vendor-profiles";
import type { NetworkDevice } from "@/types";

const b = (s: string) => Buffer.from(s, "utf-8");
type Row = { oid: string; value: unknown };

function walks(righe: Row[]): UpsWalks {
  const out = Object.fromEntries(Object.keys(BASI_UPS).map((k) => [k, [] as Row[]])) as UpsWalks;
  // Ogni riga va nel walk della base più lunga che la contiene, come farebbe il walk vero.
  const basi = (Object.entries(BASI_UPS) as Array<[keyof UpsWalks, string]>).sort((x, y) => y[1].length - x[1].length);
  for (const r of righe) {
    const k = basi.find(([, base]) => r.oid.startsWith(`${base}.`))?.[0];
    if (k) out[k].push(r);
  }
  return out;
}

const APC = "1.3.6.1.4.1.318.1.1.1";
const MIB = "1.3.6.1.2.1.33.1";

/** Smart-UPS APC su rete, batteria piena. */
const RIGHE_APC: Row[] = [
  { oid: `${APC}.1.1.1.0`, value: b("Smart-UPS 1500") },
  { oid: `${APC}.1.2.1.0`, value: b("UPS 09.3") },
  { oid: `${APC}.1.2.3.0`, value: b("AS1234567890") },
  { oid: `${APC}.2.1.1.0`, value: 2 },
  { oid: `${APC}.2.1.3.0`, value: b("03/15/24") },
  { oid: `${APC}.2.2.1.0`, value: 100 },
  { oid: `${APC}.2.2.2.0`, value: 27 },
  { oid: `${APC}.2.2.3.0`, value: 270000 }, // TimeTicks: 45 minuti
  { oid: `${APC}.2.2.4.0`, value: 1 },
  { oid: `${APC}.3.2.1.0`, value: 231 },
  { oid: `${APC}.3.2.4.0`, value: 50 },
  { oid: `${APC}.3.2.5.0`, value: 4 },
  { oid: `${APC}.4.1.1.0`, value: 2 },
  { oid: `${APC}.4.2.1.0`, value: 230 },
  { oid: `${APC}.4.2.3.0`, value: 38 },
  { oid: `${APC}.7.2.3.0`, value: 1 },
  { oid: `${APC}.7.2.4.0`, value: b("11/02/26") },
];

/** UPS con la sola RFC 1628, a batteria e in difficoltà. */
const RIGHE_MIB: Row[] = [
  { oid: `${MIB}.1.1.0`, value: b("EATON") },
  { oid: `${MIB}.1.2.0`, value: b("5PX 1500") },
  { oid: `${MIB}.1.3.0`, value: b("02.14.0026") },
  { oid: `${MIB}.2.1.0`, value: 3 },
  { oid: `${MIB}.2.2.0`, value: 300 },
  { oid: `${MIB}.2.3.0`, value: 7 },
  { oid: `${MIB}.2.4.0`, value: 22 },
  { oid: `${MIB}.2.5.0`, value: 245 },
  { oid: `${MIB}.2.7.0`, value: 30 },
  { oid: `${MIB}.3.3.1.2.1`, value: 0 },
  { oid: `${MIB}.4.1.0`, value: 5 },
  { oid: `${MIB}.4.2.0`, value: 500 },
  { oid: `${MIB}.4.4.1.2.1`, value: 229 },
  { oid: `${MIB}.4.4.1.4.1`, value: 900 },
  { oid: `${MIB}.4.4.1.5.1`, value: 85 },
  { oid: `${MIB}.6.1.0`, value: 2 },
  { oid: `${MIB}.7.3.0`, value: 3 },
  { oid: `${MIB}.7.4.0`, value: b("Battery failed self test") },
];

describe("lettura UPS (UPS-MIB + APC PowerNet)", () => {
  it("APC: modello, batteria, autonomia dai TimeTicks, rete, carico, ultimo test", () => {
    const s = buildUpsFromWalks(walks(RIGHE_APC));
    assert.deepEqual(s.sources, ["apc"]);
    assert.equal(s.manufacturer, "APC");
    assert.equal(s.model, "Smart-UPS 1500");
    assert.equal(s.serial, "AS1234567890");
    assert.equal(s.firmware, "UPS 09.3");
    assert.deepEqual(s.battery, {
      status: "normale", charge_pct: 100, runtime_min: 45, temperature_c: 27, voltage_v: null,
      replace_needed: false, last_replaced: "03/15/24", seconds_on_battery: null,
    });
    assert.equal(s.output_source, "rete");
    assert.equal(s.rete_presente, true);
    assert.deepEqual(s.input, { voltage_v: 231, frequency_hz: 50, fail_cause: "blackout" });
    assert.equal(s.output?.load_pct, 38);
    assert.deepEqual(s.last_test, { result: "superato", detail: null, date: "11/02/26" });
  });

  it("RFC 1628: batteria bassa, su batteria, carico alto, test fallito, allarmi", () => {
    const s = buildUpsFromWalks(walks(RIGHE_MIB));
    assert.deepEqual(s.sources, ["ups_mib"]);
    assert.equal(s.manufacturer, "EATON");
    assert.equal(s.model, "5PX 1500");
    assert.equal(s.battery?.status, "bassa");
    assert.equal(s.battery?.charge_pct, 22);
    assert.equal(s.battery?.runtime_min, 7);
    assert.equal(s.battery?.voltage_v, 24.5);
    assert.equal(s.battery?.seconds_on_battery, 300);
    assert.equal(s.output_source, "batteria");
    assert.equal(s.rete_presente, false);
    assert.equal(s.input?.frequency_hz, null);
    assert.deepEqual(s.output, { voltage_v: 229, frequency_hz: 50, load_pct: 85, power_w: 900 });
    assert.equal(s.last_test?.result, "errore");
    assert.equal(s.last_test?.detail, "Battery failed self test");
    assert.equal(s.alarms, 2);
  });

  it("con tutti e due i MIB vince APC, la RFC 1628 riempie i buchi", () => {
    const s = buildUpsFromWalks(walks([...RIGHE_APC, ...RIGHE_MIB]));
    assert.deepEqual(s.sources, ["ups_mib", "apc"]);
    assert.equal(s.model, "Smart-UPS 1500");
    assert.equal(s.manufacturer, "EATON");
    assert.equal(s.battery?.charge_pct, 100);
    assert.equal(s.battery?.voltage_v, 24.5);
    assert.equal(s.output?.power_w, 900);
  });

  it("nessun MIB risponde: snapshot vuoto, nessuna casella", () => {
    const s = buildUpsFromWalks(walks([]));
    assert.deepEqual(s.sources, []);
    assert.equal(s.battery?.charge_pct, null);
    assert.equal(s.rete_presente, null);
    assert.deepEqual(caselleUps(s).length, 0);
  });

  it("gli OID della RFC 1628 e di APC puntano ai campi giusti", () => {
    assert.equal(UPS_MIB_OIDS.upsEstimatedMinutesRemaining, "1.3.6.1.2.1.33.1.2.3.0");
    assert.equal(UPS_MIB_OIDS.upsEstimatedChargeRemaining, "1.3.6.1.2.1.33.1.2.4.0");
  });

  it("si legge come UPS per classificazione, tipo o profilo", () => {
    const d = (x: Partial<NetworkDevice>) => ({ classification: null, device_type: "switch", product_profile: null, ...x }) as NetworkDevice;
    assert.equal(resolveUpsKind(d({ classification: "ups" })), "ups");
    assert.equal(resolveUpsKind(d({ device_type: "ups" })), "ups");
    assert.equal(resolveUpsKind(d({ product_profile: "generic_ups" })), "ups");
    assert.equal(resolveUpsKind(d({ classification: "switch" })), null);
  });
});

describe("scheda UPS", () => {
  it("striscia: rete, batteria, autonomia, carico, test; l'attenzione segue le soglie", () => {
    const ok = caselleUps(buildUpsFromWalks(walks(RIGHE_APC)));
    assert.deepEqual(ok.map((c) => [c.etichetta, c.valore, !!c.attenzione]), [
      ["Rete elettrica", "presente", false],
      ["Batteria", "100%", false],
      ["Autonomia", "45 min", false],
      ["Carico", "38%", false],
      ["Ultimo test", "superato", false],
    ]);
    assert.ok(ok.every((c) => c.tab === "ups"));

    const male = caselleUps(buildUpsFromWalks(walks(RIGHE_MIB)));
    assert.deepEqual(male.map((c) => [c.etichetta, c.valore, !!c.attenzione]), [
      ["Rete elettrica", "assente", true],
      ["Batteria", "22%", true],
      ["Autonomia", "7 min", true],
      ["Carico", "85%", true],
      ["Ultimo test", "errore", true],
      ["Allarmi", "2", true],
    ]);
  });

  it("riquadri della tab: senza righe vuote, con le righe da guardare segnate", () => {
    const r = riquadriUps(buildUpsFromWalks(walks(RIGHE_MIB)));
    assert.deepEqual(r.map((x) => x.titolo), ["UPS", "Batteria", "Rete elettrica e uscita", "Ultimo test"]);
    const batteria = r.find((x) => x.titolo === "Batteria")!.righe;
    assert.deepEqual(batteria.find((x) => x.etichetta === "Stato"), { etichetta: "Stato", valore: "bassa", attenzione: true });
    assert.deepEqual(batteria.find((x) => x.etichetta === "Su batteria da"), { etichetta: "Su batteria da", valore: "5 min", attenzione: true });
    assert.equal(batteria.find((x) => x.etichetta === "Ultima sostituzione"), undefined);
  });

  it("autonomia in parole", () => {
    assert.equal(fmtAutonomia(0), "0 min");
    assert.equal(fmtAutonomia(59), "59 min");
    assert.equal(fmtAutonomia(60), "1 h");
    assert.equal(fmtAutonomia(85), "1 h 25 min");
  });

  it("tipo di scheda e tab: UPS per classificazione o per tipo, firewall per ogni marca", () => {
    const base = { gestito: true, vendor: "other", scan_target: null };
    assert.equal(tipoScheda({ ...base, classification: "ups", device_type: "switch" }), "ups");
    assert.equal(tipoScheda({ ...base, classification: null, device_type: "ups" }), "ups");
    assert.equal(tipoScheda({ ...base, classification: null, device_type: "stampante" }), "stampante");
    assert.equal(tipoScheda({ ...base, classification: null, device_type: "telecamera" }), "generico");
    assert.equal(tipoScheda({ ...base, classification: null, device_type: "switch", vendor: "fortinet" }), "firewall");
    assert.equal(tipoScheda({ ...base, classification: "server", device_type: "server", vendor: "paloalto" }), "firewall");
    assert.deepEqual(tabDelTipo("ups", { ruoli: [], haAd: false, haDipendenze: false, mikrotik: null }), ["panoramica", "ups", "sicurezza", "gestione", "storico"]);
  });
});
