import { test } from "node:test";
import assert from "node:assert/strict";
import { daSaltare, portaRischiosaSuStampante } from "../giro";

test("freno: porte di stampa e di campo, apparati di campo", () => {
  assert.equal(daSaltare(9100, "Brother"), true, "il GET finirebbe stampato");
  assert.equal(daSaltare(502, null), true, "Modbus");
  assert.equal(daSaltare(80, "Siemens AG"), true, "apparato di campo");
  assert.equal(daSaltare(443, "Proxmox Server Solutions GmbH"), false);
  assert.equal(daSaltare(22, null), false);
});

test("freno: tutta la fascia raw 9100-9109 (Kyocera sulla 9103, 11/11)", () => {
  for (const p of [515, 9100, 9101, 9102, 9103, 9107, 9109]) assert.equal(daSaltare(p, null), true, String(p));
});

test("su una stampante le porte alte sconosciute non si sondano", () => {
  const kyocera = { vendor: "KYOCERA Document Solutions Inc." };
  assert.equal(portaRischiosaSuStampante(4000, kyocera), true);
  assert.equal(portaRischiosaSuStampante(443, kyocera), false);
  assert.equal(portaRischiosaSuStampante(9090, kyocera), false, "pannello web");
  assert.equal(portaRischiosaSuStampante(4000, { classification: "stampante" }), true);
  assert.equal(portaRischiosaSuStampante(4000, { vendor: "Sconosciuto", open_ports: '[{"port":631,"protocol":"tcp"}]' }), true);
  assert.equal(portaRischiosaSuStampante(8006, { vendor: "Proxmox Server Solutions GmbH" }), false);
});
