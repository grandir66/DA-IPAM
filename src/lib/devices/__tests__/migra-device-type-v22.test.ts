/**
 * Conversione una tantum di device_type per le periferiche (Riccardo, 09/11/2026). Stampanti, UPS, VoIP, telecamere e
 * IoT erano `switch` (o `server`, dalla vecchia finestra in blocco): finivano fra gli switch e il giro ne leggeva porte e
 * MAC. A 72729 la stampante `.1.215` e l'UPS `.0.240` sono stati corretti a mano il 09/11.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/migra-device-type-v22.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { leggiSegno } from "@/lib/credentials/segni-t2";
import { convertiDeviceTypeV22, SEGNO_DEVICE_TYPE_V22 } from "../migra-device-type-v22";

void TEST_DATA_DIR;

const T = "TESTMIGRADEVICETYPEV22";
const tipo = (id: number) =>
  (getTenantDb(T).prepare("SELECT device_type, classification FROM network_devices WHERE id = ?").get(id) as
    { device_type: string; classification: string | null });

describe("convertiDeviceTypeV22", () => {
  before(() => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_DEVICE_TYPE_V22);
      db.prepare("DELETE FROM network_devices").run();
      const ins = db.prepare(
        `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, classification, product_profile)
         VALUES (?, ?, ?, ?, ?, 'snmp_v2', ?, ?)`);
      ins.run(1, "ups-sala", "10.70.0.1", "switch", "other", "ups", "generic_ups");
      ins.run(2, "stampante-hp", "10.70.0.2", "switch", "hp", "stampante", "hp_stampante");
      ins.run(3, "mfp-server", "10.70.0.3", "server", "other", "multifunzione", null);
      ins.run(4, "cam-senza-classe", "10.70.0.4", "switch", "other", null, "generic_cam");
      ins.run(5, "centralino", "10.70.0.5", "switch", "other", "voip", "generic_voip");
      ins.run(6, "sensore", "10.70.0.6", "switch", "other", "sensore", "generic_iot");
      ins.run(7, "sw-vero", "10.70.0.7", "switch", "cisco", "switch", "cisco_switch");
      ins.run(8, "sw-senza-niente", "10.70.0.8", "switch", "other", null, null);
      ins.run(9, "srv", "10.70.0.9", "server", "linux", "server", "linux_server");
      ins.run(10, "ups-gia-giusto", "10.70.0.10", "ups", "other", "ups", "generic_ups");
    });
  });
  after(() => deleteTenantDatabase(T));

  it("le periferiche prendono il loro tipo, switch e server veri non si toccano, la classificazione resta", () => {
    withTenant(T, () => {
      const righe: string[] = [];
      const esito = convertiDeviceTypeV22(getTenantDb(T), (r) => righe.push(r));
      assert.deepEqual(esito, { eseguita: true, convertiti: 6 });
      assert.equal(tipo(1).device_type, "ups");
      assert.equal(tipo(2).device_type, "stampante");
      assert.equal(tipo(3).device_type, "stampante");
      assert.equal(tipo(4).device_type, "telecamera");
      assert.equal(tipo(5).device_type, "voip");
      assert.equal(tipo(6).device_type, "iot");
      assert.equal(tipo(7).device_type, "switch");
      assert.equal(tipo(8).device_type, "switch");
      assert.equal(tipo(9).device_type, "server");
      assert.equal(tipo(10).device_type, "ups");
      assert.equal(tipo(1).classification, "ups");
      assert.equal(tipo(4).classification, null);
      // Elenco per nome nel log, uno per riga cambiata.
      assert.equal(righe.length, 6);
      assert.ok(righe.some((r) => r.includes("1 ups-sala switch -> ups")));
    });
  });

  it("il segno chiude la conversione: la seconda volta non fa niente", () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      assert.match(leggiSegno(db, SEGNO_DEVICE_TYPE_V22) ?? "", /^done:.*:convertiti=6$/);
      db.prepare("UPDATE network_devices SET device_type = 'switch' WHERE id = 1").run();
      assert.deepEqual(convertiDeviceTypeV22(db, () => {}), { eseguita: false, convertiti: 0 });
      assert.equal(tipo(1).device_type, "switch");
    });
  });
});
