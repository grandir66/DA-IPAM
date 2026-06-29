process.env.ENCRYPTION_KEY ||= "test-encryption-key-mesh-sync00";

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb, upsertHost } from "@/lib/db-tenant";
import { applyMcSchemaMigrations } from "@/lib/integrations/meshcentral/schema";
import { saveMeshConfig } from "@/lib/integrations/meshcentral/config";
import { syncMeshForTenant, _setControlClientFactory } from "@/lib/integrations/meshcentral/mesh-sync";
import type { MeshNode } from "@/lib/integrations/meshcentral/control-client";

const T = "TESTMESHSYNC";
after(() => deleteTenantDatabase(T));
afterEach(() => _setControlClientFactory(null));

function node(over: Partial<MeshNode> = {}): MeshNode {
  return {
    nodeId: "node//N1",
    name: "PC-01",
    rname: "PC-01.local",
    meshId: "mesh//AAA",
    ip: "10.9.9.5",
    macs: ["aa:bb:cc:dd:ee:ff"],
    osdesc: "Windows 11",
    conn: 1,
    lastConnect: "2026-06-29T10:00:00.000Z",
    ...over,
  };
}

function seedConfig() {
  saveMeshConfig({
    serverUrl: "https://mesh.example.it",
    domain: "",
    meshId: "mesh//AAA",
    serviceUser: "svc-daipam",
    loginTokenKey: "aa".repeat(80),
    adminUser: "admin",
    adminPass: "pw",
  });
}

test("matched node upserts mc_node with host_id and match_status=matched", () => {
  return withTenant(T, async () => {
    applyMcSchemaMigrations(getTenantDb(T));
    seedConfig();
    // seed a host the node resolves to (by IP 10.9.9.5)
    const net = getTenantDb(T).prepare("INSERT INTO networks (name, cidr) VALUES ('n','10.9.9.0/24')").run();
    const host = upsertHost({ network_id: Number(net.lastInsertRowid), ip: "10.9.9.5" });

    _setControlClientFactory(() => ({ listNodes: async () => [node()], close() {} }));
    const r = await syncMeshForTenant();
    assert.equal(r.totalNodes, 1);
    assert.equal(r.matched, 1);
    assert.equal(r.unmatched, 0);

    const row = getTenantDb(T).prepare("SELECT host_id, match_status, conn, name FROM mc_node WHERE node_id = ?").get("node//N1") as { host_id: number; match_status: string; conn: number; name: string };
    assert.equal(row.host_id, host!.id);
    assert.equal(row.match_status, "matched");
    assert.equal(row.conn, 1);
    assert.equal(row.name, "PC-01");
  });
});

test("node with no anchor → match_status=unmatched, host_id null", () => {
  return withTenant(T, async () => {
    applyMcSchemaMigrations(getTenantDb(T));
    seedConfig();
    _setControlClientFactory(() => ({
      listNodes: async () => [node({ nodeId: "node//N2", ip: null, macs: [], rname: "ghost", name: "ghost" })],
      close() {},
    }));
    const r = await syncMeshForTenant();
    assert.equal(r.unmatched >= 1, true);
    const row = getTenantDb(T).prepare("SELECT host_id, match_status FROM mc_node WHERE node_id = ?").get("node//N2") as { host_id: number | null; match_status: string };
    assert.equal(row.host_id, null);
    assert.equal(row.match_status, "unmatched");
  });
});

test("re-sync does NOT overwrite a manual binding", () => {
  return withTenant(T, async () => {
    applyMcSchemaMigrations(getTenantDb(T));
    seedConfig();
    // Create two networks/hosts:
    // - manualNet/manualHost: the host that the manual bind points to
    // - resolveNet/resolveHost: a different host that the resolver would find by IP
    const manualNet = getTenantDb(T).prepare("INSERT INTO networks (name, cidr) VALUES ('manualnet','10.9.7.0/24')").run();
    const manualHost = upsertHost({ network_id: Number(manualNet.lastInsertRowid), ip: "10.9.7.1" });

    // pre-existing manual bind: node N3 bound to manualHost, match_status='manual'
    getTenantDb(T).prepare(
      "INSERT INTO mc_node (node_id, host_id, mesh_id, name, match_status) VALUES ('node//N3', ?, 'mesh//AAA', 'old-name', 'manual')"
    ).run(manualHost!.id);

    // sync returns N3 with IP pointing to a DIFFERENT host — must NOT change host_id/match_status
    const resolveNet = getTenantDb(T).prepare("INSERT INTO networks (name, cidr) VALUES ('resolvenet','10.9.8.0/24')").run();
    const other = upsertHost({ network_id: Number(resolveNet.lastInsertRowid), ip: "10.9.8.7" });
    _setControlClientFactory(() => ({
      listNodes: async () => [node({ nodeId: "node//N3", ip: "10.9.8.7", name: "new-name", conn: 1 })],
      close() {},
    }));
    await syncMeshForTenant();

    const row = getTenantDb(T).prepare("SELECT host_id, match_status, name, conn FROM mc_node WHERE node_id = 'node//N3'").get() as { host_id: number; match_status: string; name: string; conn: number };
    assert.equal(row.host_id, manualHost!.id, "manual host_id preserved");
    assert.equal(row.match_status, "manual", "manual status preserved");
    assert.notEqual(row.host_id, other!.id, "not rebound to resolved host");
    // volatile fields still refresh on a manual node:
    assert.equal(row.name, "new-name");
    assert.equal(row.conn, 1);
  });
});

test("no creds → returns zeros, no throw", () => {
  return withTenant("TESTMESHNOCFG", async () => {
    applyMcSchemaMigrations(getTenantDb("TESTMESHNOCFG"));
    const r = await syncMeshForTenant();
    assert.deepEqual(r, { totalNodes: 0, matched: 0, unmatched: 0 });
    deleteTenantDatabase("TESTMESHNOCFG");
  });
});
