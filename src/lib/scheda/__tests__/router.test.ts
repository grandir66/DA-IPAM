/**
 * Pezzi puri della scheda router e firewall (21/10): uscite internet dalle rotte default, pool DHCP più pieno,
 * interfacce in Panoramica (prima le uscite e quelle su), caselle della striscia. Senza dato niente casella.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/router.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  eRottaDefault, usciteDefault, dimensioneRanges, poolDhcp, interfaccePanoramica, contaInterfacce, caselleRouter,
  type InterfacciaScheda,
} from "../router";

const rotta = (destination: string, gateway: string | null, active: number | null, extra: Record<string, unknown> = {}) =>
  ({ destination, gateway, active, ...extra });

describe("rotte default", () => {
  it("0.0.0.0/0 e ::/0 sono default, le altre no", () => {
    assert.equal(eRottaDefault({ destination: "0.0.0.0/0" }), true);
    assert.equal(eRottaDefault({ destination: "::/0" }), true);
    assert.equal(eRottaDefault({ destination: "10.0.0.0/8" }), false);
    assert.equal(eRottaDefault({}), false);
  });
  it("attive su totali, e la via della prima attiva", () => {
    const u = usciteDefault([rotta("0.0.0.0/0", "1.1.1.1", 1), rotta("0.0.0.0/0", "2.2.2.2", 0), rotta("10.0.0.0/8", "3.3.3.3", 1)]);
    assert.deepEqual(u, { attive: 1, totali: 2, via: "1.1.1.1" });
  });
  it("active assente conta come attiva (il dato non lo dice)", () => {
    assert.equal(usciteDefault([{ destination: "0.0.0.0/0", gateway: "9.9.9.9" }]).attive, 1);
  });
  it("nessuna default: zero su zero", () => {
    assert.deepEqual(usciteDefault([]), { attive: 0, totali: 0, via: null });
  });
});

describe("dimensione dei range di un pool", () => {
  it("intervallo, più intervalli, singolo IP e CIDR", () => {
    assert.equal(dimensioneRanges("192.168.1.10-192.168.1.250"), 241);
    assert.equal(dimensioneRanges("10.0.0.1-10.0.0.10,10.0.1.5"), 11);
    assert.equal(dimensioneRanges("10.0.0.0/24"), 256);
  });
  it("testo che non si capisce = 0, mai NaN", () => {
    assert.equal(dimensioneRanges(""), 0);
    assert.equal(dimensioneRanges("boh"), 0);
    assert.equal(dimensioneRanges("10.0.0.9-10.0.0.1"), 0);
  });
});

describe("pool DHCP", () => {
  const servers = [
    { name: "uffici", interface: "vlan40", addressPool: "pool-uffici", disabled: false },
    { name: "lan", interface: "bridge", addressPool: "pool-lan", disabled: false },
    { name: "spento", interface: "ether9", addressPool: "pool-x", disabled: true },
    { name: "senza-pool", interface: "ether7", addressPool: "static-only", disabled: false },
  ];
  const pools = [
    { name: "pool-uffici", ranges: "10.0.40.0-10.0.40.249" },
    { name: "pool-lan", ranges: "10.0.4.0-10.0.4.199" },
    { name: "pool-x", ranges: "10.9.9.1-10.9.9.50" },
  ];
  it("usati/totale/percento, dal più pieno; spenti e senza pool fuori", () => {
    const r = poolDhcp(servers, pools, { uffici: 231, lan: 76, spento: 4 });
    assert.deepEqual(r.map((p) => [p.server, p.usati, p.totale, p.percento]), [["uffici", 231, 250, 92], ["lan", 76, 200, 38]]);
  });
  it("oltre il pool resta 100", () => {
    const r = poolDhcp([servers[1]], pools, { lan: 999 });
    assert.equal(r[0].percento, 100);
  });
  it("nessun dato dal router = nessun pool", () => {
    assert.deepEqual(poolDhcp([], [], {}), []);
  });
});

const ifc = (ifname: string, stato: "up" | "down" | "unknown", ip?: string, prefisso = 24, extra: Partial<InterfacciaScheda> = {}): InterfacciaScheda => ({
  ifname, alias: null, stato, velocita_mbps: null, tipo: null, mac: null,
  indirizzi: ip ? [{ ip, prefisso, famiglia: 4 }] : [], ...extra,
});

describe("interfacce in Panoramica", () => {
  const rotte = [rotta("0.0.0.0/0", "203.0.113.1", 1)];
  const lista = [
    ifc("ether8", "down"),
    ifc("bridge-lan", "up", "192.168.4.1"),
    ifc("sfp1", "up", "203.0.113.2", 29),
    ifc("ether2", "down", "10.64.12.2", 30),
  ];
  it("prima l'uscita (gateway nella sua rete) e su, poi le su, poi le giù con indirizzo, poi le altre; il ruolo c'è solo dove si deduce", () => {
    const r = interfaccePanoramica(lista, rotte, 8);
    assert.deepEqual(r.map((x) => x.i.ifname), ["sfp1", "bridge-lan", "ether2", "ether8"]);
    assert.equal(r[0].uscita, true);
    assert.equal(r[1].uscita, false);
  });
  it("max rispettato", () => {
    assert.equal(interfaccePanoramica(lista, rotte, 2).length, 2);
  });
  it("l'uscita si riconosce anche dal nome dell'interfaccia sulla rotta", () => {
    const r = interfaccePanoramica([ifc("pppoe-out1", "up"), ifc("lan", "up", "192.168.0.1")], [rotta("0.0.0.0/0", null, 1, { interface_name: "pppoe-out1" })], 8);
    assert.equal(r[0].i.ifname, "pppoe-out1");
    assert.equal(r[0].uscita, true);
  });
  it("una rotta default non attiva non fa uscita", () => {
    const r = interfaccePanoramica(lista, [rotta("0.0.0.0/0", "203.0.113.1", 0)], 8);
    assert.ok(r.every((x) => !x.uscita));
  });
});

describe("conteggio interfacce", () => {
  it("su/totale e VLAN (dal tipo o dal nome)", () => {
    const c = contaInterfacce([ifc("a", "up"), ifc("vlan40", "up"), ifc("b", "down", undefined, 24, { tipo: "vlan" }), ifc("c", "unknown")]);
    assert.deepEqual(c, { su: 2, totale: 4, vlan: 2 });
  });
});

describe("caselle della striscia", () => {
  const base = { interfacce: null, rotte: [], regole: null, pool: [], acceso: null };
  it("senza dati nessuna casella", () => {
    assert.deepEqual(caselleRouter(base), []);
  });
  it("tutte quelle che hanno dato, ognuna con la sua tab", () => {
    const c = caselleRouter({
      interfacce: [ifc("a", "up"), ifc("vlan1", "down")],
      rotte: [rotta("0.0.0.0/0", "1.1.1.1", 1), rotta("10.0.0.0/8", "2.2.2.2", 1)],
      regole: { filter: 84, nat: 12, mangle: 5 },
      pool: [{ server: "uffici", interfaccia: "v40", usati: 231, totale: 250, percento: 92 }],
      acceso: "88 g",
    });
    assert.deepEqual(c.map((x) => x.etichetta), ["Uscite internet", "Interfacce su", "Regole", "DHCP uffici", "Rotte", "Acceso da"]);
    assert.equal(c[0].valore, "1 / 1");
    assert.equal(c[1].valore, "1 / 2");
    assert.equal(c[2].valore, "84 · 12 · 5");
    assert.equal(c[3].valore, "231 / 250");
    assert.equal(c[3].attenzione, true);
    assert.equal(c[3].tab, "dhcp");
    assert.equal(c[4].valore, "2");
    assert.equal(c[5].valore, "88 g");
  });
  it("pool sotto soglia: niente attenzione; nessuna uscita attiva con default presenti: attenzione", () => {
    const c = caselleRouter({ ...base, rotte: [rotta("0.0.0.0/0", "1.1.1.1", 0)], pool: [{ server: "lan", interfaccia: "b", usati: 76, totale: 200, percento: 38 }] });
    assert.equal(c.find((x) => x.etichetta === "Uscite internet")?.attenzione, true);
    assert.equal(c.find((x) => x.etichetta === "DHCP lan")?.attenzione, undefined);
  });
  it("conteggi regole parziali: i mancanti sono «—»", () => {
    const c = caselleRouter({ ...base, regole: { filter: 10, nat: null, mangle: null } });
    assert.equal(c[0].valore, "10 · — · —");
  });
});
