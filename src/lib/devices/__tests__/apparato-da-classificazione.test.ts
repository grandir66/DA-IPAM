/**
 * Lato tecnico creato alla classificazione (Riccardo, 09/11/2026): classificare a mano un oggetto non ancora apparato
 * con un tipo leggibile in SNMP (stampante, UPS, switch, firewall…) non creava nulla — `scriviClassificazione` ricalcola
 * il device_type solo se l'apparato c'è già — e l'apparato restava da fare a mano con «Rendi apparato».
 * Regola scelta: si crea solo con una credenziale SNMP già validata sull'host.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/apparato-da-classificazione.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { scriviClassificazione } from "@/lib/classification/scrivi";
import { corpoApparatoDaClassificazione, creaApparatoDaClassificazione } from "../apparato-da-classificazione";
import type { HostPerProposta } from "../proposta-apparato";

void TEST_DATA_DIR;

const T = "TESTAPPARATODACLASSE";
const ARCHIVIO = [
  { id: 7, name: "snmp ro", credential_type: "snmp", port: null },
  { id: 8, name: "snmp v3", credential_type: "snmp_v3", port: null },
  { id: 9, name: "admin ssh", credential_type: "ssh", port: null },
];

function host(campi: Partial<HostPerProposta>): HostPerProposta {
  return {
    ip: "10.80.0.10", hostname: "ups-sala", custom_name: null, classification: "ups", classification_manual: 1,
    inferred_vendor: null, inferred_os_family: null, inferred_protocol: null, inferred_device_type: null,
    inferred_scan_target: null, device_manufacturer: null, os_info: null, model: null, vendor: null, snmp_data: null,
    host_credentials: [{ credential_id: 7, protocol_type: "snmp", port: 161, validated: 1 }], ...campi,
  };
}

describe("corpo dell'apparato dalla classificazione (regola pura)", () => {
  it("UPS con community validata → apparato ups, SNMP v2, con la sua credenziale", () => {
    const r = corpoApparatoDaClassificazione(host({}), ARCHIVIO);
    assert.ok("corpo" in r);
    assert.equal(r.corpo.device_type, "ups");
    assert.equal(r.corpo.classification, "ups");
    assert.equal(r.corpo.protocol, "snmp_v2");
    assert.equal(r.corpo.credential_id, 7);
    assert.equal(r.corpo.product_profile, "generic_ups");
    assert.equal(r.corpo.name, "ups-sala");
  });

  it("FortiGate con SNMP v3 validata → firewall Fortinet in SNMP v3", () => {
    const r = corpoApparatoDaClassificazione(
      host({ classification: "firewall", inferred_vendor: "fortinet", inferred_os_family: "network-os", host_credentials: [{ credential_id: 8, protocol_type: "snmp", port: 161, validated: 1 }] }),
      ARCHIVIO,
    );
    assert.ok("corpo" in r);
    assert.equal(r.corpo.device_type, "firewall");
    assert.equal(r.corpo.vendor, "fortinet");
    assert.equal(r.corpo.protocol, "snmp_v3");
    assert.equal(r.corpo.credential_id, 8);
  });

  it("senza una credenziale SNMP validata non si crea niente", () => {
    assert.deepEqual(corpoApparatoDaClassificazione(host({ host_credentials: [] }), ARCHIVIO), { motivo: "nessuna_credenziale_snmp" });
    assert.deepEqual(corpoApparatoDaClassificazione(host({ host_credentials: [{ credential_id: 7, protocol_type: "snmp", port: 161, validated: 0 }] }), ARCHIVIO), { motivo: "nessuna_credenziale_snmp" });
    assert.deepEqual(corpoApparatoDaClassificazione(host({ host_credentials: [{ credential_id: 9, protocol_type: "ssh", port: 22, validated: 1 }] }), ARCHIVIO), { motivo: "nessuna_credenziale_snmp" });
  });

  it("una classificazione che non si legge in SNMP non crea apparati", () => {
    for (const c of ["server", "workstation", "notebook", "telecamera", "voip", "iot"]) {
      assert.deepEqual(corpoApparatoDaClassificazione(host({ classification: c }), ARCHIVIO), { motivo: "classe_non_snmp" }, c);
    }
  });
});

describe("creazione dal tenant", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.80.0.0/24', 'prova')`).run();
      d.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (7, 'snmp ro', 'snmp')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip, hostname, classification) VALUES (1, 1, '10.80.0.10', 'ups-sala', 'unknown')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip, hostname, classification) VALUES (2, 1, '10.80.0.11', 'stampante', 'unknown')`).run();
      d.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (1, 7, 'snmp', 161, 1)`).run();
    });
  });
  after(() => deleteTenantDatabase(T));

  it("classificato UPS con community provata → nasce l'apparato ups, una volta sola", () => {
    withTenant(T, () => {
      scriviClassificazione(getTenantDb(T), { hostId: 1 }, "ups", { manuale: true });
      const esito = creaApparatoDaClassificazione(1);
      assert.equal(esito.creato, true, JSON.stringify(esito));
      const nd = getTenantDb(T).prepare("SELECT device_type, classification, protocol FROM network_devices WHERE host = '10.80.0.10'").get();
      assert.deepEqual(nd, { device_type: "ups", classification: "ups", protocol: "snmp_v2" });
      const binding = getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE credential_id = 7").get() as { n: number };
      assert.equal(binding.n, 1);
      // Una seconda classificazione non crea un doppione.
      assert.deepEqual(creaApparatoDaClassificazione(1), { creato: false, motivo: "gia_apparato" });
    });
  });

  it("classificato stampante senza credenziale SNMP → resta host", () => {
    withTenant(T, () => {
      scriviClassificazione(getTenantDb(T), { hostId: 2 }, "stampante", { manuale: true });
      assert.deepEqual(creaApparatoDaClassificazione(2), { creato: false, motivo: "nessuna_credenziale_snmp" });
      const n = (getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM network_devices WHERE host = '10.80.0.11'").get() as { n: number }).n;
      assert.equal(n, 0);
    });
  });
});
