import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb, upsertHost } from "@/lib/db-tenant";
import { applyMcSchemaMigrations } from "@/lib/integrations/meshcentral/schema";
import { listMeshNodes, bindNodeToHost } from "@/lib/integrations/meshcentral/db";

const T = "TESTMCDB";
after(() => deleteTenantDatabase(T));

function setup() {
  const db = getTenantDb(T);
  applyMcSchemaMigrations(db);
  db.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'net')").run();
}

function seedNode(o: { node_id: string; host_id?: number | null; match_status: string }) {
  getTenantDb(T)
    .prepare(
      "INSERT INTO mc_node (node_id, host_id, mesh_id, name, conn, match_status) VALUES (?, ?, 'mesh//AAA', ?, 1, ?)",
    )
    .run(o.node_id, o.host_id ?? null, o.node_id, o.match_status);
}

test("listMeshNodes joins host info and lists unmatched first", () => {
  withTenant(T, () => {
    setup();
    const host = upsertHost({ network_id: 1, ip: "10.0.0.5", hostname: "PC-MATCHED" });
    seedNode({ node_id: "node//M", host_id: host!.id, match_status: "matched" });
    seedNode({ node_id: "node//U", host_id: null, match_status: "unmatched" });

    const rows = listMeshNodes();
    assert.equal(rows.length, 2);
    // unmatched sorts first
    assert.equal(rows[0].node_id, "node//U");
    assert.equal(rows[0].host_id, null);
    assert.equal(rows[0].host_hostname, null);
    const matched = rows.find((r) => r.node_id === "node//M")!;
    assert.equal(matched.host_id, host!.id);
    assert.equal(matched.host_hostname, "PC-MATCHED");
    assert.equal(matched.host_ip, "10.0.0.5");
  });
});

test("bindNodeToHost sets host_id + match_status=manual + audit row", () => {
  withTenant(T, () => {
    setup();
    const host = upsertHost({ network_id: 1, ip: "10.0.0.9", hostname: "TARGET" });
    seedNode({ node_id: "node//B", host_id: null, match_status: "unmatched" });

    const res = bindNodeToHost("node//B", host!.id, "op@domarc.it");
    assert.deepEqual(res, { ok: true });

    const row = getTenantDb(T)
      .prepare("SELECT host_id, match_status FROM mc_node WHERE node_id = 'node//B'")
      .get() as { host_id: number; match_status: string };
    assert.equal(row.host_id, host!.id);
    assert.equal(row.match_status, "manual");

    const audit = getTenantDb(T)
      .prepare("SELECT node_id, host_id, operator FROM mc_node_bind WHERE node_id = 'node//B'")
      .get() as { node_id: string; host_id: number; operator: string };
    assert.equal(audit.host_id, host!.id);
    assert.equal(audit.operator, "op@domarc.it");
  });
});

test("bindNodeToHost rejects unknown node and unknown host", () => {
  withTenant(T, () => {
    setup();
    const host = upsertHost({ network_id: 1, ip: "10.0.0.11" });
    seedNode({ node_id: "node//X", host_id: null, match_status: "unmatched" });

    assert.deepEqual(bindNodeToHost("node//NOPE", host!.id, "op"), {
      ok: false,
      error: "node_not_found",
    });
    assert.deepEqual(bindNodeToHost("node//X", 999999, "op"), {
      ok: false,
      error: "host_not_found",
    });
  });
});
