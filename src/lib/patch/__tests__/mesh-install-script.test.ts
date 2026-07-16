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

test("bypassa la validazione TLS: MeshCentral ha un cert self-signed", () => {
  // REGRESSIONE (2026-07-17). Il push WinRM falliva sul target reale con
  //   ERROR: Download failed: Impossibile stabilire una relazione di trust
  //   per il canale sicuro SSL/TLS
  // perche' questo script impostava solo SecurityProtocol (TLS 1.2) senza il
  // ServerCertificateValidationCallback. Lo script generato dalla UI
  // (install-scripts.ts) lo faceva gia': i due percorsi erano divergenti e solo
  // quello via push era rotto. Finche' MeshCentral usa un cert self-signed i due
  // devono restare allineati.
  const s = buildMeshAgentInstallScript(1, "https://mesh.example.com", "mesh//AAA");
  assert.ok(
    s.includes("ServerCertificateValidationCallback"),
    "senza il callback il download dell'agente fallisce sul cert self-signed",
  );
  assert.ok(
    s.includes("DA_IPAM_INSECURE_SSL"),
    "stesso escape hatch dello script UI: DA_IPAM_INSECURE_SSL=0 ripristina la validazione",
  );
});

test("single quotes in serverUrl/meshId are PS-escaped (doubled)", () => {
  const s = buildMeshAgentInstallScript(1, "https://h'x", "m'y");
  assert.ok(s.includes("https://h''x"), "serverUrl not psQuoted");
  assert.ok(s.includes("m''y"), "meshId not psQuoted");
});
