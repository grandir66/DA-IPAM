/**
 * Scelta della categoria a gruppi con ricerca (11/11/2026).
 * Run: node --import tsx --test src/lib/classification/__tests__/scelta-categoria.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gruppiScelta, origineCategoria, passaFiltroCategoria } from "../scelta-categoria";
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

describe("gruppiScelta con le categorie del cliente", () => {
  it("le voci fuori dal catalogo stanno in un gruppo loro, in fondo; quelle già in catalogo non si ripetono", () => {
    const gruppi = gruppiScelta("", [{ slug: "tornio_cnc", etichetta: "Tornio CNC" }, { slug: "stampante", etichetta: "Stampante" }]);
    const ultimo = gruppi[gruppi.length - 1];
    assert.equal(ultimo.gruppo, "cliente");
    assert.deepEqual(ultimo.voci.map((v) => v.slug), ["tornio_cnc"]);
    assert.equal(gruppi.flatMap((g) => g.voci).filter((v) => v.slug === "stampante").length, 1);
  });
  it("la ricerca trova anche quelle", () => {
    const trovate = gruppiScelta("tornio", [{ slug: "tornio_cnc", etichetta: "Tornio CNC" }]).flatMap((g) => g.voci.map((v) => v.slug));
    assert.deepEqual(trovate, ["tornio_cnc"]);
  });
});

describe("categorie e sottocategorie (11/11/2026)", () => {
  it("Telefonia esiste e tiene telefoni, smartphone, centralino e convertitore; OT e IoT sono separati", () => {
    const perTitolo = new Map(gruppiScelta().map((g) => [g.gruppo, g.voci.map((v) => v.slug)]));
    assert.deepEqual(new Set(perTitolo.get("telefonia")), new Set(["voip", "smartphone", "centralino", "gateway_voip"]));
    assert.deepEqual(new Set(perTitolo.get("ot")), new Set(["plc", "hmi", "rete_ot"]));
    assert.deepEqual(new Set(perTitolo.get("iot")), new Set(["iot", "sensore", "domotica"]));
    assert.ok(perTitolo.get("postazioni")?.includes("workstation"));
    assert.deepEqual(new Set(perTitolo.get("videosorveglianza")), new Set(["telecamera", "nvr"]));
    assert.deepEqual(new Set(perTitolo.get("multimedia")), new Set(["smart_tv", "decoder", "media_player", "console"]));
    assert.equal(perTitolo.get("postazioni")?.includes("smartphone"), false);
  });
  it("ogni classe del catalogo ha una categoria: nessuna resta fuori dal menu", () => {
    const senza = DEVICE_CLASSIFICATIONS_ORDERED.filter((s) => s && s !== "unknown" && getDeviceCategoryGroup(s) === "unknown");
    assert.deepEqual(senza, []);
  });
});

describe("passaFiltroCategoria", () => {
  it("una categoria intera prende tutte le sue classi; uno slug solo quella; vuoto tutto", () => {
    assert.equal(passaFiltroCategoria("gruppo:telefonia", "voip"), true);
    assert.equal(passaFiltroCategoria("gruppo:telefonia", "smartphone"), true);
    assert.equal(passaFiltroCategoria("gruppo:telefonia", "workstation"), false);
    assert.equal(passaFiltroCategoria("gruppo:telefonia", null), false);
    assert.equal(passaFiltroCategoria("voip", "voip"), true);
    assert.equal(passaFiltroCategoria("voip", "smartphone"), false);
    assert.equal(passaFiltroCategoria("", "voip"), true);
  });
});

it("figliePresenti: le classi della madre presenti, dalla più frequente; una sola classe = niente figlie", async () => {
  const { figliePresenti } = await import("../scelta-categoria");
  const righe = [{ classification: "switch" }, { classification: "switch" }, { classification: "router" }, { classification: "voip" }, { classification: null }];
  assert.deepEqual(figliePresenti(righe, "rete").map((f) => [f.slug, f.quanti]), [["switch", 2], ["router", 1]]);
  assert.deepEqual(figliePresenti(righe, "telefonia"), []);
});
