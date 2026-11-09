import { test } from "node:test";
import assert from "node:assert/strict";
import { daSaltare } from "../giro";

test("freno: porte di stampa e di campo, apparati di campo", () => {
  assert.equal(daSaltare(9100, "Brother"), true, "il GET finirebbe stampato");
  assert.equal(daSaltare(502, null), true, "Modbus");
  assert.equal(daSaltare(80, "Siemens AG"), true, "apparato di campo");
  assert.equal(daSaltare(443, "Proxmox Server Solutions GmbH"), false);
  assert.equal(daSaltare(22, null), false);
});
