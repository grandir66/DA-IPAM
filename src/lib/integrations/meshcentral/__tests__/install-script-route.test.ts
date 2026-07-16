import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveInstallScript,
  type ResolveInstallDeps,
} from "@/app/api/integrations/meshcentral/install-script/route";
import type { MeshCreds } from "@/lib/integrations/meshcentral/config";

const CREDS: MeshCreds = {
  serverUrl: "https://da-ipam.example.com",
  domain: "",
  meshId: "mesh//AbC123==",
  serviceUser: "svc-daipam",
  loginTokenKey: Buffer.alloc(80),
  adminUser: "admin",
  adminPass: "pw",
};

function deps(meshes: Array<{ meshId: string; name: string }>): ResolveInstallDeps {
  return {
    getMeshCreds: () => CREDS,
    listMeshes: async () => meshes,
  };
}

test("missing config → 500", async () => {
  const r = await resolveInstallScript("windows", {
    getMeshCreds: () => null,
    listMeshes: async () => [],
  });
  assert.equal(r.status, 500);
});

test("invalid platform → 400", async () => {
  const r = await resolveInstallScript("bsd", deps([{ meshId: "mesh//AbC123==", name: "g" }]));
  assert.equal(r.status, 400);
});

test("MeshID not present on server → 500", async () => {
  const r = await resolveInstallScript("windows", deps([{ meshId: "mesh//OTHER", name: "x" }]));
  assert.equal(r.status, 500);
});

test("MeshID present → 200 with embedded script + filename", async () => {
  const r = await resolveInstallScript("linux", deps([{ meshId: "mesh//AbC123==", name: "g" }]));
  assert.equal(r.status, 200);
  // Il parametro ?id= di /meshsettings vuole il mesh id SENZA il prefisso
  // 'mesh//': col prefisso (o in hex) MeshCentral risponde 401 — verificato dal
  // vivo il 2026-07-15, da cui mshIdParam() in install-scripts.ts. Questa
  // asserzione era rimasta sul comportamento vecchio e rompeva la suite.
  assert.ok(
    r.script!.includes("/meshsettings?id=AbC123=="),
    "mesh id nel parametro ?id= senza prefisso mesh//",
  );
  assert.ok(
    !r.script!.includes("?id=mesh//"),
    "il prefisso mesh// non deve MAI finire nel parametro ?id= (il server risponde 401)",
  );
  assert.equal(r.filename, "domarc-meshagent-install.sh");
  assert.equal(r.contentType, "text/x-shellscript; charset=utf-8");
});
