/**
 * Un apparato, una scheda, da qualunque suo IP (Riccardo, 22/10): un host del cluster fisico senza riga in
 * `network_devices` risolve all'unico apparato gestito del cluster. Con due apparati o con nessuno non si decide:
 * la scheda resta quella di oggi (host semplice).
 *
 * Incidente evitato: 192.168.4.254, 5.254, 16.254… (stesso router) si aprivano come host qualunque, con una
 * scheda diversa da quella di 15.254 che porta l'apparato.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/apparato-del-cluster.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-apparato-cluster";

import { withTenant, deleteTenantDatabase, createNetworkDevice } from "@/lib/db-tenant";
import { createPhysicalDevice, setHostPhysicalDevice } from "@/lib/devices/physical-device-db";
import { getDb, getHostById } from "@/lib/db";
import { apparatoDelCluster } from "../apparato-del-cluster";

const T = "TESTAPPARATOCLUSTER";
after(() => deleteTenantDatabase(T));

let seq = 0;
function rete(): number {
  seq += 1;
  return Number(getDb().prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`10.${seq}.0.0/24`, `r${seq}`).lastInsertRowid);
}
function host(ip: string, reteId: number, pd: number | null): number {
  const id = Number(getDb().prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)").run(reteId, ip).lastInsertRowid);
  if (pd) setHostPhysicalDevice(id, pd);
  return id;
}
function apparato(nome: string, ip: string, hostId: number): number {
  const d = createNetworkDevice({ name: nome, host: ip, device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router", host_id: hostId } as never);
  return d.id;
}

describe("apparatoDelCluster", () => {
  it("un solo apparato nel cluster: gli altri IP risolvono a lui, con il numero di indirizzi", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "t1" }).id;
      const h1 = host("10.1.15.254", rete(), pd);
      const h2 = host("10.1.4.254", rete(), pd);
      const h3 = host("10.1.5.254", rete(), pd);
      const nd = apparato("MK-RTR-CORE", "10.1.15.254", h1);
      const r = apparatoDelCluster(getDb(), h2);
      assert.equal(r.esito, "cluster");
      if (r.esito !== "cluster") return;
      assert.equal(r.apparato.network_device_id, nd);
      assert.equal(r.apparato.host_id, h1);
      assert.equal(r.apparato.nome, "MK-RTR-CORE");
      assert.equal(r.apparato.n_indirizzi, 3);
      assert.equal(apparatoDelCluster(getDb(), h3).esito, "cluster");
      // La scheda dell'host lo riceve già risolto; l'host dell'apparato no (ha il suo network_device).
      assert.equal(getHostById(h2)?.apparato_cluster?.network_device_id, nd);
      assert.equal(getHostById(h2)?.network_device, null);
      assert.equal(getHostById(h1)?.apparato_cluster, null);
      // L'host che porta l'apparato non si risolve: ha già la sua scheda.
      assert.equal(apparatoDelCluster(getDb(), h1).esito, "proprio");
    });
  });

  it("nessun apparato nel cluster, o host senza cluster: nessuna risoluzione", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "t2" }).id;
      const a = host("10.2.0.1", rete(), pd);
      host("10.2.0.2", rete(), pd);
      assert.equal(apparatoDelCluster(getDb(), a).esito, "nessuno");
      const solo = host("10.2.9.9", rete(), null);
      assert.equal(apparatoDelCluster(getDb(), solo).esito, "nessuno");
      assert.equal(apparatoDelCluster(getDb(), 999999).esito, "nessuno");
    });
  });

  it("due apparati nel cluster: ambiguo, non si sceglie", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "t3" }).id;
      const h1 = host("10.3.0.1", rete(), pd);
      const h2 = host("10.3.0.2", rete(), pd);
      const h3 = host("10.3.0.3", rete(), pd);
      apparato("A", "10.3.0.1", h1);
      apparato("B", "10.3.0.2", h2);
      assert.equal(apparatoDelCluster(getDb(), h3).esito, "ambiguo");
    });
  });
});
