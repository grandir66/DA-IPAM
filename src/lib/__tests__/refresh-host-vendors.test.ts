/**
 * Test di `refreshHostVendorsFromMac` (db-tenant.ts + facade db.ts) — Task 2,
 * ririsoluzione vendor dai MAC con la KB, eseguita PRIMA del ricalcolo
 * attribuzione (scripts/attribution-recompute-cli.ts). Caso reale: VM 533/tenant
 * 70791 dopo il deploy KB v0.3.236, 16 host restati con hosts.vendor = "IEEE
 * Registration Authority" (scritto a scan-time dalla vecchia catena) mentre la
 * KB (57.778 prefissi, incl. MA-M/28 e MA-S/36) sa già risolverli.
 *
 * Pattern: tenant reale di test via withTenant()+getTenantDb() (stesso stile di
 * src/lib/__tests__/credential-chains.test.ts), ripulito in after(). `beforeEach`
 * riazzera/riseeda la tabella hosts ad ogni test: la funzione muta lo stato
 * (vendor risolto smette di essere placeholder), quindi ogni test riparte da
 * uno stato noto invece di dipendere dall'ordine di esecuzione.
 *
 * MAC di test presi da `data/attribution-kb.sqlite` (interrogato con sqlite3):
 * - prefisso /28 "0055DA0" → "Shinko Technos co.,ltd." (oui-data da solo, sul
 *   blocco 24-bit "0055DA", risolve invece "IEEE Registration Authority" — è
 *   esattamente il placeholder che il vecchio scan-time scriveva).
 * - prefisso /36 "001BC5000" → "Converging Systems Inc." (stesso discorso sul
 *   blocco 24-bit "001BC5").
 * - "AA:AA:AA:*" non è in KB né in oui-data → resta unresolved.
 *
 * Run: node --import tsx --test src/lib/__tests__/refresh-host-vendors.test.ts
 */
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  refreshHostVendorsFromMac,
} from "@/lib/db-tenant";

const T = "TESTVENDORREFRESH";

const MAC_MA_M = "00:55:DA:01:02:03"; // KB /28 "0055DA0" → "Shinko Technos co.,ltd."
const MAC_MA_S = "00:1B:C5:00:05:06"; // KB /36 "001BC5000" → "Converging Systems Inc."
const MAC_UNKNOWN = "AA:AA:AA:00:00:01"; // non in KB né in oui-data

function seedHost(id: number, networkId: number, ip: string, mac: string | null, vendor: string | null) {
  getTenantDb(T)
    .prepare(`INSERT INTO hosts (id, network_id, ip, mac, vendor) VALUES (?, ?, ?, ?, ?)`)
    .run(id, networkId, ip, mac, vendor);
}

before(() => {
  withTenant(T, () => {
    getTenantDb(T).prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.60.0.0/24', 'net1')`).run();
    getTenantDb(T).prepare(`INSERT INTO networks (id, cidr, name) VALUES (2, '10.61.0.0/24', 'net2')`).run();
  });
});

after(() => deleteTenantDatabase(T));

beforeEach(() => {
  withTenant(T, () => {
    getTenantDb(T).prepare("DELETE FROM hosts").run();
    // (1) placeholder + MAC risolvibile dalla KB (/28) → deve essere aggiornato.
    seedHost(1, 1, "10.60.0.1", MAC_MA_M, "IEEE Registration Authority");
    // (2) placeholder + MAC risolvibile dalla KB (/36) → deve essere aggiornato.
    seedHost(2, 1, "10.60.0.2", MAC_MA_S, "IEEE Registration Authority");
    // (3) vendor già valido → NON deve essere toccato, anche se lookupVendorSync
    //     darebbe un risultato diverso (nome custom mai scritto da OUI).
    seedHost(3, 1, "10.60.0.3", MAC_MA_M, "Marca Gia Corretta SRL");
    // (4) nessun MAC → ignorato (non esaminato).
    seedHost(4, 1, "10.60.0.4", null, "IEEE Registration Authority");
    // (5) placeholder + MAC non risolvibile (né KB né oui-data) → unresolved,
    //     vendor invariato.
    seedHost(5, 1, "10.60.0.5", MAC_UNKNOWN, "IEEE Registration Authority");
  });
});

describe("refreshHostVendorsFromMac", () => {
  it("aggiorna un host con vendor placeholder e MAC risolvibile dalla KB (/28 MA-M)", () => {
    const result = withTenant(T, () => refreshHostVendorsFromMac());
    const row = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 1").get() as { vendor: string };
    assert.equal(row.vendor, "Shinko Technos co.,ltd.");
    assert.equal(result.updated, 2, `attesi 2 aggiornamenti (id 1 e 2), ottenuti ${result.updated}`);
  });

  it("aggiorna un host con vendor placeholder e MAC risolvibile dalla KB (/36 MA-S)", () => {
    withTenant(T, () => refreshHostVendorsFromMac());
    const row = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 2").get() as { vendor: string };
    assert.equal(row.vendor, "Converging Systems Inc.");
  });

  it("NON tocca un host con vendor già valido, anche se il MAC risolverebbe diversamente", () => {
    withTenant(T, () => refreshHostVendorsFromMac());
    const row = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 3").get() as { vendor: string };
    assert.equal(row.vendor, "Marca Gia Corretta SRL");
  });

  it("ignora un host senza MAC (non esaminato, vendor invariato)", () => {
    const result = withTenant(T, () => refreshHostVendorsFromMac());
    const row = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 4").get() as { vendor: string };
    assert.equal(row.vendor, "IEEE Registration Authority");
    // esaminabili: 1, 2, 5 (placeholder + mac) — 3 ha vendor valido, 4 non ha mac.
    assert.equal(result.examined, 3);
  });

  it("un MAC non risolvibile (né KB né oui-data) resta 'unresolved' col vendor invariato", () => {
    const result = withTenant(T, () => refreshHostVendorsFromMac());
    const row = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 5").get() as { vendor: string };
    assert.equal(row.vendor, "IEEE Registration Authority");
    assert.equal(result.unresolved, 1);
  });

  it("conteggio esaminati esclude host con vendor valido e host senza MAC", () => {
    const result = withTenant(T, () => refreshHostVendorsFromMac());
    assert.equal(result.examined, 3);
    assert.equal(result.updated, 2);
    assert.equal(result.unresolved, 1);
  });

  it("filtro networkId: se passato, esamina solo gli host di quella rete", () => {
    withTenant(T, () => seedHost(6, 2, "10.61.0.1", MAC_MA_M, "IEEE Registration Authority"));
    const result = withTenant(T, () => refreshHostVendorsFromMac(2));
    assert.equal(result.examined, 1);
    assert.equal(result.updated, 1);
    const row = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 6").get() as { vendor: string };
    assert.equal(row.vendor, "Shinko Technos co.,ltd.");
    // host della rete 1 restano intatti (non esaminati da questa chiamata scoped).
    const row1 = getTenantDb(T).prepare("SELECT vendor FROM hosts WHERE id = 1").get() as { vendor: string };
    assert.equal(row1.vendor, "IEEE Registration Authority");
  });
});
