import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRemoteSessionUrl } from "@/lib/integrations/meshcentral/deep-link";

test("buildRemoteSessionUrl: exact shape login/node/viewmode/hide=15, https forced", () => {
  const url = buildRemoteSessionUrl({
    serverUrl: "mesh.appliance.local",
    token: "ABC@DEF$gh==",
    nodeId: "node//XYZ123",
    viewmode: 11,
  });
  assert.equal(
    url,
    "https://mesh.appliance.local/?login=ABC%40DEF%24gh%3D%3D&node=node%2F%2FXYZ123&viewmode=11&hide=15",
  );
});

test("buildRemoteSessionUrl: param ORDER is login, node, viewmode, hide (case-sensitive names)", () => {
  const url = buildRemoteSessionUrl({
    serverUrl: "https://mesh.x/",
    token: "t",
    nodeId: "n",
    viewmode: 12,
  });
  const q = url.split("?")[1];
  assert.equal(q, "login=t&node=n&viewmode=12&hide=15");
  // case-sensitivity: lowercase param names exactly, no 'gotonode'
  assert.equal(url.includes("gotonode"), false);
  assert.match(url, /[?&]node=/);
  assert.match(url, /[?&]viewmode=/);
});

test("buildRemoteSessionUrl: strips an existing scheme on serverUrl and avoids double slashes", () => {
  const url = buildRemoteSessionUrl({
    serverUrl: "http://mesh.appliance.local",
    token: "t",
    nodeId: "n",
    viewmode: 13,
  });
  assert.ok(url.startsWith("https://mesh.appliance.local/?login="), url);
  assert.equal(url.includes("//?"), false);
});

test("buildRemoteSessionUrl: rejects unknown viewmode", () => {
  assert.throws(
    () => buildRemoteSessionUrl({ serverUrl: "m", token: "t", nodeId: "n", viewmode: 99 }),
    /viewmode/i,
  );
});

test("buildRemoteSessionUrl: token special chars are URL-encoded (no raw @ $ = in query)", () => {
  const url = buildRemoteSessionUrl({
    serverUrl: "m",
    token: "a@b$c=",
    nodeId: "n",
    viewmode: 11,
  });
  const login = url.split("login=")[1].split("&")[0];
  assert.equal(login, "a%40b%24c%3D");
});
