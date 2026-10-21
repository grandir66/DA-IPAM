/**
 * Catalogo canonico (21/10): le funzioni di scrittura convertono lo slug vecchio, aggiungono il ruolo del
 * server e il vendor dell'apparato; la conversione una tantum è idempotente (segno classificazioni_v21).
 *
 * Incidente evitato: un classificatore, l'SNMP o il seed dell'hub emettono ancora `server_windows`/`dns_server`;
 * senza canonicalizzazione nella scrittura le voci doppie tornano nei menu e nei filtri.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/classification/__tests__/scrittura-canonica.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-scrittura-canonica";

import {
  withTenant, getTenantDb, deleteTenantDatabase,
  upsertHost, updateHost, createNetworkDevice, updateNetworkDevice, syncNetworkDeviceFromHostScan,
} from "@/lib/db-tenant";
import { convertiClassificazioniV21, migrateServerRoles, SEGNO_CLASSIFICAZIONI_V21 } from "../migrazione-v21";
import { proponiApparato } from "@/lib/devices/proposta-apparato";

const T = "TESTSCRITTURACANONICA";

interface H { classification: string; server_roles: string | null; classification_manual: number }
const host = (id: number) =>
  getTenantDb(T).prepare("SELECT classification, server_roles, classification_manual FROM hosts WHERE id = ?").get(id) as H;
const dev = (id: number) =>
  getTenantDb(T).prepare("SELECT classification, vendor, server_roles FROM network_devices WHERE id = ?").get(id) as
    { classification: string | null; vendor: string; server_roles: string | null };

describe("scrittura canonica", () => {
  before(() => {
    withTenant(T, () => {
      getTenantDb(T).prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.50.0.0/24', 'prova')").run();
    });
  });
  after(() => deleteTenantDatabase(T));

  it("upsertHost (insert): dns_server -> server + ruolo dns", () => {
    withTenant(T, () => {
      const h = upsertHost({ network_id: 1, ip: "10.50.0.10", classification: "dns_server" });
      assert.ok(h);
      assert.deepEqual(host(h.id).classification, "server");
      assert.equal(host(h.id).server_roles, '["dns"]');
    });
  });

  it("upsertHost (update): nas_qnap -> nas; un secondo ruolo si somma senza doppioni", () => {
    withTenant(T, () => {
      const h = upsertHost({ network_id: 1, ip: "10.50.0.11", classification: "mail_server" })!;
      upsertHost({ network_id: 1, ip: "10.50.0.11", classification: "web_server" });
      upsertHost({ network_id: 1, ip: "10.50.0.11", classification: "web_server" });
      assert.equal(host(h.id).classification, "server");
      assert.equal(host(h.id).server_roles, '["mail","web"]');
      const n = upsertHost({ network_id: 1, ip: "10.50.0.12", classification: "unknown" })!;
      upsertHost({ network_id: 1, ip: "10.50.0.12", classification: "nas_qnap" });
      assert.equal(host(n.id).classification, "nas");
      assert.equal(host(n.id).server_roles, null);
    });
  });

  it("updateHost: scelta a mano canonicalizzata, resta manuale", () => {
    withTenant(T, () => {
      const h = upsertHost({ network_id: 1, ip: "10.50.0.13" })!;
      updateHost(h.id, { classification: "backup_server" });
      assert.equal(host(h.id).classification, "server");
      assert.equal(host(h.id).server_roles, '["backup"]');
      assert.equal(host(h.id).classification_manual, 1);
    });
  });

  it("createNetworkDevice: server_windows -> server, vendor 'other' diventa windows; vendor scelto non si tocca", () => {
    withTenant(T, () => {
      const a = createNetworkDevice({ name: "a", host: "10.50.0.20", device_type: "server", vendor: "other", protocol: "winrm", api_url: null, port: 5985, enabled: 1, classification: "server_windows" } as never);
      assert.equal(dev(a.id).classification, "server");
      assert.equal(dev(a.id).vendor, "windows");
      const b = createNetworkDevice({ name: "b", host: "10.50.0.21", device_type: "nas", vendor: "qnap", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "nas_synology" } as never);
      assert.equal(dev(b.id).classification, "nas");
      assert.equal(dev(b.id).vendor, "qnap", "vendor già scelto: non si sovrascrive");
    });
  });

  it("updateNetworkDevice: dns_server -> server + ruolo", () => {
    withTenant(T, () => {
      const a = createNetworkDevice({ name: "c", host: "10.50.0.22", device_type: "server", vendor: "linux", protocol: "ssh", api_url: null, port: 22, enabled: 1 } as never);
      updateNetworkDevice(a.id, { classification: "dns_server" });
      assert.equal(dev(a.id).classification, "server");
      assert.equal(dev(a.id).server_roles, '["dns"]');
    });
  });

  it("syncNetworkDeviceFromHostScan: l'host dice nas_qnap, l'apparato infrastrutturale diventa nas", () => {
    withTenant(T, () => {
      const a = createNetworkDevice({ name: "d", host: "10.50.0.23", device_type: "switch", vendor: "other", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "switch" } as never);
      syncNetworkDeviceFromHostScan("10.50.0.23", [{ port: 22 }], "nas_qnap");
      assert.equal(dev(a.id).classification, "nas");
      assert.equal(dev(a.id).vendor, "qnap");
    });
  });

  it("proposta: un host server con ruolo backup propone proxmox_pbs; il vecchio backup_server idem", () => {
    const base = {
      ip: "10.0.0.1", hostname: null, custom_name: null, classification: "server", classification_manual: 1,
      inferred_vendor: "proxmox", device_manufacturer: null, os_info: null, model: null, vendor: null, snmp_data: null,
    };
    const p1 = proponiApparato({ ...base, server_roles: '["backup"]' }, []);
    assert.equal(p1.classification, "server");
    assert.equal(p1.productProfile, "proxmox_pbs");
    const p2 = proponiApparato({ ...base, classification: "backup_server", server_roles: null }, []);
    assert.equal(p2.classification, "server");
    assert.equal(p2.productProfile, "proxmox_pbs");
  });
});

describe("conversione una tantum", () => {
  const C = "TESTCONVERSIONEV21";
  before(() => {
    withTenant(C, () => {
      const d = getTenantDb(C);
      d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.51.0.0/24', 'prova')").run();
      const ins = d.prepare("INSERT INTO hosts (id, network_id, ip, classification) VALUES (?, 1, ?, ?)");
      ins.run(1, "10.51.0.1", "server_windows");
      ins.run(2, "10.51.0.2", "dns_server");
      ins.run(3, "10.51.0.3", "nas_qnap");
      ins.run(4, "10.51.0.4", "ont");
      ins.run(5, "10.51.0.5", "router");
      d.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, classification) VALUES (1, 'nas', '10.51.0.3', 'nas', 'other', 'ssh', 'nas_qnap')").run();
      // lo stato di partenza «prima della conversione»: come un DB di prima del 21/10
      d.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_CLASSIFICAZIONI_V21);
    });
  });
  after(() => deleteTenantDatabase(C));

  it("converte, mette il segno, e la seconda apertura non rifà niente", () => {
    withTenant(C, () => {
      const d = getTenantDb(C);
      assert.deepEqual(migrateServerRoles(d), [], "la colonna c'è già: niente da aggiungere");
      const e1 = convertiClassificazioniV21(d);
      assert.equal(e1.eseguita, true);
      assert.equal(e1.hosts, 4);
      assert.equal(e1.apparati, 1);
      const cl = (id: number) => d.prepare("SELECT classification, server_roles FROM hosts WHERE id = ?").get(id) as { classification: string; server_roles: string | null };
      assert.equal(cl(1).classification, "server");
      assert.equal(cl(2).classification, "server");
      assert.equal(cl(2).server_roles, '["dns"]');
      assert.equal(cl(3).classification, "nas");
      assert.equal(cl(4).classification, "modem");
      assert.equal(cl(5).classification, "router");
      const nd = d.prepare("SELECT classification, vendor FROM network_devices WHERE id = 1").get() as { classification: string; vendor: string };
      assert.deepEqual(nd, { classification: "nas", vendor: "qnap" });
      const segno = d.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(SEGNO_CLASSIFICAZIONI_V21) as { value: string };
      assert.match(segno.value, /^done:.*hosts=4,apparati=1$/);
      // un nuovo slug vecchio scritto a mano nel DB dopo il segno non viene toccato: la conversione non si rifà
      d.prepare("UPDATE hosts SET classification = 'dns_server' WHERE id = 5").run();
      const e2 = convertiClassificazioniV21(d);
      assert.equal(e2.eseguita, false);
      assert.equal(cl(5).classification, "dns_server");
    });
  });

  it("migrateServerRoles aggiunge la colonna a un DB che non ce l'ha, una volta sola", () => {
    withTenant(C, () => {
      const d = getTenantDb(C);
      d.exec("ALTER TABLE hosts DROP COLUMN server_roles");
      assert.deepEqual(migrateServerRoles(d), ["hosts.server_roles"]);
      assert.deepEqual(migrateServerRoles(d), []);
    });
  });
});
