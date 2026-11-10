/**
 * Firme di nome e di porte (10/11/2026, hub 533): un indizio certo vale da solo.
 * Prima «iPhone» diventava un telefono VoIP e un RouterOS con Winbox + API restava
 * senza categoria, perché ogni regola di nome o porte pesava 0.15-0.17.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitEvidenceFromSignals } from "../emitters";
import { fuseAttribution } from "../fuse";
import type { AttributionEvidenceRow } from "../types";
import { ATTR_SOURCE_WEIGHTS } from "../weights";

function categoria(host: { hostname?: string | null; open_ports?: string | null }): string | null {
  const segnali = {
    host: { id: 1, ip: "192.168.5.10", mac: null, vendor: null, hostname: host.hostname ?? null, os_info: null, open_ports: host.open_ports ?? null, snmp_data: null, detection_json: null },
    adComputer: null, wazuh: null, neighborSightings: [], annunci: [],
  } as unknown as Parameters<typeof emitEvidenceFromSignals>[0];
  const righe = emitEvidenceFromSignals(segnali).map((e, i) => ({
    id: i + 1, host_id: 1, source: e.source, phase: e.phase, dimension: e.dimension, claim: e.claim,
    confidence: e.confidence, weight: e.weight ?? ATTR_SOURCE_WEIGHTS[e.source], raw_value: e.raw_value ?? null,
    observed_at: "2026-11-10T00:00:00.000Z", expires_at: null, superseded_by: null,
  })) as AttributionEvidenceRow[];
  return fuseAttribution(righe, "2026-11-10T00:00:00.000Z").category.claim;
}
const porte = (...p: number[]) => JSON.stringify(p.map((port) => ({ port })));

describe("firme di nome", () => {
  it("iPhone, Pixel, Fairphone sono smartphone, non telefoni VoIP", () => {
    for (const n of ["iPhone", "iPhone-di-Marco", "Pixel-7a", "Fairphone-5-5G", "Nothing-Phone-2a-Plus"]) assert.equal(categoria({ hostname: n }), "mobile.phone", n);
  });
  it("iPad è un tablet, DESKTOP-XXXXXXX una postazione", () => {
    assert.equal(categoria({ hostname: "iPad" }), "mobile.tablet");
    assert.equal(categoria({ hostname: "DESKTOP-Q940L5H" }), "compute.workstation");
  });
  it("un nome qualunque resta sotto soglia", () => {
    assert.equal(categoria({ hostname: "phone-reception" }), null);
    assert.equal(categoria({ hostname: "desktop" }), null);
  });
});

describe("firme di porte", () => {
  it("Winbox + API è un router, 8006 + ssh un hypervisor, 17988 un server", () => {
    assert.equal(categoria({ open_ports: porte(22, 80, 8291, 8728, 8729) }), "network.router");
    assert.equal(categoria({ open_ports: porte(22, 8006) }), "compute.hypervisor");
    assert.equal(categoria({ open_ports: porte(22, 80, 443, 17988) }), "compute.server");
  });
  it("porte generiche restano sotto soglia", () => {
    assert.equal(categoria({ open_ports: porte(22, 80, 443) }), null);
    assert.equal(categoria({ open_ports: porte(8291) }), null);
  });
});
