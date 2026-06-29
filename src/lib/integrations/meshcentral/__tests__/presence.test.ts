process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-presence";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { applyPatchModuleMigrations } from "@/lib/patch/schema";
import { getEndpointAgentsForHosts } from "@/lib/integrations/meshcentral/presence";

const TENANTS = ["TESTMCPRES0", "TESTMCPRES1", "TESTMCPRES2"];
after(() => TENANTS.forEach((t) => deleteTenantDatabase(t)));

function seed(code: string): void {
  const db = getTenantDb(code);
  applyPatchModuleMigrations(db); // crea patch_operations
  // inv_agent_endpoint: tabella opt-in del modulo inventory — qui la creo minimale
  // (presence.ts legge solo host_id + last_seen_at, e la guard tableExists scatta su
  //  tenant senza modulo: questo verifica il path "tabella presente").
  db.exec(
    "CREATE TABLE IF NOT EXISTS inv_agent_endpoint (device_id TEXT PRIMARY KEY, host_id INTEGER, last_seen_at TEXT)",
  );
  db.exec("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1,'10.0.0.0/24','n')");
  db.exec("INSERT OR IGNORE INTO hosts (id, network_id, ip) VALUES (10,1,'10.0.0.10'),(11,1,'10.0.0.11'),(12,1,'10.0.0.12')");
  db.exec(`INSERT INTO mc_node (node_id, host_id, mesh_id, conn, synced_at, match_status)
           VALUES ('node-a',10,'mesh1',1,datetime('now'),'matched'),
                  ('node-b',11,'mesh1',0,datetime('now','-40 days'),'matched')`);
  db.prepare("INSERT INTO wazuh_agent (agent_id, host_id, status, synced_at) VALUES (?,?,?,datetime('now'))")
    .run("001", 10, "active");
  db.prepare("INSERT INTO inv_agent_endpoint (device_id, host_id, last_seen_at) VALUES (?,?,datetime('now'))").run("dev10", 10);
  db.prepare("INSERT INTO inv_agent_endpoint (device_id, host_id, last_seen_at) VALUES (?,?,datetime('now','-30 days'))").run("dev11", 11);
  db.prepare("INSERT INTO patch_operations (host_id,user_id,package_manager,action,status,exit_code,started_at) VALUES (?,?, 'choco','probe','success',0,datetime('now'))").run(10, 1);
  db.prepare("INSERT INTO patch_operations (host_id,user_id,package_manager,action,status,exit_code,started_at) VALUES (?,?, 'choco','probe','failed',1,datetime('now','-1 days'))").run(11, 1);
  db.prepare("INSERT INTO patch_operations (host_id,user_id,package_manager,action,status,exit_code,started_at) VALUES (?,?, 'choco','probe','success',0,datetime('now','-2 days'))").run(11, 1);
}

test("empty hostIds -> empty Map", () => {
  withTenant(TENANTS[0], () => {
    const m = getEndpointAgentsForHosts([]);
    assert.equal(m.size, 0);
  });
});

test("freshness thresholds per source", () => {
  withTenant(TENANTS[1], () => {
    seed(TENANTS[1]);
    const m = getEndpointAgentsForHosts([10, 11, 12]);

    const h10 = m.get(10)!;
    assert.equal(h10.mesh.present, true);
    assert.equal(h10.mesh.nodeId, "node-a");
    assert.equal(h10.mesh.conn, 1);
    assert.equal(h10.wazuh.present, true);
    assert.equal(h10.wazuh.status, "active");
    assert.equal(h10.glpi.present, true);
    assert.equal(h10.choco.present, true);
    assert.equal(h10.choco.probeStatus, "active");

    const h11 = m.get(11)!;
    assert.equal(h11.mesh.present, true);
    assert.equal(h11.mesh.conn, 0);
    assert.equal(h11.glpi.present, false);
    assert.equal(h11.choco.present, true);
    assert.equal(h11.choco.probeStatus, "stale");
    assert.equal(h11.wazuh.present, false);

    const h12 = m.get(12)!;
    assert.equal(h12.mesh.present, false);
    assert.equal(h12.wazuh.present, false);
    assert.equal(h12.glpi.present, false);
    assert.equal(h12.choco.present, false);
  });
});

test("no N+1: exactly 4 prepared statements (one per source)", () => {
  withTenant(TENANTS[2], () => {
    seed(TENANTS[2]);
    const db = getTenantDb(TENANTS[2]);
    const orig = db.prepare.bind(db);
    let prepares = 0;
    const patched = db as unknown as { prepare: (sql: string) => unknown };
    patched.prepare = (sql: string) => { prepares++; return orig(sql); };
    try {
      getEndpointAgentsForHosts([10, 11, 12]);
    } finally {
      patched.prepare = orig;
    }
    assert.equal(prepares, 4); // mesh, wazuh, glpi, choco — never per-host
  });
});
