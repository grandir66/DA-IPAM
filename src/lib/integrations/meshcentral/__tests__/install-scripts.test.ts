import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMeshInstallScript,
  meshInstallScriptFilename,
  meshInstallScriptContentType,
  isMeshInstallPlatform,
} from "@/lib/integrations/meshcentral/install-scripts";

const P = { serverUrl: "https://da-ipam.example.com", meshId: "mesh//AbC123==" };

test("windows script embeds serverUrl + meshId and downloads generic agent + .msh", () => {
  const s = buildMeshInstallScript("windows", P);
  assert.ok(s.includes("/meshagents?id="), "missing generic meshagent download");
  assert.ok(s.includes("/meshsettings?id=AbC123=="), "missing .msh meshsettings download");
  assert.ok(s.includes("https://da-ipam.example.com"), "serverUrl not embedded");
  assert.ok(s.includes("--meshServiceName") || s.includes("Mesh Agent"), "missing service name anchor");
});

test("linux script is a bash installer that fetches .msh by meshId", () => {
  const s = buildMeshInstallScript("linux", P);
  assert.ok(s.startsWith("#!/usr/bin/env bash"));
  assert.ok(s.includes("/meshsettings?id=AbC123=="));
  assert.ok(s.includes("https://da-ipam.example.com"));
});

test("macos script is a bash installer that fetches .msh by meshId", () => {
  const s = buildMeshInstallScript("macos", P);
  assert.ok(s.startsWith("#!/usr/bin/env bash"));
  assert.ok(s.includes("/meshsettings?id=AbC123=="));
});

test("serverUrl trailing slash is normalized (no double slash)", () => {
  const s = buildMeshInstallScript("linux", { serverUrl: "https://h/", meshId: "m" });
  assert.ok(!s.includes("https://h//meshsettings"), "double slash in URL");
  assert.ok(s.includes("https://h/meshsettings?id=m"));
});

test("single quotes in meshId are safely escaped (no shell injection)", () => {
  const s = buildMeshInstallScript("linux", { serverUrl: "https://h", meshId: "m'x" });
  assert.ok(s.includes(`'m'\\''x'`), "meshId not bash-quoted");
});

test("filename + content-type + platform guard", () => {
  assert.equal(meshInstallScriptFilename("windows"), "domarc-meshagent-install.ps1");
  assert.equal(meshInstallScriptFilename("linux"), "domarc-meshagent-install.sh");
  assert.equal(meshInstallScriptFilename("macos"), "domarc-meshagent-install-macos.sh");
  assert.equal(meshInstallScriptContentType("windows"), "text/plain; charset=utf-8");
  assert.equal(meshInstallScriptContentType("linux"), "text/x-shellscript; charset=utf-8");
  assert.ok(isMeshInstallPlatform("windows"));
  assert.ok(isMeshInstallPlatform("linux"));
  assert.ok(isMeshInstallPlatform("macos"));
  assert.ok(!isMeshInstallPlatform("bsd"));
});
