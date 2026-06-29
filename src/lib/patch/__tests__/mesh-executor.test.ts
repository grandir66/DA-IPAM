import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMeshInstallStatus } from "@/lib/patch/executor";

test("already-installed marker → already_installed", () => {
  const out = "MESHAGENT_INSTALL_START\nMESHAGENT_ALREADY_INSTALLED_AND_RUNNING\nEXIT_CODE=0";
  assert.equal(parseMeshInstallStatus(out), "already_installed");
});

test("fresh install success marker → success", () => {
  const out = "MESHAGENT_INSTALL_START\nINSTALLING_AGENT\nMESHAGENT_INSTALLED_AND_RUNNING\nEXIT_CODE=0";
  assert.equal(parseMeshInstallStatus(out), "success");
});

test("non-zero exit → failed", () => {
  const out = "MESHAGENT_INSTALL_START\nERROR: Download failed\nEXIT_CODE=1";
  assert.equal(parseMeshInstallStatus(out), "failed");
});

test("missing markers / no exit code → failed", () => {
  assert.equal(parseMeshInstallStatus("garbage"), "failed");
});
