// Produttore che dice la famiglia e nome da server: i casi di DTS del 12/11/2026 (258 righe senza categoria con
// il produttore noto; `SRV-PDM` su scheda Proxmox scritto «VM»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emitEvidenceFromSignals, type AttributionSignals } from "../emitters";

function segnali(host: Partial<AttributionSignals["host"]>): AttributionSignals {
  return {
    host: { id: 1, ip: "10.0.0.1", mac: "00:11:22:33:44:55", vendor: null, hostname: null, os_info: null, open_ports: null, snmp_data: null, detection_json: null, ...host },
    adComputer: null, wazuh: null, neighborSightings: [], annunci: [], gemello: null,
  } as AttributionSignals;
}
const categorie = (h: Partial<AttributionSignals["host"]>) =>
  emitEvidenceFromSignals(segnali(h)).filter((e) => e.dimension === "category").map((e) => e.claim);

test("Siemens, Espressif, snom e Routerboard dicono la famiglia", () => {
  const siemens = categorie({ vendor: "Siemens AG" });
  assert.equal(siemens.length, 1);
  assert.match(siemens[0], /^ot(\.|$)/);
  assert.deepEqual(categorie({ vendor: "Espressif Inc." }), ["iot.other"]);
  assert.deepEqual(categorie({ vendor: "snom technology GmbH" }), ["voip.phone"]);
  assert.deepEqual(categorie({ vendor: "Routerboard.com" }), ["network.router"]);
});

test("Intel e Samsung non dicono niente: fanno di tutto", () => {
  assert.deepEqual(categorie({ vendor: "Intel Corporate" }), []);
  assert.deepEqual(categorie({ vendor: "Samsung Electronics Co.,Ltd" }), []);
});

test("SRV-PDM su scheda Proxmox è un server, non una VM", () => {
  const emesse = emitEvidenceFromSignals(segnali({ vendor: "Proxmox Server Solutions GmbH", hostname: "SRV-PDM.dts.local" }));
  const somma = new Map<string, number>();
  for (const e of emesse.filter((x) => x.dimension === "category")) somma.set(e.claim, (somma.get(e.claim) ?? 0) + (e.weight ?? 0.9) * e.confidence);
  assert.ok((somma.get("compute.server") ?? 0) > (somma.get("compute.vm") ?? 0), JSON.stringify([...somma]));
});

test("un nome qualunque su scheda virtuale resta VM", () => {
  assert.deepEqual(categorie({ vendor: "VMware, Inc.", hostname: "dcarlo" }), ["compute.vm"]);
});
