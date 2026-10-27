/**
 * Il sistema operativo degli host va all'edge con /networks/ensure (Riccardo, 27/10/2026: «l'edge non
 * ha alcuna info sul sistema operativo, quando IPAM ne ha diverse»).
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/edge-hosts-os.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { hostsForEdgeSync } from "@/lib/vuln/edge-subnet-bridge";

const T = "EDGEOS27";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("gli host per l'edge portano il sistema operativo", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.4.0.0/24', 'x')").run().lastInsertRowid);
    d.prepare("INSERT INTO hosts (network_id, ip, status, os_info) VALUES (?, '10.4.0.7', 'online', 'Windows Server 2022')").run(n);
    d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.4.0.8', 'online')").run(n);
    const h = hostsForEdgeSync(n);
    assert.deepEqual(h.map((x) => [x.ip, x.os_info]), [["10.4.0.7", "Windows Server 2022"], ["10.4.0.8", null]]);
  });
});
