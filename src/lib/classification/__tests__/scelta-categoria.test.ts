/**
 * Scelta della categoria a gruppi con ricerca (11/11/2026).
 * Run: node --import tsx --test src/lib/classification/__tests__/scelta-categoria.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gruppiScelta, origineCategoria } from "../scelta-categoria";
import { DEVICE_CLASSIFICATIONS_ORDERED, getDeviceCategoryGroup } from "@/lib/device-classifications";

describe("gruppiScelta", () => {
  it("ogni classe del catalogo che ha un gruppo compare una volta sola; «unknown» mai", () => {
    const tutte = gruppiScelta().flatMap((g) => g.voci.map((v) => v.slug));
    assert.equal(new Set(tutte).size, tutte.length);
    assert.equal(tutte.includes("unknown"), false);
    const attese = new Set(DEVICE_CLASSIFICATIONS_ORDERED.filter((s) => s && s !== "unknown" && getDeviceCategoryGroup(s) !== "unknown"));
    assert.deepEqual(new Set(tutte), attese);
  });
  it("la ricerca stringe, senza badare a maiuscole e accenti; cercando un gruppo restano le sue voci", () => {
    const stampa = gruppiScelta("STAMP").flatMap((g) => g.voci.map((v) => v.slug));
    assert.ok(stampa.includes("stampante"));
    assert.ok(stampa.length < 6);
    assert.equal(gruppiScelta("zzz-niente").length, 0);
    assert.ok(gruppiScelta("smartphone").flatMap((g) => g.voci.map((v) => v.slug)).includes("smartphone"));
  });
});

describe("origineCategoria", () => {
  it("la scelta a mano vince; le fasi note hanno una parola; una fase ignota niente", () => {
    assert.equal(origineCategoria(true, "scan_snmp_verify"), "a mano");
    assert.equal(origineCategoria(false, "scan_snmp_verify"), "da SNMP");
    assert.equal(origineCategoria(false, "scan_nmap_base"), "dalle porte");
    assert.equal(origineCategoria(false, "fase_nuova"), null);
    assert.equal(origineCategoria(false, null), null);
  });
});
