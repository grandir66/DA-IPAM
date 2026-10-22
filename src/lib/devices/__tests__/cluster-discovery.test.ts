/**
 * Principale del cluster fisico (piano 2026-10-22 accorpamento, Task 3): in Discovery un apparato fisico ha una riga
 * sola; gli altri IP del cluster si nascondono sotto la principale. Principale = l'IP dell'apparato gestito; senza
 * apparato quello scelto a mano (`physical_devices.primary_host_id`), altrimenti l'IP numericamente più basso. Con due
 * apparati (ambiguo, com'era l'hub fra il 21 e il 22/10 con DA-RT-CORE e MK-RTR-CORE) non si accorpa niente.
 *
 * Migrazione `cluster_principale_v21`: una colonna e un indice su `physical_devices`, additiva, idempotente, in una
 * transazione, col segno `done:<data>:v1`.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/cluster-discovery.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-cluster-discovery";

import { withTenant, deleteTenantDatabase, createNetworkDevice, getTenantDb, closeTenantDb, migrateClusterPrincipale, chiudiMigrazioneClusterPrincipaleFallita } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL, SEGNO_CLUSTER_PRINCIPALE } from "@/lib/db-tenant-schema";
import { createPhysicalDevice, setHostPhysicalDevice, unlinkHostFromPhysicalDevice } from "@/lib/devices/physical-device-db";
import { getDb } from "@/lib/db";
import { leggiSegno } from "@/lib/credentials/segni-t2";
import { principaleDelCluster, leggiClusterDiscovery, type MembroCluster } from "../cluster-discovery";

const T = "TESTCLUSTERDISCOVERY";
const T2 = "TESTCLUSTERPRINCMIG";
after(() => {
  deleteTenantDatabase(T);
  deleteTenantDatabase(T2);
});

const m = (host_id: number, ip: string, ha_apparato = false): MembroCluster =>
  ({ host_id, ip, network_id: 1, network_name: "r1", status: "online", ha_apparato });

describe("principaleDelCluster (regola pura)", () => {
  it("un membro solo: non si accorpa", () => {
    assert.equal(principaleDelCluster([m(1, "10.0.0.1")], null), null);
    assert.equal(principaleDelCluster([], null), null);
  });
  it("un apparato nel cluster: è lui, anche contro la scelta a mano", () => {
    assert.equal(principaleDelCluster([m(1, "10.0.0.1"), m(2, "10.0.0.20", true), m(3, "10.0.0.3")], 3), 2);
  });
  it("due apparati: ambiguo, non si accorpa", () => {
    assert.equal(principaleDelCluster([m(1, "10.0.0.1", true), m(2, "10.0.0.2", true)], 1), null);
  });
  it("nessun apparato, scelta a mano fra i membri: vince la scelta", () => {
    assert.equal(principaleDelCluster([m(1, "10.0.0.1"), m(2, "10.0.0.2")], 2), 2);
  });
  it("scelta a mano fuori dal cluster (o nessuna): l'IP numericamente più basso, 10.0.0.9 prima di 10.0.0.10", () => {
    assert.equal(principaleDelCluster([m(5, "10.0.0.10"), m(6, "10.0.0.9")], 99), 6);
    assert.equal(principaleDelCluster([m(5, "10.0.0.10"), m(6, "10.0.0.9")], null), 6);
  });
});

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

describe("leggiClusterDiscovery", () => {
  it("tre IP in due reti, senza apparato: principale l'IP più basso, gli altri solo sulla sua riga, in ordine di IP", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "c1" }).id;
      const ra = rete();
      const rb = rete();
      const h10 = host("192.0.2.10", ra, pd);
      const h9 = host("192.0.2.9", ra, pd);
      const hb = host("198.51.100.5", rb, pd);
      const solo = host("192.0.2.77", ra, null);
      const mappa = leggiClusterDiscovery(getDb());
      assert.equal(mappa.has(solo), false, "un host senza cluster non è nella mappa");
      const p = mappa.get(h9);
      assert.ok(p);
      assert.equal(p.principale, true);
      assert.equal(p.principale_host_id, h9);
      assert.equal(p.physical_device_id, pd);
      assert.deepEqual(p.altri.map((a) => a.ip), ["192.0.2.10", "198.51.100.5"]);
      assert.deepEqual(p.altri.map((a) => [a.host_id, a.network_id, a.network_name]), [[h10, ra, `rete-${seq - 1}`], [hb, rb, `rete-${seq}`]]);
      assert.equal("ha_apparato" in p.altri[0], false);
      for (const s of [h10, hb]) {
        const i = mappa.get(s);
        assert.ok(i);
        assert.equal(i.principale, false);
        assert.equal(i.principale_host_id, h9);
        assert.deepEqual(i.altri, []);
      }
    });
  });

  it("scelta a mano, poi scollegando il principale primary_host_id torna NULL e vale il ripiego", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "c2" }).id;
      const r = rete();
      const a = host(`192.0.${seq}.1`, r, pd);
      const b = host(`192.0.${seq}.2`, r, pd);
      const c = host(`192.0.${seq}.3`, r, pd);
      getDb().prepare("UPDATE physical_devices SET primary_host_id = ? WHERE id = ?").run(c, pd);
      assert.equal(leggiClusterDiscovery(getDb()).get(a)?.principale_host_id, c);
      unlinkHostFromPhysicalDevice(c);
      const v = getDb().prepare("SELECT primary_host_id AS p FROM physical_devices WHERE id = ?").get(pd) as { p: number | null };
      assert.equal(v.p, null);
      assert.equal(leggiClusterDiscovery(getDb()).get(b)?.principale_host_id, a);
      // Scollegare un IP che non è il principale non tocca la scelta.
      getDb().prepare("UPDATE physical_devices SET primary_host_id = ? WHERE id = ?").run(b, pd);
      const d = host(`192.0.${seq}.4`, r, pd);
      unlinkHostFromPhysicalDevice(d);
      assert.equal((getDb().prepare("SELECT primary_host_id AS p FROM physical_devices WHERE id = ?").get(pd) as { p: number | null }).p, b);
      // Host cancellato: ON DELETE SET NULL.
      getDb().prepare("DELETE FROM hosts WHERE id = ?").run(b);
      assert.equal((getDb().prepare("SELECT primary_host_id AS p FROM physical_devices WHERE id = ?").get(pd) as { p: number | null }).p, null);
    });
  });

  it("un apparato nel cluster è il principale; due apparati: nessuna riga del cluster nella mappa", () => {
    withTenant(T, () => {
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "c3" }).id;
      const r = rete();
      const a = host(`192.0.${seq}.1`, r, pd);
      const b = host(`192.0.${seq}.200`, r, pd);
      createNetworkDevice({ name: "RTR-PROVA", host: `192.0.${seq}.200`, device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router", host_id: b } as never);
      assert.equal(leggiClusterDiscovery(getDb()).get(a)?.principale_host_id, b);
      createNetworkDevice({ name: "RTR-DOPPIO", host: `192.0.${seq}.1`, device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router", host_id: a } as never);
      const mappa = leggiClusterDiscovery(getDb());
      assert.equal(mappa.has(a), false);
      assert.equal(mappa.has(b), false);
    });
  });
});

// ── Migrazione cluster_principale_v21 ──────────────────────────────────────

const colonne = (db: Database.Database, t: string): string[] =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

/** Un tenant com'era prima: lo schema attuale senza la colonna (la crea solo la migrazione). */
function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  assert.equal(colonne(db, "physical_devices").includes("primary_host_id"), false, "non deve esserci prima");
  return db;
}

