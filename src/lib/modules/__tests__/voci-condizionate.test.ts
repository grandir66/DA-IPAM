/**
 * Voci del menu grigie quando manca chi le alimenta (Riccardo, 08/11/2026, appliance ridotta
 * 79993-ipam-7: le voci restavano attive senza i moduli). «Se installata senza edge e senza nis2 la
 * pagina Security Vulnerabilità e Scansioni VA devono essere grige e il menù inventario anche lui e
 * anche applicativi»; «Alert Sicurezza, che dipende da Wazuh, anch'essa in grigio».
 *
 * Run: node --import tsx --test src/lib/modules/__tests__/voci-condizionate.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { presenzeDaModuli, motivoBlocco, type VoceCondizionata } from "../voci-condizionate";
import type { ModuloPerMenu } from "../voci-applicativi";

const m = (key: string, x: Partial<ModuloPerMenu> = {}): ModuloPerMenu => ({
  key, label: key, enabled: false, installed: false, uiUrl: null, uiIsInternal: true, externalUiUrl: null, ...x,
});

const EDGE_NIS2: VoceCondizionata[] = ["vulnerabilita", "scansioni_va", "inventario", "applicativi"];
const TUTTE: VoceCondizionata[] = [...EDGE_NIS2, "alert_sicurezza"];

// La ridotta: niente riga in vuln_scanners, NIS2 spento da Opzioni, Wazuh non configurato.
const RIDOTTA = [m("edge"), m("nis2_inventory", { installed: true }), m("wazuh")];

test("senza Edge e senza NIS2: Vulnerabilità, Scansioni VA, Inventario e Applicativi grigie col motivo", () => {
  const p = presenzeDaModuli(RIDOTTA);
  for (const v of EDGE_NIS2) {
    const motivo = motivoBlocco(v, p);
    assert.ok(motivo && /Scanner-Edge/.test(motivo) && /NIS2/.test(motivo), `${v}: ${motivo}`);
  }
});

test("con Edge (anche spento per un momento) le quattro voci restano attive", () => {
  const p = presenzeDaModuli([m("edge", { installed: true, enabled: false }), m("nis2_inventory", { installed: true }), m("wazuh")]);
  for (const v of EDGE_NIS2) assert.equal(motivoBlocco(v, p), null, v);
});

test("con NIS2 acceso le quattro voci restano attive", () => {
  const p = presenzeDaModuli([m("edge"), m("nis2_inventory", { installed: true, enabled: true }), m("wazuh")]);
  for (const v of EDGE_NIS2) assert.equal(motivoBlocco(v, p), null, v);
});

test("senza Wazuh configurato: Alert sicurezza grigia, col motivo che dice Wazuh", () => {
  const motivo = motivoBlocco("alert_sicurezza", presenzeDaModuli(RIDOTTA));
  assert.ok(motivo && /Wazuh/.test(motivo), String(motivo));
});

test("con Wazuh configurato: Alert sicurezza attiva, anche senza Edge e senza NIS2", () => {
  const p = presenzeDaModuli([m("edge"), m("nis2_inventory", { installed: true }), m("wazuh", { installed: true, enabled: true })]);
  assert.equal(motivoBlocco("alert_sicurezza", p), null);
  assert.ok(motivoBlocco("vulnerabilita", p), "Wazuh non accende le voci di Edge e NIS2");
});

test("Edge e NIS2 non accendono Alert sicurezza", () => {
  const p = presenzeDaModuli([m("edge", { installed: true, enabled: true }), m("nis2_inventory", { installed: true, enabled: true }), m("wazuh")]);
  assert.ok(motivoBlocco("alert_sicurezza", p));
});

test("moduli non ancora letti (o istanza «tutte»): niente grigio, il menu resta com'era", () => {
  for (const v of TUTTE) assert.equal(motivoBlocco(v, null), null, v);
});
