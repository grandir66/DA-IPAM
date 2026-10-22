/**
 * Il cavo tracciato a mano vince, e una partenza che è un oggetto finale non resta sola (22/10). Incidente: sulla appliance
 * di prova PX-NAS (hypervisor) era stato trascinato in una mappa «passo passo» prima di collegarlo, quindi era una partenza;
 * il Prim partiva da lui, che non fa da ponte, e il cavo a mano verso lo switch finiva fra le ridondanze. E un cavo a mano
 * verso lo switch giusto perdeva contro la tabella MAC di un altro switch, perché la fiducia «a mano» era l'ultima.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { primCavi, type IngressoPrim, type LineaAlbero } from "@/lib/topology/cavi/prim";
import type { ClasseMappa, Fiducia } from "@/lib/topology/model-types";

function linea(id: string, a: string, b: string, fiducia: Fiducia, velocitaMbps: number | null = 1000): LineaAlbero {
  return { id, a, b, nonVisto: false, stato: "inoltra", fiducia, verso: null, velocitaMbps, aMano: fiducia === "a_mano" };
}

function ingresso(linee: LineaAlbero[], partenze: string[], classi: Record<string, ClasseMappa>, ipervisori: string[] = []): IngressoPrim {
  return {
    classe: (id) => classi[id], ponti: new Set(), visibili: new Set(Object.keys(classi)), linee, partenze,
    scelto: new Map(), stelle: new Map(), ipervisori: new Set(ipervisori),
  };
}

const classi: Record<string, ClasseMappa> = { gw: "infra", sw1: "infra", sw2: "infra", nas: "hyper" };

test("una partenza che è un hypervisor si appende al suo switch col cavo a mano, e non resta radice", () => {
  const e = primCavi(ingresso(
    [linea("gw-sw1", "gw", "sw1", "certo"), linea("sw1-sw2", "sw1", "sw2", "certo"), linea("nas-sw2", "nas", "sw2", "a_mano")],
    ["gw", "nas"], classi, ["nas"],
  ));
  assert.deepEqual(e.radici, ["gw"]);
  assert.equal(e.padri.nas, "sw2");
  assert.equal(e.via.get("nas")?.id, "nas-sw2");
});

test("una partenza finale che nessuno raggiunge resta radice", () => {
  const e = primCavi(ingresso([linea("gw-sw1", "gw", "sw1", "certo")], ["gw", "nas"], { gw: "infra", sw1: "infra", nas: "hyper" }, ["nas"]));
  assert.deepEqual(e.radici, ["gw", "nas"]);
});

test("il cavo a mano batte la tabella MAC di uno switch preso prima", () => {
  // sw1 è preso prima di sw2 e vede il MAC del NAS (dedotto): senza la regola il NAS stava sotto sw1.
  const e = primCavi(ingresso(
    [linea("gw-sw1", "gw", "sw1", "certo"), linea("sw1-sw2", "sw1", "sw2", "certo", 100), linea("nas-sw1", "nas", "sw1", "dedotto"),
      linea("nas-sw2", "nas", "sw2", "a_mano")],
    ["gw"], classi, ["nas"],
  ));
  assert.equal(e.padri.nas, "sw2");
});

test("fra due switch il cavo a mano batte uno letto, a parità di raggiungibilità", () => {
  const e = primCavi(ingresso(
    [linea("gw-sw1", "gw", "sw1", "certo"), linea("gw-sw2", "gw", "sw2", "certo"), linea("sw1-sw2", "sw1", "sw2", "a_mano")],
    ["gw"], { gw: "infra", sw1: "infra", sw2: "infra" },
  ));
  // sw1 si prende per primo (spareggio sull'id); sw2 poi ha il letto da gw e il cavo a mano da sw1: vince il cavo a mano.
  assert.equal(e.padri.sw2, "sw1");
});
