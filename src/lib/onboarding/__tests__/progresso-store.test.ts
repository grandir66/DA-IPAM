/**
 * Riepilogo del wizard per la riapertura (tappa 4 credenziali, 15/10): il
 * punto salvato nell'hub, ripulito degli oggetti che nel frattempo non ci
 * sono più, e i dati del router e della rete già creati.
 *
 * Perché: riaprendo il wizard dopo «Esci» si ripartiva da capo e router e
 * rete si ricreavano. E un id salvato di un router poi eliminato a mano non
 * deve far credere al wizard che il router ci sia (lo modificherebbe con un
 * PUT che dà 404, e non lo ricreerebbe più).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/onboarding/__tests__/progresso-store.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-progresso-wizard";

import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { getSetting, setSetting } from "@/lib/db-hub";
import { leggiRiepilogoWizard, salvaProgresso } from "../progresso-store";
import { chiaveProgresso } from "../progresso";

const T = "TESTPROGRESSOWIZARD";

describe("riepilogo del wizard", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(
        `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, credential_id, snmp_credential_id)
         VALUES (3, 'Router principale', '10.9.0.1', 'router', 'mikrotik', 'ssh', NULL, NULL)`,
      ).run();
      d.prepare(`INSERT INTO networks (id, cidr, name, gateway, dns_server) VALUES (9, '10.9.0.0/24', 'LAN', '10.9.0.1', '10.9.0.2')`).run();
    });
  });
  after(() => deleteTenantDatabase(T));
  beforeEach(() => setSetting(chiaveProgresso(T), ""));

  it("senza un punto salvato: nessun progresso e nessun avviso", () => {
    const r = withTenant(T, () => leggiRiepilogoWizard(T));
    assert.equal(r.progresso, null);
    assert.equal(r.avviso, null);
    assert.equal(r.router, null);
    assert.equal(r.rete, null);
  });

  it("salvato e riletto, con router e rete come sono nel database", () => {
    salvaProgresso(T, { passo: 4, router_device_id: 3, network_id: 9, ad_integration_id: null });
    assert.equal(getSetting(chiaveProgresso(T)), '{"passo":4,"router_device_id":3,"network_id":9,"ad_integration_id":null}');
    const r = withTenant(T, () => leggiRiepilogoWizard(T));
    assert.deepEqual(r.progresso, { passo: 4, router_device_id: 3, network_id: 9, ad_integration_id: null });
    assert.equal(r.avviso, null);
    assert.deepEqual(r.router, {
      id: 3,
      name: "Router principale",
      host: "10.9.0.1",
      vendor: "mikrotik",
      protocol: "ssh",
      credential_id: null,
      snmp_credential_id: null,
    });
    assert.deepEqual(r.rete, { id: 9, name: "LAN", cidr: "10.9.0.0/24", gateway: "10.9.0.1", dns_server: "10.9.0.2" });
  });

  it("un oggetto che non c'è più si toglie dal progresso e lo si dice", () => {
    salvaProgresso(T, { passo: 2, router_device_id: 77, network_id: null, ad_integration_id: 5 });
    const r = withTenant(T, () => leggiRiepilogoWizard(T));
    assert.deepEqual(r.progresso, { passo: 2, router_device_id: null, network_id: null, ad_integration_id: null });
    assert.equal(r.router, null);
    assert.match(r.avviso ?? "", /router/i);
    assert.match(r.avviso ?? "", /Active Directory/);
  });

  it("un valore guasto non riparte in silenzio: nessun progresso, ma l'avviso col motivo", () => {
    setSetting(chiaveProgresso(T), "{rotto");
    const r = withTenant(T, () => leggiRiepilogoWizard(T));
    assert.equal(r.progresso, null);
    assert.match(r.avviso ?? "", /non si è potuto leggere/);
  });

  it("ogni cliente ha il suo punto", () => {
    salvaProgresso(T, { passo: 3, router_device_id: null, network_id: null, ad_integration_id: null });
    assert.equal(getSetting(chiaveProgresso("ALTRO")), null);
  });
});
