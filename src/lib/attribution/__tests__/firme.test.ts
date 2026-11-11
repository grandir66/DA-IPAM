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

function categoria(host: { hostname?: string | null; open_ports?: string | null; vendor?: string | null }): string | null {
  const segnali = {
    host: { id: 1, ip: "192.168.5.10", mac: null, vendor: host.vendor ?? null, hostname: host.hostname ?? null, os_info: null, open_ports: host.open_ports ?? null, snmp_data: null, detection_json: null },
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
  it("Mac mini, Surface, MacBook, Android di serie", () => {
    assert.equal(categoria({ hostname: "Mac-mini" }), "compute.workstation");
    assert.equal(categoria({ hostname: "SURFACE-ALAIN" }), "compute.workstation");
    assert.equal(categoria({ hostname: "MacBook-Pro-di-Anna" }), "compute.laptop");
    assert.equal(categoria({ hostname: "android-88a8f2bac640b96b" }), "mobile.phone");
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
  it("8007 + ssh è un server (PBS), le porte della console UniFi un controller", () => {
    assert.equal(categoria({ open_ports: porte(22, 111, 8007) }), "compute.server");
    assert.equal(categoria({ open_ports: porte(22, 53, 80, 443, 6789, 8080, 8443, 8880, 9443) }), "network.controller");
  });
  it("porte generiche restano sotto soglia", () => {
    assert.equal(categoria({ open_ports: porte(22, 80, 443) }), null);
    assert.equal(categoria({ open_ports: porte(8291) }), null);
  });
});

describe("una VM con un ruolo (79993, 10/11/2026: il PBS restava «vm»)", () => {
  const proxmox = "Proxmox Server Solutions GmbH";
  it("scheda virtuale + porte del PBS → server, non vm", () => {
    assert.equal(categoria({ vendor: proxmox, hostname: "pbs.domarc.it", open_ports: porte(22, 111, 8007) }), "compute.server");
  });
  it("scheda virtuale + Winbox e API → router (CHR)", () => {
    assert.equal(categoria({ vendor: proxmox, open_ports: porte(22, 80, 8291, 8728) }), "network.router");
  });
  it("scheda virtuale senza ruolo → resta vm; un nome da smartphone non la fa telefono", () => {
    assert.equal(categoria({ vendor: proxmox, open_ports: porte(22, 80) }), "compute.vm");
    assert.equal(categoria({ vendor: proxmox, hostname: "iPhone" }), "compute.vm");
  });
});

describe("firma di nome dei Samsung S (11/11/2026)", () => {
  it("«S25-Ultra-di-riccardo» è un telefono; un nome che comincia per S2 senza essere un Samsung no", () => {
    assert.equal(categoria({ hostname: "S25-Ultra-di-riccardo" }), "mobile.phone");
    assert.equal(categoria({ hostname: "S24" }), "mobile.phone");
    assert.notEqual(categoria({ hostname: "S2000-SWITCH" }), "mobile.phone");
    assert.notEqual(categoria({ hostname: "s2sgateway" }), "mobile.phone");
  });
});
