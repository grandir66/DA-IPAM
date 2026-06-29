process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-rsess0";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, upsertHost } from "@/lib/db-tenant";
import { applyMcSchemaMigrations } from "@/lib/integrations/meshcentral/schema";
import { recordRemoteSession } from "@/lib/integrations/meshcentral/remote-session-audit";
import {
  prepareRemoteSession,
  type RemoteSessionDeps,
} from "@/lib/integrations/meshcentral/remote-session";

const T = "TESTMCRSESS";
after(() => deleteTenantDatabase(T));

let lastMintOpts: unknown = null;
// DI fakes (no mock.module — unsupported under Node22+tsx). Real audit writer so
// we can assert the persisted row really omits the token.
const deps: RemoteSessionDeps = {
  getMeshCreds: () => ({
    serverUrl: "https://appliance.example/",
    domain: "mesh",
    meshId: "mesh//grp",
    serviceUser: "svc-daipam",
    loginTokenKey: Buffer.alloc(80, 7),
    adminUser: "admin",
    adminPass: "x",
  }),
  mintLoginToken: (opts) => {
    lastMintOpts = opts;
    return "TOKEN123";
  },
  buildRemoteSessionUrl: (o) =>
    `${o.serverUrl}?login=${o.token}&node=${o.nodeId}&viewmode=${o.viewmode}&hide=15`,
  recordRemoteSession,
};

test("prepareRemoteSession mints 3min/once token for service user and audits without token", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    applyMcSchemaMigrations(db);
    db.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'n')").run();
    const host = upsertHost({ network_id: 1, ip: "10.0.0.99" });
    db.prepare(
      "INSERT INTO mc_node (node_id, host_id, mesh_id, conn, match_status) VALUES ('node//xyz', ?, 'mesh//grp', 1, 'matched')",
    ).run(host!.id);

    const res = prepareRemoteSession({ hostId: host!.id, viewmode: 11, operator: "bob@corp" }, deps);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(
      res.url,
      "https://appliance.example/?login=TOKEN123&node=node//xyz&viewmode=11&hide=15",
    );
    assert.deepEqual(lastMintOpts, { meshUser: "user/mesh/svc-daipam", expireMinutes: 3, once: true });

    const row = db
      .prepare("SELECT * FROM mc_remote_session ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    assert.equal(row.host_id, host!.id);
    assert.equal(row.node_id, "node//xyz");
    assert.equal(row.operator, "bob@corp");
    assert.equal(row.mesh_user, "user/mesh/svc-daipam");
    assert.equal(row.viewmode, 11);
    assert.equal(row.token_once, 1);
    assert.equal(row.status, "minted");
    assert.ok(!JSON.stringify(row).includes("TOKEN123"), "token must not be persisted");
  });
});

test("prepareRemoteSession 404 when no matched node", () => {
  withTenant(T, () => {
    applyMcSchemaMigrations(getTenantDb(T));
    const res = prepareRemoteSession({ hostId: 12345, viewmode: 11, operator: "bob@corp" }, deps);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 404);
  });
});
