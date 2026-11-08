/**
 * Ogni Stormshield è un firewall (Riccardo, 08/11). Incidente: sull'hub SNS EVA2 era registrato `server` e restava fuori dal
 * giro dei parser della Mappa porte e dalla scheda da firewall.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-migra-stormshield";

import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { leggiSegno } from "@/lib/credentials/segni-t2";
import { convertiStormshieldFirewall, SEGNO_STORMSHIELD_FIREWALL } from "../migra-stormshield-firewall";
import { resolveDeviceTypeForCreate } from "@/lib/device-product-profiles";

const T = "TESTMIGRASTORMSHIELD";

describe("convertiStormshieldFirewall", () => {
  after(() => deleteTenantDatabase(T));
  it("lo Stormshield registrato server diventa firewall, gli altri no; una volta sola", () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      const ins = db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, product_profile) VALUES (?, ?, ?, ?, ?, 'ssh', ?)");
      ins.run(1, "SNS-LAB", "10.61.0.1", "server", "stormshield", "stormshield_firewall");
      ins.run(2, "srv-linux", "10.61.0.2", "server", "linux", "linux_server");
      ins.run(3, "SNS-GIA", "10.61.0.3", "firewall", "stormshield", null);
      db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_STORMSHIELD_FIREWALL);
      const log: string[] = [];
      assert.deepEqual(convertiStormshieldFirewall(db, (r) => log.push(r)), { eseguita: true, convertiti: 1 });
      assert.deepEqual(log, [`[${SEGNO_STORMSHIELD_FIREWALL}] 1 SNS-LAB server -> firewall`]);
      const tipo = (id: number) => (db.prepare("SELECT device_type FROM network_devices WHERE id = ?").get(id) as { device_type: string }).device_type;
      assert.deepEqual([tipo(1), tipo(2), tipo(3)], ["firewall", "server", "firewall"]);
      assert.match(leggiSegno(db, SEGNO_STORMSHIELD_FIREWALL) ?? "", /^done:/);
      db.prepare("UPDATE network_devices SET device_type = 'server' WHERE id = 1").run();
      assert.equal(convertiStormshieldFirewall(db).eseguita, false, "chiusa: una scelta fatta dopo a mano resta");
    });
  });
  it("alla creazione il profilo Stormshield dà firewall anche se la classificazione dice server", () => {
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "stormshield_firewall", classification: "server" }), "firewall");
  });
});
