process.env.ENCRYPTION_KEY ||= "test-encryption-key-mdm-config";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase } from "@/lib/db-tenant";
import { saveMdmConfig, getMdmConfig, getMdmCreds, recordSync } from "@/lib/integrations/mdm-config";

const T = "TESTMDMCFG";
after(() => deleteTenantDatabase(T));

test("config save/read + creds decrypt + auto-disable", () => {
  withTenant(T, () => {
    saveMdmConfig({ base_url: "http://h:8088", username: "admin", password: "secret", enabled: true });
    const cfg = getMdmConfig();
    assert.equal(cfg.base_url, "http://h:8088");
    assert.equal(cfg.username, "admin");
    assert.equal(cfg.enabled, true);
    assert.equal((cfg as Record<string, unknown>).password_encrypted, undefined); // never leaked

    const creds = getMdmCreds();
    assert.equal(creds!.password, "secret");

    // save without password keeps the existing one
    saveMdmConfig({ base_url: "http://h:8088", username: "admin", enabled: true });
    assert.equal(getMdmCreds()!.password, "secret");

    for (let i = 0; i < 5; i++) recordSync(false, "boom");
    const after5 = getMdmConfig();
    assert.equal(after5.enabled, false); // auto-disabled
    assert.equal(after5.consecutive_errors, 5);
    assert.equal(after5.last_error, "boom");

    recordSync(true);
    assert.equal(getMdmConfig().consecutive_errors, 0);
    assert.equal(getMdmConfig().last_error, null);
  });
});
