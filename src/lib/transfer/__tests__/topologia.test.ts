// Revisione finale I6 (topologia fase 2): le mappe passo passo viaggiano col
// tenant, e lo storico dei MAC per porta di una sorgente alla versione
// precedente (doppi per apparato, MAC e porta) si importa sotto l'indice unico.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import { migrateTopologyPhase1, migrateTopologyPhase2 } from "../../db-tenant";

function tenant(migrato: boolean): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  if (migrato) {
    migrateTopologyPhase1(d);
    migrateTopologyPhase2(d);
  }
  return d;
}
function hub(): Database.Database {
  const d = new Database(":memory:");
  d.exec(HUB_SCHEMA_SQL);
  return d;
}
const OPZ = { tenantCode: "DEFAULT", includeVault: false, passphrase: "prova-topologia", exportedAt: "2026-10-13T10:00:00.000Z", appVersion: "test" };

test("le mappe passo passo e le loro righe viaggiano col tenant", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const src = tenant(true);
  src.prepare("INSERT INTO topology_maps (id, name, kind, roots) VALUES (4, 'Sede', 'passo', '[\"dev:1\"]')").run();
  src.prepare("INSERT INTO topology_position (view, node_id, x, y, pinned) VALUES ('mappa:4', 'dev:1', 0, 0, 0)").run();
  const bundle = exportTenant({ tenantDb: src, hubDb: hub(), options: { ...OPZ, tiers: [] } });
  const dst = tenant(true);
  const res = importTenant({ bundle, tenantDb: dst, hubDb: hub(), options: { tenantCode: "DEFAULT", passphrase: OPZ.passphrase, wipe: false } });
  assert.equal(res.tables.topology_maps, 1);
  assert.deepEqual(dst.prepare("SELECT id, name, kind, roots FROM topology_maps").all(), [{ id: 4, name: "Sede", kind: "passo", roots: '["dev:1"]' }]);
});

test("i doppi (apparato, MAC, porta) di una sorgente vecchia si riducono alla riga più recente", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const src = tenant(false); // versione precedente: niente indice unico
  src.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.1', 'switch', 'hp', 'snmp_v2')").run();
  const ins = src.prepare("INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp) VALUES (1, ?, ?, ?)");
  ins.run("02:00:00:00:00:01", "Port 1", "2026-10-01 03:00:00");
  ins.run("02:00:00:00:00:01", "Port 1", "2026-10-12 03:00:00");
  ins.run("02:00:00:00:00:01", "Port 1", "2026-10-05 03:00:00");
  ins.run("02:00:00:00:00:02", "Port 1", "2026-10-12 03:00:00");
  const bundle = exportTenant({ tenantDb: src, hubDb: hub(), options: { ...OPZ, tiers: ["history"] } });
  const dst = tenant(true);
  const res = importTenant({ bundle, tenantDb: dst, hubDb: hub(), options: { tenantCode: "DEFAULT", passphrase: OPZ.passphrase, wipe: false } });
  assert.equal(res.tables.mac_port_entries, 2);
  assert.deepEqual(dst.prepare("SELECT mac, timestamp FROM mac_port_entries ORDER BY mac").all(), [
    { mac: "02:00:00:00:00:01", timestamp: "2026-10-12 03:00:00" },
    { mac: "02:00:00:00:00:02", timestamp: "2026-10-12 03:00:00" },
  ]);
});
