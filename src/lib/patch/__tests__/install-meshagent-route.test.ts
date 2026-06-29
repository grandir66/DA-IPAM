import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInstallMeshBody } from "@/app/api/patch/install-meshagent/route";

test("valid hostId → ok", () => {
  const r = validateInstallMeshBody({ hostId: 7 });
  assert.deepEqual(r, { ok: true, hostId: 7 });
});

test("missing hostId → error", () => {
  const r = validateInstallMeshBody({});
  assert.equal(r.ok, false);
});

test("non-numeric hostId → error", () => {
  const r = validateInstallMeshBody({ hostId: "abc" });
  assert.equal(r.ok, false);
});

test("zero/negative hostId → error", () => {
  assert.equal(validateInstallMeshBody({ hostId: 0 }).ok, false);
  assert.equal(validateInstallMeshBody({ hostId: -3 }).ok, false);
});
