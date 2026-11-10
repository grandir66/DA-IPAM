/**
 * Elenco «Annunci»: una riga per apparato, non per annuncio. Forme vere dell'hub (10/11/2026).
 * Run: node --import tsx --test src/lib/trunk/__tests__/annunci.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { raggruppaAnnunci } from "@/lib/trunk/annunci";

const ORA = "2026-11-10T20:00:00Z";
type Riga = Parameters<typeof raggruppaAnnunci>[0][number];
const r = (p: Partial<Riga>): Riga => ({
  protocollo: "mndp", sistema: "DA-RT-CORE", porta: "ether1", vid: 0, indirizzo: null, ultima_vista: ORA,
  piattaforma: null, versione: null, mac: null, host_id: null, host_ip: null, categoria: null, apparato: 0, ...p,
});

test("un MikroTik che si annuncia da più interfacce e protocolli è una riga sola", () => {
  const a = raggruppaAnnunci([
    r({ porta: "VL_4_SERVER", vid: 4, indirizzo: "192.168.4.254", piattaforma: "CCR2004-1G-12S+2XS", versione: "7.24.5 (stable)", host_id: 9, host_ip: "192.168.4.254", categoria: "network.router", apparato: 1 }),
    r({ porta: "VL_20_DMZ", vid: 20, piattaforma: "CCR2004-1G-12S+2XS", versione: "7.24.5 (stable)", host_id: 9, host_ip: "192.168.4.254", apparato: 1 }),
    r({ protocollo: "cdp", porta: "bridge/ether1", vid: 0, piattaforma: "MikroTik", versione: "7.24.5 (stable)\n(c) 1999" }),
  ]);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].protocolli, ["CDP", "MNDP"]);
  assert.equal(a[0].modello, "CCR2004-1G-12S+2XS", "il modello vero, non «MikroTik»");
  assert.equal(a[0].versione, "7.24.5 (stable)");
  assert.deepEqual(a[0].vlan, [0, 4, 20]);
  assert.equal(a[0].interfacce.length, 3);
  assert.deepEqual(a[0].host, { id: 9, ip: "192.168.4.254" });
  assert.equal(a[0].apparato, true);
});

test("in cima ciò che resta da fare: non in DA-IPAM, poi non registrato come apparato", () => {
  const a = raggruppaAnnunci([
    r({ sistema: "A-registrato", host_id: 1, host_ip: "10.0.0.1", apparato: 1 }),
    r({ sistema: "B-solo-host", host_id: 2, host_ip: "10.0.0.2", apparato: 0 }),
    r({ protocollo: "ubnt", sistema: "C-non-ce", porta: "?", vid: 6, indirizzo: "192.168.6.240", piattaforma: "USF5P" }),
  ]);
  assert.deepEqual(a.map((x) => x.nome), ["C-non-ce", "B-solo-host", "A-registrato"]);
  assert.equal(a[0].host, null);
  assert.equal(a[0].indirizzo, "192.168.6.240");
});

test("chi non dice il nome si distingue per MAC", () => {
  const a = raggruppaAnnunci([
    r({ sistema: "?", mac: "aa:bb:cc:00:00:01" }),
    r({ sistema: "?", mac: "aa:bb:cc:00:00:02" }),
  ]);
  assert.equal(a.length, 2);
});
