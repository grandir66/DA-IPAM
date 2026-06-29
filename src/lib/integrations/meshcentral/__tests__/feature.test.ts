process.env.ENCRYPTION_KEY ||= "test-encryption-key-mesh-feature";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { getMeshState, installMeshFeature, uninstallMeshFeature } from "@/lib/integrations/meshcentral/feature";
import { mcTablesExist } from "@/lib/integrations/meshcentral/schema";

const T = "TESTMESHFEAT";
after(() => deleteTenantDatabase(T));

test("install creates schema + flips state to installed; uninstall reverses", () => {
  withTenant(T, () => {
    assert.equal(getMeshState().installed, false);

    installMeshFeature();
    assert.equal(getMeshState().installed, true);
    assert.equal(mcTablesExist(getTenantDb(T)), true);

    installMeshFeature(); // idempotent, no throw
    assert.equal(getMeshState().installed, true);

    uninstallMeshFeature();
    assert.equal(getMeshState().installed, false);
    assert.equal(mcTablesExist(getTenantDb(T)), false);

    uninstallMeshFeature(); // idempotent
    assert.equal(getMeshState().installed, false);
  });
});
