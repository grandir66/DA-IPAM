import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeshAgentInstallScript } from "@/lib/patch/ps-scripts";

test("embeds serverUrl + meshId, fixed service name, idempotency marker, EXIT_CODE", () => {
  const s = buildMeshAgentInstallScript(42, "https://da-ipam.example.com", "mesh//AbC123==");
  assert.ok(s.includes("https://da-ipam.example.com/meshsettings?id=AbC123=="));
  assert.ok(s.includes("https://da-ipam.example.com/meshagents?id="));
  assert.ok(s.includes("Mesh Agent"), "fixed service name");
  assert.ok(s.includes("MESHAGENT_ALREADY_INSTALLED_AND_RUNNING"), "idempotency marker");
  assert.ok(s.includes("MESHAGENT_INSTALLED_AND_RUNNING"), "success marker");
  assert.ok(/EXIT_CODE=/.test(s), "exit code line");
  assert.ok(s.includes("op-42") || s.includes("42"), "operation log path");
});

test("single quotes in serverUrl/meshId are PS-escaped (doubled)", () => {
  const s = buildMeshAgentInstallScript(1, "https://h'x", "m'y");
  assert.ok(s.includes("https://h''x"), "serverUrl not psQuoted");
  assert.ok(s.includes("m''y"), "meshId not psQuoted");
});
