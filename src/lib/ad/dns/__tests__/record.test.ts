/**
 * Record DNS di Active Directory letti dall'attributo `dnsRecord`: solo quelli degli host.
 *
 * Run: node --import tsx --test src/lib/ad/dns/__tests__/record.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ipDaPtr, leggiRecord, nodoDiDominio, zonaDiDominio } from "../record";

/** Un record nella forma vera di AD. `ore` = ore dal 1601 (0 = statico). */
function record(tipo: number, dati: Buffer, ore = 0, ttl = 3600): Buffer {
  const b = Buffer.alloc(24 + dati.length);
  b.writeUInt16LE(dati.length, 0);
  b.writeUInt16LE(tipo, 2);
  b.writeUInt8(5, 4);
  b.writeUInt8(240, 5);
  b.writeUInt32LE(77, 8);
  b.writeUInt32BE(ttl, 12);
  b.writeUInt32LE(ore, 20);
  dati.copy(b, 24);
  return b;
}

/** Nome nel formato di AD: lunghezza, numero di etichette, etichette, zero finale. */
function nome(fqdn: string): Buffer {
  const etichette = fqdn.split(".");
  const corpo = Buffer.concat([...etichette.map((e) => Buffer.concat([Buffer.from([e.length]), Buffer.from(e)])), Buffer.from([0])]);
  return Buffer.concat([Buffer.from([corpo.length, etichette.length]), corpo]);
}

const ORE_2026_11_17 = Math.floor((Date.UTC(2026, 10, 17, 10) - Date.UTC(1601, 0, 1)) / 3_600_000);

describe("leggiRecord", () => {
  it("A statico: IP, nessuna data di rinnovo, TTL", () => {
    assert.deepEqual(leggiRecord(record(1, Buffer.from([192, 168, 4, 25]), 0, 1200)), {
      tipo: "A", dato: "192.168.4.25", statica: true, rinnovataIl: null, ttl: 1200,
    });
  });

  it("A dinamico: la data del rinnovo è nella forma di SQLite", () => {
    const r = leggiRecord(record(1, Buffer.from([10, 0, 0, 7]), ORE_2026_11_17));
    assert.equal(r?.statica, false);
    assert.equal(r?.rinnovataIl, "2026-11-17 10:00:00");
  });

  it("PTR e CNAME: il nome in minuscolo e senza punto finale", () => {
    assert.equal(leggiRecord(record(12, nome("PC-01.Esempio.Local")))?.dato, "pc-01.esempio.local");
    assert.equal(leggiRecord(record(5, nome("www.esempio.local")))?.tipo, "CNAME");
  });

  it("AAAA: sedici byte in otto gruppi", () => {
    const b = Buffer.alloc(16);
    b.writeUInt16BE(0xfe80, 0);
    b.writeUInt16BE(1, 14);
    assert.equal(leggiRecord(record(28, b))?.dato, "fe80:0:0:0:0:0:0:1");
  });

  it("un record di dominio (SRV) non si legge", () => {
    assert.equal(leggiRecord(record(33, Buffer.from([0, 0, 0, 100, 1, 133]))), null);
  });

  it("un buffer troppo corto o un A senza dati non si leggono", () => {
    assert.equal(leggiRecord(Buffer.alloc(10)), null);
    assert.equal(leggiRecord(record(1, Buffer.alloc(0))), null);
  });
});

describe("ipDaPtr", () => {
  it("zona /24", () => assert.equal(ipDaPtr("25", "4.168.192.in-addr.arpa"), "192.168.4.25"));
  it("zona /16 con nodo a due etichette", () => assert.equal(ipDaPtr("25.4", "168.192.in-addr.arpa"), "192.168.4.25"));
  it("zona /8", () => assert.equal(ipDaPtr("7.0.0", "10.in-addr.arpa"), "10.0.0.7"));
  it("nodo che non è un indirizzo, o zona non reverse", () => {
    assert.equal(ipDaPtr("gateway", "4.168.192.in-addr.arpa"), null);
    assert.equal(ipDaPtr("25", "esempio.local"), null);
  });
});

describe("cosa resta fuori", () => {
  it("zone di dominio e di servizio", () => {
    assert.equal(zonaDiDominio("_msdcs.esempio.local"), true);
    assert.equal(zonaDiDominio("RootDNSServers"), true);
    assert.equal(zonaDiDominio("..TrustAnchors"), true);
    assert.equal(zonaDiDominio("esempio.local"), false);
  });
  it("nodi di dominio dentro la zona degli host", () => {
    for (const n of ["@", "_ldap._tcp", "_tcp", "pdc._msdcs", "DomainDnsZones", "ForestDnsZones"]) assert.equal(nodoDiDominio(n), true, n);
    assert.equal(nodoDiDominio("pc-01"), false);
  });
});
