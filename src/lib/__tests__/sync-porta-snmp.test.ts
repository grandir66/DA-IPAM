/**
 * Le scansioni non spostano la porta degli apparati letti in SNMP (tappa 1
 * credenziali, 15/10).
 *
 * Incidente: un MikroTik in SNMP sulla 161 dopo una scansione era sulla 8291
 * (Winbox): la 161 è UDP e non compare mai fra le porte TCP aperte, quindi
 * syncNetworkDeviceFromHostScan la credeva chiusa e ne sceglieva un'altra, e
 * le letture SNMP successive andavano sulla porta sbagliata.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/sync-porta-snmp.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, syncNetworkDeviceFromHostScan as syncTenant } from "@/lib/db-tenant";
import { syncNetworkDeviceFromHostScan as syncFacciata } from "@/lib/db";

const T = "TESTSYNCPORTASNMP";

function porta(id: number): number {
  return (getTenantDb(T).prepare(`SELECT port FROM network_devices WHERE id = ?`).get(id) as { port: number }).port;
}

describe("syncNetworkDeviceFromHostScan — porta", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      const ins = d.prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, port) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      ins.run(1, "mk-snmp", "10.50.0.1", "router", "mikrotik", "snmp_v2", 161);
      ins.run(2, "mk-snmp3", "10.50.0.2", "router", "mikrotik", "snmp_v3", 161);
      ins.run(3, "linux-ssh", "10.50.0.3", "server", "linux", "ssh", 22);
      ins.run(4, "mk-snmp-facciata", "10.50.0.4", "router", "mikrotik", "snmp_v2", 161);
      // Pilota 16/10: MikroTik passato da SNMP a SSH con la porta rimasta 161.
      ins.run(5, "mk-ssh-161", "10.50.0.5", "switch", "mikrotik", "ssh", 161);
      ins.run(6, "mk-api", "10.50.0.6", "router", "mikrotik", "api", 443);
    });
  });
  after(() => deleteTenantDatabase(T));

  it("MikroTik in SNMP v2 sulla 161 con TCP 8291 e 22 aperte → resta 161", () => {
    withTenant(T, () => syncTenant("10.50.0.1", [{ port: 8291 }, { port: 22 }], null));
    assert.equal(porta(1), 161);
  });

  it("SNMP v3: idem", () => {
    withTenant(T, () => syncTenant("10.50.0.2", [{ port: 8728 }], null));
    assert.equal(porta(2), 161);
  });

  it("stesso caso dalla facciata db.ts", () => {
    withTenant(T, () => syncFacciata("10.50.0.4", [{ port: 8291 }, { port: 22 }], null));
    assert.equal(porta(4), 161);
  });

  it("MikroTik in SSH sulla 161 con 21, 22, 23, 80, 8291 aperte → va sulla 22, non sulla 8291 (Winbox)", () => {
    withTenant(T, () => syncTenant("10.50.0.5", [{ port: 21 }, { port: 22 }, { port: 23 }, { port: 80 }, { port: 8291 }], null));
    assert.equal(porta(5), 22);
  });

  it("MikroTik in API con la 443 chiusa e la 8728 aperta → le porte del produttore valgono ancora per l'API", () => {
    withTenant(T, () => syncTenant("10.50.0.6", [{ port: 8728 }, { port: 22 }], null));
    assert.equal(porta(6), 8728);
  });

  it("SSH con la 22 chiusa e la 2222 aperta → passa alla 2222, come prima", () => {
    withTenant(T, () => syncTenant("10.50.0.3", [{ port: 2222 }], null));
    assert.equal(porta(3), 2222);
  });
});
