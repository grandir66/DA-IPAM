/**
 * Un solo punto scrive la classificazione su host e apparato (tappa 5, 21/10).
 * Incidente: la scelta a mano su un lato non arrivava all'altro, e la scansione
 * riscriveva la classificazione di un apparato scelta dall'utente.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/classification/__tests__/scrivi.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-scrivi-classificazione";

import { scriviClassificazione, tornaAutomatica, scriviSeCambiata } from "../scrivi";
import { withTenant, getTenantDb, deleteTenantDatabase, syncNetworkDeviceFromHostScan } from "@/lib/db-tenant";

const T = "TESTSCRIVICLASS";

function riga(tab: "hosts" | "network_devices", id: number) {
  return getTenantDb(T).prepare(`SELECT * FROM ${tab} WHERE id = ?`).get(id) as Record<string, unknown>;
}

describe("scriviClassificazione / tornaAutomatica", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.50.0.0/24', 'prova')`).run();
    });
  });
  after(() => deleteTenantDatabase(T));
  beforeEach(() => {
    const d = getTenantDb(T);
    d.prepare(`DELETE FROM network_devices`).run();
    d.prepare(`DELETE FROM hosts`).run();
    d.prepare(`INSERT INTO hosts (id, network_id, ip, classification, classification_manual) VALUES (1, 1, '10.50.0.5', 'unknown', 0)`).run();
    d.prepare(
      `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, classification, product_profile)
       VALUES (1, 'sw', '10.50.0.5', 'switch', 'other', 'ssh', 'switch', NULL)`,
    ).run();
  });

  it("dall'apparato all'host: stesso valore, host manuale, device_type ricalcolato", () => {
    const r = scriviClassificazione(getTenantDb(T), { deviceId: 1 }, "firewall", { manuale: true });
    assert.deepEqual(r, { hostId: 1, deviceId: 1 });
    assert.equal(riga("hosts", 1).classification, "firewall");
    assert.equal(riga("hosts", 1).classification_manual, 1);
    assert.equal(riga("network_devices", 1).classification, "firewall");
    assert.equal(riga("network_devices", 1).device_type, "firewall");
    assert.equal(riga("network_devices", 1).classification_manual, 1);
  });

  it("dall'host all'apparato: l'apparato col suo IP riceve valore canonico e ruoli", () => {
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "dns_server", { manuale: true, ruoli: ["dhcp"] });
    for (const [tab, id] of [["hosts", 1], ["network_devices", 1]] as const) {
      const x = riga(tab, id);
      assert.equal(x.classification, "server", tab);
      assert.equal(JSON.parse(String(x.server_roles)).sort().join(","), "dhcp,dns", tab);
    }
    assert.equal(riga("network_devices", 1).device_type, "server");
  });

  it("host senza apparato e apparato senza host: l'altro lato è null, niente errore", () => {
    getTenantDb(T).prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (2, 1, '10.50.0.6')`).run();
    assert.deepEqual(scriviClassificazione(getTenantDb(T), { hostId: 2 }, "printer", { manuale: true }), { hostId: 2, deviceId: null });
    getTenantDb(T).prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (2, 'x', '10.9.9.9', 'server', 'other', 'ssh')`).run();
    assert.deepEqual(scriviClassificazione(getTenantDb(T), { deviceId: 2 }, "server", { manuale: true }), { hostId: null, deviceId: 2 });
  });

  it("una scansione non cambia la classificazione di un apparato scelto a mano", () => {
    scriviClassificazione(getTenantDb(T), { deviceId: 1 }, "router", { manuale: true });
    withTenant(T, () => syncNetworkDeviceFromHostScan("10.50.0.5", [{ port: 22 }], "firewall"));
    assert.equal(riga("network_devices", 1).classification, "router");
  });

  it("senza scelta a mano la scansione continua a riclassificare l'apparato di infrastruttura", () => {
    withTenant(T, () => syncNetworkDeviceFromHostScan("10.50.0.5", [{ port: 22 }], "firewall"));
    assert.equal(riga("network_devices", 1).classification, "firewall");
  });

  it("tornaAutomatica azzera il flag su entrambi, dal lato host come dal lato apparato", () => {
    scriviClassificazione(getTenantDb(T), { deviceId: 1 }, "router", { manuale: true });
    tornaAutomatica(getTenantDb(T), { hostId: 1 });
    assert.equal(riga("hosts", 1).classification_manual, 0);
    assert.equal(riga("network_devices", 1).classification_manual, 0);
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "router", { manuale: true });
    tornaAutomatica(getTenantDb(T), { deviceId: 1 });
    assert.equal(riga("hosts", 1).classification_manual, 0);
    assert.equal(riga("network_devices", 1).classification_manual, 0);
  });

  it("manuale = false scrive il valore senza fissarlo", () => {
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "server", { manuale: false });
    assert.equal(riga("hosts", 1).classification, "server");
    assert.equal(riga("hosts", 1).classification_manual, 0);
    assert.equal(riga("network_devices", 1).classification_manual, 0);
  });
  it("ruoli: con `ruoli` definito il valore SOSTITUISCE (si può togliere un ruolo, anche l'ultimo)", () => {
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "server", { manuale: true, ruoli: ["dns", "dhcp"] });
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "server", { manuale: true, ruoli: ["dhcp"] });
    for (const [tab, id] of [["hosts", 1], ["network_devices", 1]] as const) {
      assert.equal(riga(tab, id).server_roles, JSON.stringify(["dhcp"]), tab);
    }
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "server", { manuale: true, ruoli: [] });
    for (const [tab, id] of [["hosts", 1], ["network_devices", 1]] as const) {
      assert.equal(riga(tab, id).server_roles, null, tab);
    }
  });

  it("ruoli: senza `ruoli` (scrittura automatica) i ruoli esistenti si uniscono, non si perdono", () => {
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "server", { manuale: true, ruoli: ["dhcp"] });
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "dns_server", { manuale: false });
    assert.equal(JSON.parse(String(riga("hosts", 1).server_roles)).sort().join(","), "dhcp,dns");
  });

  it("una classificazione diversa da «server» svuota i ruoli", () => {
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "server", { manuale: true, ruoli: ["dns"] });
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "workstation", { manuale: true });
    assert.equal(riga("hosts", 1).server_roles, null);
    assert.equal(riga("network_devices", 1).server_roles, null);
  });

  it("«unknown» dall'host non tocca l'apparato abbinato né fissa il flag", () => {
    scriviClassificazione(getTenantDb(T), { deviceId: 1 }, "router", { manuale: false });
    scriviClassificazione(getTenantDb(T), { hostId: 1 }, "unknown", { manuale: true });
    assert.equal(riga("hosts", 1).classification, "unknown");
    assert.equal(riga("hosts", 1).classification_manual, 0);
    assert.equal(riga("network_devices", 1).classification, "router");
    assert.equal(riga("network_devices", 1).classification_manual, 0);
  });

  it("scriviSeCambiata: lo stesso valore non fissa «a mano»; un valore nuovo sì", () => {
    const db = getTenantDb(T);
    const esistente = { classification: "switch", server_roles: null };
    assert.equal(scriviSeCambiata(db, { deviceId: 1 }, "switch", esistente), "nulla");
    assert.equal(riga("network_devices", 1).classification_manual ?? 0, 0);
    assert.equal(riga("hosts", 1).classification_manual, 0);
    assert.equal(scriviSeCambiata(db, { deviceId: 1 }, "firewall", esistente), "classificazione");
    assert.equal(riga("network_devices", 1).classification_manual, 1);
    assert.equal(riga("hosts", 1).classification_manual, 1);
  });

  it("scriviSeCambiata: solo ruoli diversi li scrive senza fissare la classificazione", () => {
    const db = getTenantDb(T);
    scriviClassificazione(db, { hostId: 1 }, "server", { manuale: false, ruoli: ["dns"] });
    const esistente = { classification: "server", server_roles: JSON.stringify(["dns"]) };
    assert.equal(scriviSeCambiata(db, { deviceId: 1 }, "server", esistente, { ruoli: ["dns"] }), "nulla");
    assert.equal(scriviSeCambiata(db, { deviceId: 1 }, "server", esistente, { ruoli: [] }), "ruoli");
    assert.equal(riga("hosts", 1).server_roles, null);
    assert.equal(riga("hosts", 1).classification_manual, 0);
  });
});
