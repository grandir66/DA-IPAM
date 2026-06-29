process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-remote";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, upsertHost } from "@/lib/db-tenant";
import { applyMcSchemaMigrations } from "@/lib/integrations/meshcentral/schema";
import { recordRemoteSession } from "@/lib/integrations/meshcentral/remote-session-audit";

const T = "TESTMCRS";
after(() => deleteTenantDatabase(T));

test("recordRemoteSession writes audit row WITHOUT token/key and returns id", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    applyMcSchemaMigrations(db);
    // FK satisfied: host_id→hosts, node_id→mc_node must exist (prod always does).
    db.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'n')").run();
    const host = upsertHost({ network_id: 1, ip: "10.0.0.42" });
    db.prepare(
      "INSERT INTO mc_node (node_id, host_id, mesh_id, conn, match_status) VALUES ('node//abc', ?, 'mesh//g', 1, 'matched')",
    ).run(host!.id);

    const id = recordRemoteSession({
      hostId: host!.id,
      nodeId: "node//abc",
      operator: "alice@corp",
      meshUser: "user/mesh/svc-daipam",
      viewmode: 11,
      expireMinutes: 3,
      once: true,
      status: "minted",
    });
    assert.ok(id > 0);

    const row = getTenantDb(T)
      .prepare("SELECT * FROM mc_remote_session WHERE id = ?")
      .get(id) as Record<string, unknown>;

    assert.equal(row.host_id, host!.id);
    assert.equal(row.node_id, "node//abc");
    assert.equal(row.operator, "alice@corp");
    assert.equal(row.mesh_user, "user/mesh/svc-daipam");
    assert.equal(row.viewmode, 11);
    assert.equal(row.token_expire_min, 3);
    assert.equal(row.token_once, 1);
    assert.equal(row.status, "minted");

    // No SECRET-bearing column may exist (token_expire_min / token_once are
    // int metadata, not secrets; the actual login token + key must never live here).
    const cols = getTenantDb(T)
      .prepare("PRAGMA table_info(mc_remote_session)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    const FORBIDDEN = ["token", "login_token", "login_token_key", "key", "cookie", "secret", "password"];
    assert.ok(!names.some((n) => FORBIDDEN.includes(n)), "no secret-bearing column on audit table");

    const blob = JSON.stringify(row).toLowerCase();
    assert.ok(!blob.includes("login"), "no token leaked into audit row");
  });
});
