/**
 * Discovery, filtro «solo con dati acquisiti» (Riccardo, 29/10): getAllHostsEnriched dice per
 * ogni host se l'apparato ha l'inventario letto, con la stessa regola di
 * isNetworkDeviceAcquisitionComplete (JSON della query, o scansione Proxmox con esito).
 *
 * Run: node --import tsx --test src/lib/__tests__/discovery-dati-acquisiti-db.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getAllHostsEnriched, getTenantDb, withTenant } from "@/lib/db-tenant";

const T = "TESTDATIACQ";
const db = () => getTenantDb(T);

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("acquisito con la query, con Proxmox, mai letto, host senza apparato", () => {
  db().exec(`
    INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24');
    INSERT INTO hosts (id, network_id, ip, status) VALUES (1, 1, '10.0.0.1', 'online'), (2, 1, '10.0.0.2', 'online'),
      (3, 1, '10.0.0.3', 'online'), (4, 1, '10.0.0.4', 'online');
    INSERT INTO network_devices (name, host, device_type, vendor, protocol, last_device_info_json, last_info_update)
      VALUES ('a', '10.0.0.1', 'server', 'linux', 'ssh', '{"model":"x"}', '2026-10-29 09:00:00');
    INSERT INTO network_devices (name, host, device_type, vendor, protocol, last_proxmox_scan_at, last_proxmox_scan_result)
      VALUES ('b', '10.0.0.2', 'hypervisor', 'proxmox', 'api', '2026-10-28 08:00:00', '{"ok":true}');
    INSERT INTO network_devices (name, host, device_type, vendor, protocol, last_info_update)
      VALUES ('c', '10.0.0.3', 'switch', 'hp', 'snmp_v2', '2026-10-27 08:00:00');
  `);
  const per = new Map(withTenant(T, () => getAllHostsEnriched()).map((h) => [h.ip, h]));
  assert.equal(per.get("10.0.0.1")?.device_acquired, true);
  assert.equal(per.get("10.0.0.1")?.device_acquired_at, "2026-10-29 09:00:00");
  assert.equal(per.get("10.0.0.2")?.device_acquired, true);
  assert.equal(per.get("10.0.0.2")?.device_acquired_at, "2026-10-28 08:00:00");
  // Una data di lettura senza dati salvati non vale come acquisizione.
  assert.equal(per.get("10.0.0.3")?.device_acquired, false);
  assert.equal(per.get("10.0.0.3")?.device_acquired_at, null);
  assert.equal(per.get("10.0.0.4")?.device_acquired, false);
  // Il blob JSON non arriva alla tabella.
  assert.equal("last_device_info_json" in (per.get("10.0.0.1") ?? {}), false);
});
