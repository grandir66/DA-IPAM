/**
 * Conversione una tantum di device_type (21/10): `switch` era il workaround di schema per server,
 * NAS e firewall. Incidente: 22 righe dell'hub (DA-DC01, da-wazuh...) avevano device_type='switch'
 * con classificazione server, e la scheda e la topologia le trattavano da switch.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/migra-device-type-v21.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-migra-device-type";

import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { leggiSegno } from "@/lib/credentials/segni-t2";
import { convertiDeviceTypeV21, SEGNO_DEVICE_TYPE_V21 } from "../migra-device-type-v21";

const T = "TESTMIGRADEVICETYPE";
const tipo = (id: number) =>
  (getTenantDb(T).prepare("SELECT device_type, classification FROM network_devices WHERE id = ?").get(id) as
    { device_type: string; classification: string | null });

describe("convertiDeviceTypeV21", () => {
  before(() => {
    withTenant(T, () => {
      const ins = getTenantDb(T).prepare(
        `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, classification)
         VALUES (?, ?, ?, ?, ?, 'ssh', ?)`);
      ins.run(1, "DA-DC01", "10.60.0.1", "switch", "windows", "server");
      ins.run(2, "sw-ubnt", "10.60.0.2", "switch", "ubiquiti", "switch");
      ins.run(3, "sw-senza", "10.60.0.3", "switch", "cisco", null);
      ins.run(4, "pippo", "10.60.0.4", "switch", "other", "pippo_custom");
      ins.run(5, "rtr", "10.60.0.5", "router", "mikrotik", "router");
    });
  });
  after(() => deleteTenantDatabase(T));

  it("la riga server/switch diventa server, switch/switch resta, la classificazione non si tocca", () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_DEVICE_TYPE_V21);
      const log: string[] = [];
      const esito = convertiDeviceTypeV21(db, (r) => log.push(r));
      assert.equal(esito.eseguita, true);
      assert.equal(esito.convertiti, 1);
      assert.deepEqual(tipo(1), { device_type: "server", classification: "server" });
      assert.deepEqual(tipo(2), { device_type: "switch", classification: "switch" });
      assert.equal(tipo(3).device_type, "switch");
      assert.equal(tipo(4).device_type, "switch");
      assert.equal(tipo(5).device_type, "router");
      // l'elenco è per nome, scritto prima
      assert.equal(log.length, 1);
      assert.match(log[0], /1 DA-DC01 switch -> server/);
      assert.match(leggiSegno(db, SEGNO_DEVICE_TYPE_V21) ?? "", /^done:.*convertiti=1/);
    });
  });

  it("idempotente: col segno non rifà niente", () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      db.prepare("UPDATE network_devices SET device_type = 'switch' WHERE id = 1").run();
      const esito = convertiDeviceTypeV21(db, () => {});
      assert.equal(esito.eseguita, false);
      assert.equal(tipo(1).device_type, "switch");
    });
  });
});
