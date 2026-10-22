/**
 * Righe dell'elenco dei moduli (analisi del 19/10, F10). Lo stato si legge con la
 * salute quando c'è: un modulo acceso ma guasto non è «Acceso».
 *
 * Run: node --import tsx --test src/lib/modules/__tests__/elenco-righe.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rigaModulo } from "../elenco-righe";

const m = (x: Partial<Parameters<typeof rigaModulo>[0]> = {}) => ({
  key: "edge", label: "Scanner-Edge", offerta: "base" as const, installed: true, configured: true, enabled: true,
  configHref: "/settings?tab=moduli#module-edge", ...x,
});

test("acceso con salute buona → acceso; guasto e attenzione vincono sull'interruttore", () => {
  assert.equal(rigaModulo(m(), { key: "edge", verdict: "ok", detail: "ok" }).stato, "acceso");
  assert.equal(rigaModulo(m(), { key: "edge", verdict: "fail", detail: "certificato scaduto" }).stato, "guasto");
  assert.equal(rigaModulo(m(), { key: "edge", verdict: "degraded", detail: "lento" }).stato, "attenzione");
  // L'MDM spento da solo dopo gli errori: guasto, non «spento».
  assert.equal(rigaModulo(m({ key: "mdm", enabled: false }), { key: "mdm", verdict: "fail", detail: "x" }).stato, "guasto");
});

test("spento → spento; acceso senza salute → da verificare", () => {
  assert.equal(rigaModulo(m({ enabled: false }), null).stato, "spento");
  assert.equal(rigaModulo(m(), null).stato, "da_verificare");
  assert.equal(rigaModulo(m(), { key: "edge", verdict: "unverified", detail: null }).stato, "da_verificare");
});

test("Apri: la pagina del modulo se ne ha una, altrimenti il suo indirizzo, altrimenti niente", () => {
  assert.equal(rigaModulo(m(), null).href, "/settings/moduli/edge");
  assert.equal(rigaModulo(m({ key: "mdm", configHref: "/settings/mdm" }), null).href, "/settings/mdm");
  assert.equal(rigaModulo(m({ key: "appliance", configHref: "/settings?tab=moduli" }), null).href, null);
});

test("dettaglio: la salute, poi la nota del catalogo, poi quello passato a mano", () => {
  assert.equal(rigaModulo(m({ note: "nota" }), { key: "edge", verdict: "ok", detail: "salute" }).dettaglio, "salute");
  assert.equal(rigaModulo(m({ note: "nota" }), null).dettaglio, "nota");
  assert.equal(rigaModulo(m(), null, "a mano").dettaglio, "a mano");
  assert.equal(rigaModulo(m({ offerta: "opzione" }), null).opzione, true);
});
