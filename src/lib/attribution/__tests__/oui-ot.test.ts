/**
 * Produttori OT dall'OUI (72729, 04/11/2026). L'attribuzione v2 è l'unico motore che scrive `hosts.classification`, e dall'OUI
 * prendeva solo il produttore: su 192.168.0.66 (Weintek) le evidenze erano `oui → vendor` e `ports → compute.workstation` (VNC),
 * su un CREVIS il solo vendor. Le regole di fingerprint della 0.9.959 vedevano «Weintek HMI», ma quel percorso non scrive la classe.
 *
 * Run: node --import tsx --test src/lib/attribution/__tests__/oui-ot.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitEvidenceFromSignals } from "../emitters";
import type { AttributionSignals } from "../emitters";
import { fuseAttribution } from "../fuse";
import { projectLegacy } from "../legacy-projection";
import { ATTR_SOURCE_WEIGHTS } from "../weights";
import type { AttributionEvidenceRow } from "../types";

const segnali = (vendor: string, open_ports: string | null = null): AttributionSignals => ({
  host: { id: 1, ip: "192.0.2.10", mac: null, vendor, hostname: null, os_info: null, open_ports, snmp_data: null, detection_json: null },
  adComputer: null, wazuh: null, neighborSightings: [],
} as unknown as AttributionSignals);

/** Evidenze → classificazione proiettata su `hosts`, come fa `recomputeHostAttribution`. */
function classe(s: AttributionSignals): string | null {
  const ora = "2026-11-04T15:30:00.000Z";
  const righe = emitEvidenceFromSignals(s).map((e, i): AttributionEvidenceRow => ({
    id: i + 1, host_id: 1, source: e.source, phase: e.phase, dimension: e.dimension, claim: e.claim, confidence: e.confidence,
    weight: ATTR_SOURCE_WEIGHTS[e.source], raw_value: e.raw_value ?? null, observed_at: ora, expires_at: null, superseded_by: null,
  }));
  return projectLegacy(fuseAttribution(righe, ora)).classification;
}

const PORTE_WEINTEK = JSON.stringify([21, 80, 5900, 8000, 8001].map((port) => ({ port, protocol: "tcp" })));

describe("produttori che fanno solo apparati OT", () => {
  it("il Weintek del 72729: la VNC non lo fa workstation", () => {
    assert.equal(classe(segnali("Weintek Labs. Inc.", PORTE_WEINTEK)), "iot");
  });

  it("gli altri produttori, anche senza porte aperte", () => {
    for (const v of ["CREVIS Co., LTD", "Kronotech Srl", "Control Techniques", "Vacon Plc"]) assert.equal(classe(segnali(v)), "iot", v);
  });

  it("il produttore resta emesso", () => {
    const o = emitEvidenceFromSignals(segnali("Weintek Labs. Inc."));
    assert.ok(o.some((e) => e.source === "oui" && e.dimension === "vendor" && e.claim === "weintek-labs"));
  });
});

describe("OUI che non dicono il tipo di apparato", () => {
  it("Microchip è un chip montato da terzi: nessuna categoria", () => {
    for (const v of ["Microchip Technology Inc.", "Microchip Technologies Inc"]) {
      assert.ok(!emitEvidenceFromSignals(segnali(v)).some((e) => e.dimension === "category"), v);
      assert.equal(classe(segnali(v)), null, v);
    }
  });

  it("un produttore qualunque resta senza categoria dall'OUI", () => {
    for (const v of ["Hewlett Packard", "Zyxel Communications Corporation", "Apple, Inc."]) {
      assert.ok(!emitEvidenceFromSignals(segnali(v)).some((e) => e.source === "oui" && e.dimension === "category"), v);
    }
  });
});
