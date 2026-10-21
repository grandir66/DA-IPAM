/**
 * POST /api/devices senza la parte HTTP (tappa 1 credenziali, 15/10).
 *
 * Incidenti: senza classificazione ogni apparato che non fosse router o switch
 * diventava «hypervisor», e la stessa classificazione finiva sull'host; una
 * classificazione fuori elenco («printer», scritta dal classificatore) passava
 * e l'apparato spariva dalle liste per classificazione; il binding della
 * credenziale SNMP era sempre sulla 161, anche con la porta propria.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/crea-apparato.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-crea-apparato";

import { creaApparato } from "../crea-apparato";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { eliminaBindingApparatoDb, usataAdessoDb } from "@/lib/credentials/apparato-archivio";

const T = "TESTCREAAPPARATO";

describe("creaApparato", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.40.0.0/24', 'prova')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip, classification) VALUES (1, 1, '10.40.0.5', 'unknown')`).run();
      d.prepare(`INSERT INTO credentials (id, name, credential_type, port) VALUES (7, 'snmp fuori standard', 'snmp', 1161)`).run();
    });
  });
  after(() => deleteTenantDatabase(T));

  it("senza classificazione e tipo «server» → apparato e host classificati server (non hypervisor)", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "srv", host: "10.40.0.5", device_type: "server", vendor: "windows", protocol: "winrm" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(esito.device.classification, "server");
    const host = getTenantDb(T).prepare(`SELECT classification FROM hosts WHERE id = 1`).get() as { classification: string };
    assert.equal(host.classification, "server");
  });

  // Finestra «Rendi apparato» (tappa 3): i ruoli scelti per un server arrivano nel corpo.
  it("server con ruoli → ruoli sull'host e sull'apparato, quelli fuori catalogo ignorati", () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO hosts (id, network_id, ip, classification) VALUES (2, 1, '10.40.0.6', 'unknown')`).run();
    const esito = withTenant(T, () =>
      creaApparato({ name: "dc", host: "10.40.0.6", device_type: "server", classification: "server", vendor: "windows", protocol: "winrm", server_roles: ["dc", "dns", "inventato"] })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const h = d.prepare(`SELECT server_roles FROM hosts WHERE id = 2`).get() as { server_roles: string };
    const a = d.prepare(`SELECT server_roles FROM network_devices WHERE id = ?`).get(esito.device.id) as { server_roles: string };
    assert.deepEqual([...JSON.parse(h.server_roles)].sort(), ["dc", "dns"]);
    assert.deepEqual([...JSON.parse(a.server_roles)].sort(), ["dc", "dns"]);
  });

  it("classificazione fuori elenco («printer») → 400 con messaggio in italiano", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "stampa", host: "10.40.0.9", device_type: "server", vendor: "other", protocol: "snmp_v2", classification: "printer" })
    );
    assert.equal(esito.ok, false);
    if (!esito.ok) {
      assert.equal(esito.status, 400);
      assert.match(esito.error, /Classificazione non valida/);
    }
  });

  it("un Mac (apple + scansione macOS) si salva (tappa 1b)", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "mac", host: "10.40.0.30", device_type: "server", classification: "notebook", vendor: "apple", protocol: "ssh", scan_target: "macos" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(esito.device.vendor, "apple");
    assert.equal(esito.device.scan_target, "macos");
  });

  it("binding SNMP da una credenziale con porta 1161 → binding sulla 1161", () => {
    const esito = withTenant(T, () =>
      creaApparato({ name: "sw", host: "10.40.0.20", device_type: "switch", classification: "switch", vendor: "mikrotik", protocol: "ssh", snmp_credential_id: 7 })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const b = getTenantDb(T)
      .prepare(`SELECT port FROM device_credential_bindings WHERE device_id = ? AND protocol_type = 'snmp'`)
      .get(esito.device.id) as { port: number };
    assert.equal(b.port, 1161);
  });

  // Tappa 2e (T20, 16/10): utente e password diventavano colonne dell'apparato
  // più un binding inline, che la pagina non mostra come voce e che la 2g
  // smetterà di leggere.
  it("utente e password → 0 colonne scritte, 1 voce «<nome> · SSH», 1 binding che la punta", () => {
    const d = getTenantDb(T);
    const vociPrima = (d.prepare(`SELECT COUNT(*) AS n FROM credentials`).get() as { n: number }).n;
    const esito = withTenant(T, () =>
      creaApparato({ name: "fw nuovo", host: "10.40.0.40", device_type: "router", classification: "firewall", vendor: "other", protocol: "ssh", username: "admin", password: "segreta", community_string: "c0mm" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const colonne = d
      .prepare(`SELECT credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token FROM network_devices WHERE id = ?`)
      .get(esito.device.id);
    assert.deepEqual(colonne, { credential_id: null, snmp_credential_id: null, username: null, encrypted_password: null, community_string: null, api_token: null });
    const binding = d
      .prepare(`SELECT b.protocol_type, b.port, b.inline_username, b.inline_encrypted_password, c.name, c.credential_type FROM device_credential_bindings b JOIN credentials c ON c.id = b.credential_id WHERE b.device_id = ? ORDER BY b.sort_order, b.id`)
      .all(esito.device.id);
    assert.deepEqual(binding, [
      { protocol_type: "ssh", port: 22, inline_username: null, inline_encrypted_password: null, name: "fw nuovo · SSH", credential_type: "ssh" },
      { protocol_type: "snmp", port: 161, inline_username: null, inline_encrypted_password: null, name: "fw nuovo · SNMP", credential_type: "snmp" },
    ]);
    assert.equal((d.prepare(`SELECT COUNT(*) AS n FROM credentials`).get() as { n: number }).n, vociPrima + 2);
  });

  it("voce d'archivio scelta più una community scritta: il binding della voce, la community non va in colonna", () => {
    const d = getTenantDb(T);
    const esito = withTenant(T, () =>
      creaApparato({ name: "sw2", host: "10.40.0.41", device_type: "switch", classification: "switch", vendor: "hp", protocol: "ssh", snmp_credential_id: 7, community_string: "ignorata" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const c = d.prepare(`SELECT username, encrypted_password, community_string, api_token FROM network_devices WHERE id = ?`).get(esito.device.id);
    assert.deepEqual(c, { username: null, encrypted_password: null, community_string: null, api_token: null });
    const b = d.prepare(`SELECT credential_id, protocol_type, port FROM device_credential_bindings WHERE device_id = ?`).all(esito.device.id);
    assert.deepEqual(b, [{ credential_id: 7, protocol_type: "snmp", port: 1161 }]);
  });

  // Revisione della 2e (16/10): creaApparato scriveva ancora gli id delle voci
  // in `credential_id` / `snmp_credential_id`, che la conversione non svuota
  // più (segno `done:`). Il motore le legge come livello 4 (device_column):
  // con il binding fallito riprendeva la voce dalla colonna (D10 aggirato, per
  // WinRM accessi falliti sull'account di dominio), e con il binding tolto
  // dalla tabella dell'apparato continuava a usarla.
  it("voce scelta: solo il binding; fallito o tolto, il motore non la riprende da una colonna", () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (80, 'ssh scelta', 'ssh', ?, ?)`).run(
      encrypt("admin"),
      encrypt("segreta"),
    );
    const esito = withTenant(T, () =>
      creaApparato({ name: "fw scelta", host: "10.40.0.43", device_type: "router", classification: "firewall", vendor: "other", protocol: "ssh", credential_id: 80, snmp_credential_id: 7 })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    const id = esito.device.id;
    assert.deepEqual(d.prepare(`SELECT credential_id, snmp_credential_id FROM network_devices WHERE id = ?`).get(id), {
      credential_id: null,
      snmp_credential_id: null,
    });

    d.prepare(`UPDATE device_credential_bindings SET test_status = 'failed' WHERE device_id = ? AND protocol_type = 'ssh'`).run(id);
    const snmp = d.prepare(`SELECT id FROM device_credential_bindings WHERE device_id = ? AND protocol_type = 'snmp'`).get(id) as { id: number };
    assert.ok(eliminaBindingApparatoDb(d, id, snmp.id));

    const usate = usataAdessoDb(d, id);
    const principale = usate.find((u) => u.ruolo === "principale");
    assert.equal(principale?.fonte ?? null, null, `il binding fallito si salta e non c'è altro: ${JSON.stringify(principale)}`);
    assert.equal(principale?.credential_id ?? null, null);
    const riga = usate.find((u) => u.ruolo === "snmp");
    assert.notEqual(riga?.fonte, "device_column", `binding SNMP tolto: niente voce da una colonna (${JSON.stringify(riga)})`);
    assert.equal(riga?.credential_id ?? null, null);
  });

  it("utente senza password: 400 e nessun apparato creato", () => {
    const d = getTenantDb(T);
    const esito = withTenant(T, () =>
      creaApparato({ name: "mezzo", host: "10.40.0.42", device_type: "server", vendor: "linux", protocol: "ssh", username: "root" })
    );
    assert.equal(esito.ok, false);
    if (!esito.ok) assert.equal(esito.status, 400);
    assert.equal(d.prepare(`SELECT id FROM network_devices WHERE host = '10.40.0.42'`).get(), undefined);
  });
  it("Server + Proxmox VE → device_type hypervisor (resta nella topologia)", () => {
    getTenantDb(T).prepare(`INSERT INTO hosts (id, network_id, ip, classification) VALUES (9, 1, '10.40.0.19', 'unknown')`).run();
    const esito = withTenant(T, () =>
      creaApparato({ name: "pve", host: "10.40.0.19", device_type: "server", classification: "server", vendor: "proxmox", product_profile: "proxmox_ve", protocol: "api" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal(esito.device.device_type, "hypervisor");
    const n = getTenantDb(T).prepare(`SELECT device_type FROM network_devices WHERE id = ?`).get(esito.device.id) as { device_type: string };
    assert.equal(n.device_type, "hypervisor");
  });

  it("classificazione già uguale a quella dell'host: l'apparato nasce senza «scelta a mano»", () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO hosts (id, network_id, ip, classification, classification_manual) VALUES (10, 1, '10.40.0.20', 'stampante', 0)`).run();
    const esito = withTenant(T, () =>
      creaApparato({ name: "stampa", host: "10.40.0.20", device_type: "server", classification: "stampante", vendor: "other", protocol: "snmp_v2" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal((d.prepare(`SELECT classification_manual m FROM hosts WHERE id = 10`).get() as { m: number }).m, 0);
    assert.notEqual((d.prepare(`SELECT classification_manual m FROM network_devices WHERE id = ?`).get(esito.device.id) as { m: number | null }).m, 1);
  });

  it("classificazione diversa da quella dell'host: scelta a mano", () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO hosts (id, network_id, ip, classification, classification_manual) VALUES (11, 1, '10.40.0.21', 'unknown', 0)`).run();
    const esito = withTenant(T, () =>
      creaApparato({ name: "r", host: "10.40.0.21", device_type: "router", classification: "router", vendor: "mikrotik", protocol: "ssh" })
    );
    assert.ok(esito.ok, esito.ok ? "" : esito.error);
    assert.equal((d.prepare(`SELECT classification_manual m FROM hosts WHERE id = 11`).get() as { m: number }).m, 1);
  });
});
