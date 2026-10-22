/**
 * «Scegli come principale» (piano 2026-10-22 accorpamento, Task 6): la scelta a mano scrive `primary_host_id`, ma solo
 * per un membro del cluster e solo se il cluster non ha un apparato gestito (il suo IP è il principale per regola).
 * In più, dalla revisione del Task 3: un host che cambia cluster non resta principale scelto nel vecchio, e staccare
 * un host e azzerare la scelta sono una transazione sola.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/scegli-principale.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-scegli-principale";

import { withTenant, deleteTenantDatabase, createNetworkDevice } from "@/lib/db-tenant";
import {
  createPhysicalDevice, setHostPhysicalDevice, unlinkHostFromPhysicalDevice, manualLinkHostsToPhysicalDevice, scegliPrincipale,
} from "@/lib/devices/physical-device-db";
import { getDb } from "@/lib/db";

const T = "TESTSCEGLIPRINC";
after(() => deleteTenantDatabase(T));

let seq = 0;
function rete(): number {
  seq += 1;
  return Number(getDb().prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`192.0.${seq}.0/24`, `rete-${seq}`).lastInsertRowid);
}
function host(ip: string, reteId: number, pd: number | null): number {
  const id = Number(getDb().prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)").run(reteId, ip).lastInsertRowid);
  if (pd) setHostPhysicalDevice(id, pd);
  return id;
}
const cluster = (): number => createPhysicalDevice({ identity_confidence: 1, identity_anchor: `c${++seq}` }).id;
const principale = (pd: number): number | null =>
  (getDb().prepare("SELECT primary_host_id AS p FROM physical_devices WHERE id = ?").get(pd) as { p: number | null }).p;
const setP = (pd: number, h: number | null) => getDb().prepare("UPDATE physical_devices SET primary_host_id = ? WHERE id = ?").run(h, pd);

describe("scegliPrincipale", () => {
  it("un membro del cluster senza apparato: scrive la colonna", () => {
    withTenant(T, () => {
      const pd = cluster(); const r = rete();
      host("192.0.2.1", r, pd); const b = host("192.0.2.2", r, pd);
      assert.deepEqual(scegliPrincipale(pd, b), { ok: true });
      assert.equal(principale(pd), b);
    });
  });
  it("host fuori dal cluster: 400, colonna invariata", () => {
    withTenant(T, () => {
      const pd = cluster(); const r = rete();
      const a = host("192.0.2.1", r, pd); host("192.0.2.2", r, pd);
      const fuori = host("192.0.2.3", r, null);
      setP(pd, a);
      const e = scegliPrincipale(pd, fuori);
      assert.equal(e.ok, false);
      assert.equal(!e.ok && e.status, 400);
      assert.equal(principale(pd), a);
    });
  });
  it("cluster inesistente: 404", () => {
    withTenant(T, () => {
      const e = scegliPrincipale(999999, 1);
      assert.equal(!e.ok && e.status, 404);
    });
  });
  it("cluster con un apparato: 409 e colonna invariata", () => {
    withTenant(T, () => {
      const pd = cluster(); const r = rete();
      const a = host("192.0.2.1", r, pd); const b = host("192.0.2.2", r, pd);
      createNetworkDevice({ name: "ap-prova", host: "192.0.2.1", device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router", host_id: a } as never);
      const e = scegliPrincipale(pd, b);
      assert.equal(e.ok, false);
      assert.equal(!e.ok && e.status, 409);
      assert.equal(principale(pd), null);
    });
  });
});

describe("collegamento con principale_host_id", () => {
  it("lo scrive sul cluster risultante", () => {
    withTenant(T, () => {
      const r = rete();
      const a = host("192.0.2.1", r, null); const b = host("192.0.2.2", r, null);
      const res = manualLinkHostsToPhysicalDevice([a, b], null, b);
      assert.equal(principale(res.physical_device_id), b);
    });
  });
  it("principale fuori dagli host collegati: errore e niente scritto", () => {
    withTenant(T, () => {
      const r = rete();
      const a = host("192.0.2.1", r, null); const b = host("192.0.2.2", r, null); const x = host("192.0.2.3", r, null);
      assert.throws(() => manualLinkHostsToPhysicalDevice([a, b], null, x), /non è fra gli IP/);
      assert.equal((getDb().prepare("SELECT physical_device_id AS p FROM hosts WHERE id = ?").get(a) as { p: number | null }).p, null);
    });
  });
});

describe("l'host che cambia cluster non resta principale nel vecchio (revisione Task 3)", () => {
  it("setHostPhysicalDevice verso un altro cluster, e verso nessuno", () => {
    withTenant(T, () => {
      const vecchio = cluster(); const nuovo = cluster(); const r = rete();
      const a = host("192.0.2.1", r, vecchio); host("192.0.2.2", r, vecchio);
      setP(vecchio, a);
      setHostPhysicalDevice(a, nuovo);
      assert.equal(principale(vecchio), null);
      const b = host("192.0.2.9", r, vecchio);
      setP(vecchio, b);
      setHostPhysicalDevice(b, null);
      assert.equal(principale(vecchio), null);
    });
  });
  it("setHostPhysicalDevice sullo stesso cluster non tocca la scelta", () => {
    withTenant(T, () => {
      const pd = cluster(); const r = rete();
      const a = host("192.0.2.1", r, pd); host("192.0.2.2", r, pd);
      setP(pd, a);
      setHostPhysicalDevice(a, pd);
      assert.equal(principale(pd), a);
    });
  });
  it("manualLinkHostsToPhysicalDevice sposta l'host in un altro cluster", () => {
    withTenant(T, () => {
      const vecchio = cluster(); const nuovo = cluster(); const r = rete();
      const a = host("192.0.2.1", r, vecchio); host("192.0.2.2", r, vecchio);
      host("192.0.2.5", r, nuovo);
      setP(vecchio, a);
      manualLinkHostsToPhysicalDevice([a], nuovo);
      assert.equal(principale(vecchio), null);
    });
  });
  it("unlink: l'host esce e la scelta si azzera insieme; se la scrittura fallisce a metà resta tutto com'era", () => {
    withTenant(T, () => {
      const pd = cluster(); const r = rete();
      const a = host("192.0.2.1", r, pd); host("192.0.2.2", r, pd);
      setP(pd, a);
      unlinkHostFromPhysicalDevice(a);
      assert.equal(principale(pd), null);
      // Secondo giro con un guasto fra le due scritture: un trigger fa fallire l'UPDATE su physical_devices.
      const c = host("192.0.2.3", r, pd);
      setP(pd, c);
      getDb().exec("CREATE TEMP TRIGGER guasto BEFORE UPDATE OF primary_host_id ON physical_devices BEGIN SELECT RAISE(ABORT, 'guasto'); END");
      assert.throws(() => unlinkHostFromPhysicalDevice(c), /guasto/);
      getDb().exec("DROP TRIGGER guasto");
      assert.equal((getDb().prepare("SELECT physical_device_id AS p FROM hosts WHERE id = ?").get(c) as { p: number | null }).p, pd, "l'host è ancora nel cluster");
      assert.equal(principale(pd), c);
    });
  });
});
