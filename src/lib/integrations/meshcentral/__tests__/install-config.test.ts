process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-install";

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfigJson } from "@/lib/integrations/meshcentral/install";

const opts = {
  adminPassword: "x",
  title: "t",
  subtitle: "s",
  port: 4443,
  host: "192.168.99.51",
  tenantCode: "T",
};

test("certificato dell'appliance: KeepCerts acceso, così MeshCentral non lo rigenera", () => {
  const conf = JSON.parse(buildConfigJson(opts, "k", true)) as { settings: Record<string, unknown> };
  assert.equal(conf.settings.KeepCerts, true);
  assert.equal(conf.settings.allowedFramingOrigins, "https://192.168.99.51");
});

test("senza certificato dell'appliance: nessun KeepCerts", () => {
  const conf = JSON.parse(buildConfigJson(opts, "k")) as { settings: Record<string, unknown> };
  assert.equal("KeepCerts" in conf.settings, false);
});