describe("migrateClusterPrincipale", () => {
  it("aggiunge colonna e indice; la seconda volta niente; il segno si scrive una volta; le righe restano", () => {
    const db = vecchio();
    db.exec("INSERT INTO physical_devices (id, vendor, identity_confidence) VALUES (7, 'x', 1)");
    assert.deepEqual(migrateClusterPrincipale(db), ["physical_devices.primary_host_id", "idx_physical_devices_primary_host"]);
    assert.ok(colonne(db, "physical_devices").includes("primary_host_id"));
    assert.deepEqual(db.prepare("SELECT id, vendor, primary_host_id FROM physical_devices").all(), [{ id: 7, vendor: "x", primary_host_id: null }]);
    const segno = db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_CLUSTER_PRINCIPALE);
    assert.match((segno as { value: string }).value, /^done:\d{4}-\d{2}-\d{2}:v1$/);
    assert.deepEqual(migrateClusterPrincipale(db), []);
    assert.deepEqual(db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_CLUSTER_PRINCIPALE), segno, "il segno non si riscrive");
    assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  });

  it("in transazione: se l'indice fallisce la colonna non resta", () => {
    const db = vecchio();
    // Un oggetto con il nome dell'indice ma di altro tipo: CREATE INDEX IF NOT EXISTS fallisce dopo l'ALTER.
    db.exec("CREATE TABLE idx_physical_devices_primary_host (x INTEGER)");
    assert.throws(() => migrateClusterPrincipale(db));
    assert.equal(colonne(db, "physical_devices").includes("primary_host_id"), false);
    assert.equal(leggiSegno(db, SEGNO_CLUSTER_PRINCIPALE), null);
    chiudiMigrazioneClusterPrincipaleFallita(db, "X", new Error("disco pieno"));
    assert.match(String(leggiSegno(db, SEGNO_CLUSTER_PRINCIPALE)), /^errore:disco pieno/);
  });

  it("fallita ma schema completo (un altro processo ha vinto la corsa): il segno resta done", () => {
    const db = vecchio();
    migrateClusterPrincipale(db);
    db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_CLUSTER_PRINCIPALE);
    chiudiMigrazioneClusterPrincipaleFallita(db, "X", new Error("duplicate column name: primary_host_id"));
    assert.match(String(leggiSegno(db, SEGNO_CLUSTER_PRINCIPALE)), /^done:.*:v1$/);
  });

  it("senza la colonna (migrazione fallita) leggiClusterDiscovery non lancia: vale il ripiego", () => {
    const db = vecchio();
    // network_devices.host_id la aggiunge una migrazione dell'apertura, non TENANT_SCHEMA_SQL.
    if (!colonne(db, "network_devices").includes("host_id")) db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER");
    db.exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'r')");
    db.exec("INSERT INTO physical_devices (id, identity_confidence) VALUES (1, 1)");
    db.exec("INSERT INTO hosts (id, network_id, ip, physical_device_id) VALUES (1, 1, '192.0.2.10', 1), (2, 1, '192.0.2.9', 1)");
    assert.equal(leggiClusterDiscovery(db).get(1)?.principale_host_id, 2);
  });

  it("all'apertura del tenant, due volte: colonna presente, segno scritto una volta", () => {
    const d = getTenantDb(T2);
    assert.ok(colonne(d, "physical_devices").includes("primary_host_id"));
    const s1 = d.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_CLUSTER_PRINCIPALE);
    assert.match((s1 as { value: string }).value, /^done:\d{4}-\d{2}-\d{2}:v1$/);
    closeTenantDb(T2);
    const d2 = getTenantDb(T2);
    assert.deepEqual(d2.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_CLUSTER_PRINCIPALE), s1);
    assert.deepEqual(migrateClusterPrincipale(d2), []);
  });
});
