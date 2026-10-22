/**
 * «Rendi apparato» non crea un secondo apparato su un IP che è già di un apparato: lo stesso host («proprio»)
 * o un altro host del suo cluster fisico (`hosts.physical_device_id`).
 *
 * Incidente: 21/10, hub: DA-RT-CORE (nd 318) creato su un IP secondario del router MK-RTR-CORE (nd 1).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/apparato-gia-presente.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-apparato-gia-presente";

import { withTenant, deleteTenantDatabase, createNetworkDevice } from "@/lib/db-tenant";
import { createPhysicalDevice, setHostPhysicalDevice } from "@/lib/devices/physical-device-db";
import { getDb } from "@/lib/db";
import { apparatoGiaPresente, bloccoCambioHost, messaggioIpDiApparato } from "../apparato-del-cluster";

const T = "TESTAPPARATOGIAPRESENTE";
after(() => deleteTenantDatabase(T));

function rete(cidr: string): number {
  return Number(getDb().prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(cidr, cidr).lastInsertRowid);
}
function host(ip: string, reteId: number, pd: number | null): number {
  const id = Number(getDb().prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)").run(reteId, ip).lastInsertRowid);
  if (pd) setHostPhysicalDevice(id, pd);
  return id;
}
function apparato(nome: string, ip: string, hostId: number): number {
  return createNetworkDevice({ name: nome, host: ip, device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router", host_id: hostId } as never).id;
}

describe("apparatoGiaPresente", () => {
  it("IP secondario del cluster → l'apparato del cluster; IP proprio → lo stesso apparato", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "g1" }).id;
      const r1 = rete("192.0.2.0/24"), r2 = rete("198.51.100.0/24");
      const h1 = host("192.0.2.1", r1, pd);
      host("198.51.100.1", r2, pd);
      const nd = apparato("MK-RTR-CORE", "192.0.2.1", h1);
      assert.deepEqual(apparatoGiaPresente(getDb(), "198.51.100.1"), { network_device_id: nd, nome: "MK-RTR-CORE", host_id: h1, ip: "192.0.2.1" });
      assert.equal(apparatoGiaPresente(getDb(), "192.0.2.1")?.network_device_id, nd);
      assert.equal(messaggioIpDiApparato("MK-RTR-CORE"), "Questo IP è già dell'apparato MK-RTR-CORE");
    });
  });

  it("host senza cluster e IP mai scansionato → null", () => {
    withTenant(T, () => {
      const r = rete("203.0.113.0/24");
      host("203.0.113.9", r, null);
      assert.equal(apparatoGiaPresente(getDb(), "203.0.113.9"), null);
      assert.equal(apparatoGiaPresente(getDb(), "203.0.113.200"), null);
    });
  });

  it("stesso IP in due reti, una riga nel cluster → bloccato (si controllano tutte le righe)", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "g2" }).id;
      const ra = rete("10.60.0.0/24"), rb = rete("10.61.0.0/24");
      const h1 = host("10.60.0.1", ra, pd);
      host("10.99.9.9", ra, null); // riga senza cluster con lo stesso IP, trovata per prima
      host("10.99.9.9", rb, pd);
      const nd = apparato("SW-DUE-RETI", "10.60.0.1", h1);
      assert.equal(apparatoGiaPresente(getDb(), "10.99.9.9")?.network_device_id, nd);
    });
  });

  it("cluster con due apparati (ambiguo) → il primo per network_devices.id", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "g3" }).id;
      const r = rete("10.70.0.0/24");
      const ha = host("10.70.0.1", r, pd), hb = host("10.70.0.2", r, pd);
      host("10.70.0.3", r, pd);
      const primo = apparato("PRIMO", "10.70.0.1", ha);
      apparato("SECONDO", "10.70.0.2", hb);
      const g = apparatoGiaPresente(getDb(), "10.70.0.3");
      assert.equal(g?.network_device_id, primo);
      assert.equal(g?.nome, "PRIMO");
    });
  });

  // Revisione finale 22/10: la PUT dell'apparato che cambia `host` non deve bloccarsi su sé stesso.
  it("escludendo l'apparato stesso: null sul suo IP e sugli IP del suo cluster", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "g4" }).id;
      const r = rete("10.80.0.0/24");
      const h1 = host("10.80.0.1", r, pd);
      host("10.80.0.2", r, pd);
      const nd = apparato("SW-SE-STESSO", "10.80.0.1", h1);
      assert.equal(apparatoGiaPresente(getDb(), "10.80.0.2", nd), null);
      assert.equal(apparatoGiaPresente(getDb(), "10.80.0.1", nd), null);
      assert.equal(apparatoGiaPresente(getDb(), "10.80.0.2")?.network_device_id, nd);
    });
  });

  // Revisione finale 22/10: «è un apparato» deve voler dire la stessa cosa qui e in cluster-discovery.ts.
  it("apparato vecchio senza host_id (solo l'IP scritto) conta anche per gli altri IP del suo cluster", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "g5" }).id;
      const r = rete("10.81.0.0/24");
      const h1 = host("10.81.0.1", r, pd);
      host("10.81.0.2", r, pd);
      const nd = apparato("RTR-VECCHIO", "10.81.0.1", h1);
      getDb().prepare("UPDATE network_devices SET host_id = NULL WHERE id = ?").run(nd);
      assert.equal(apparatoGiaPresente(getDb(), "10.81.0.2")?.network_device_id, nd);
    });
  });

  it("messaggio: per un IP del gruppo dice come farne un apparato a sé", () => {
    assert.equal(
      messaggioIpDiApparato("MK-RTR-CORE", true),
      "Questo IP è già dell'apparato MK-RTR-CORE. Per farne un apparato a sé, prima togli l'IP dal gruppo nella scheda di MK-RTR-CORE",
    );
  });
});

describe("bloccoCambioHost (PUT dell'apparato che cambia IP)", () => {
  it("sull'IP secondario di un altro apparato: 409 col messaggio del gruppo; su sé stesso o su un IP libero: niente", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "g6" }).id;
      const r = rete("10.82.0.0/24");
      const h1 = host("10.82.0.1", r, pd);
      host("10.82.0.2", r, pd);
      const h3 = host("10.82.0.3", r, null);
      const core = apparato("RTR-CORE", "10.82.0.1", h1);
      const altro = apparato("ALTRO", "10.82.0.3", h3);
      const b = bloccoCambioHost(getDb(), { id: altro, host: "10.82.0.3" }, "10.82.0.2");
      assert.equal(b?.codice, "IP_DI_APPARATO");
      assert.equal(b?.apparato.network_device_id, core);
      assert.equal(b?.error, "Questo IP è già dell'apparato RTR-CORE. Per farne un apparato a sé, prima togli l'IP dal gruppo nella scheda di RTR-CORE");
      assert.equal(bloccoCambioHost(getDb(), { id: altro, host: "10.82.0.3" }, "10.82.0.1")?.error, "Questo IP è già dell'apparato RTR-CORE");
      assert.equal(bloccoCambioHost(getDb(), { id: core, host: "10.82.0.1" }, "10.82.0.2"), null);
      assert.equal(bloccoCambioHost(getDb(), { id: altro, host: "10.82.0.3" }, "10.82.0.3"), null);
      assert.equal(bloccoCambioHost(getDb(), { id: altro, host: "10.82.0.3" }, "10.82.0.250"), null);
      assert.equal(bloccoCambioHost(getDb(), { id: altro, host: "10.82.0.3" }, undefined), null);
    });
  });
});

