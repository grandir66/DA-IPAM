// Tavola di cablaggio (spec 2026-11-23 §5): composizione delle porte, righe, instradamento dei cavi, ingresso della rotta.
// Dati inventati con la forma vera (repo pubblico: nessun nome, IP o MAC reali; IP 192.0.2.x).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINK_ATTRS_DEFAULT, type MapLink, type MapNode } from "@/lib/topology/model-types";
import { componiTavola } from "@/lib/topology/tavola/componi";
import { disponiEInstrada, instrada } from "@/lib/topology/tavola/instrada";
import { disponi } from "@/lib/topology/tavola/righe";
import { parseSitoTavola, ritagliaSito } from "@/lib/topology/tavola/api";
import { cercaInTavola } from "@/lib/topology/tavola/ricerca";
import type { ApparatoComposto, PortaTavola } from "@/lib/topology/tavola/tipi";

const SITO = 7;

function nodo(id: number, type: string, extra: Partial<MapNode> = {}): MapNode {
  return {
    id: `dev:${id}`, kind: "device", refId: id, name: `app-${id}`, type, mgmtIp: `192.0.2.${id}`, fusedHostIds: [], addresses: [], aliases: [],
    siteId: SITO, rackId: null, siteProposed: false, hidden: false, vendor: null, ...extra,
  };
}

function coll(id: string, a: string, aPort: string, b: string, bPort: string, extra: Partial<MapLink> = {}): MapLink {
  return { ...LINK_ATTRS_DEFAULT, id, a, aPort, b, bPort, source: "lldp", sources: ["lldp"], uplinkFrom: null, lastSeen: null, daysUnseen: 0, stale: false, ...extra };
}

function porta(indice: number, extra: Partial<PortaTavola> = {}): PortaTavola {
  return { indice, nome: `Port ${indice}`, stato: "up", velocita: "1000 Mbps", vlan: 1, trunk: false, macCount: 0, nomeClient: null, ipClient: null, poeW: null, ...extra };
}

const cavoBase = { genere: "cavo" as const, stato: "inoltra" as const, fiducia: "certo" as const, porteDaVerificare: false, detti: [], frasi: [] };

test("componi: ogni tipo della tabella §3 da una riga di switch_ports + un collegamento", () => {
  const sw = nodo(1, "switch"), fw = nodo(2, "firewall"), pve = nodo(3, "server", { proxmoxScan: true }), fuori = nodo(4, "router", { siteId: 99 });
  const porte = [
    porta(1), porta(2), porta(3), porta(4, { nomeClient: "pc-prova" }), porta(5, { macCount: 6 }), porta(6, { stato: "down" }), porta(7),
  ];
  const t = componiTavola({
    sito: SITO, nodi: [sw, fw, pve, fuori],
    collegamenti: [coll("L1", "dev:1", "Port 1", "dev:2", "ether2"), coll("L2", "dev:1", "Port 2", "dev:3", "eno1"), coll("L3", "dev:1", "Port 3", "dev:4", "sfp1")],
    apparati: [{ node: "dev:1", porte }, { node: "dev:2", porte: [porta(2, { nome: "ether2" })] }, { node: "dev:3", porte: [{ ...porta(0, { nome: "eno1" }), indice: null }] }],
  });
  const s = t.apparati.find((a) => a.nodo === "dev:1")!;
  const tipo = (n: number) => s.porte[n - 1].tipo;
  assert.equal(tipo(1), "trunk");
  assert.equal(s.porte[0].destinazione, "app-2 p2");
  assert.equal(tipo(2), "server");
  assert.equal(s.porte[1].destinazione, "app-3 eno1");
  assert.equal(tipo(3), "linea");
  assert.equal(tipo(4), "client");
  assert.equal(s.porte[3].destinazione, "pc-prova");
  assert.equal(tipo(5), "molti");
  assert.equal(s.porte[4].destinazione, "6 MAC");
  assert.equal(tipo(6), "libera");
  assert.equal(s.porte[5].destinazione, null);
  assert.equal(tipo(7), "attiva");
  // Il router fuori sede non è un telaio: niente cavo; gli altri due sì.
  assert.equal(t.apparati.length, 3);
  assert.deepEqual(t.cavi.map((c) => c.id).sort(), ["L1", "L2"]);
});

test("componi: un fascio di due membri dà due cavi e una graffa; uno stale dà «da verificare»", () => {
  const a = nodo(1, "switch"), b = nodo(2, "switch");
  const fascio = { ...cavoBase, genere: "fascio" as const, fascio: { dedotto: false, membri: [
    { aPort: "Port 1", bPort: "Port 3", stato: "inoltra" as const, velocitaMbps: 1000 },
    { aPort: "Port 2", bPort: "Port 4", stato: "inoltra" as const, velocitaMbps: 1000 },
  ] } };
  const t = componiTavola({
    sito: SITO, nodi: [a, b],
    collegamenti: [coll("F", "dev:1", "bond0", "dev:2", "bond0", { cavo: fascio }), coll("S", "dev:1", "Port 5", "dev:2", "Port 5", { stale: true, daysUnseen: 9 })],
    apparati: [{ node: "dev:1", porte: [1, 2, 5].map((i) => porta(i)) }, { node: "dev:2", porte: [3, 4, 5].map((i) => porta(i)) }],
  });
  const fasci = t.cavi.filter((c) => c.collegamento === "F");
  assert.equal(fasci.length, 2);
  const pa = t.apparati.find((x) => x.nodo === "dev:1")!.porte;
  assert.deepEqual(pa.filter((p) => p.fascio === "F").map((p) => p.numero), ["1", "2"]);
  assert.equal(pa.every((p) => !p.fantasma), true, "la porta del bond non diventa una porta fantasma");
  assert.equal(pa.find((p) => p.numero === "5")!.dubbio, true);
  assert.equal(t.cavi.find((c) => c.id === "S")!.dubbio, true);
});

test("componi: una porta che l'elenco non ha diventa fantasma in fondo, il cavo non sparisce", () => {
  const t = componiTavola({
    sito: SITO, nodi: [nodo(1, "switch"), nodo(2, "switch")],
    collegamenti: [coll("L", "dev:1", "Port 9", "dev:2", "Port 1")],
    apparati: [{ node: "dev:1", porte: [porta(1)] }, { node: "dev:2", porte: [porta(1)] }],
  });
  const p = t.apparati.find((x) => x.nodo === "dev:1")!.porte;
  assert.equal(p.length, 2);
  assert.equal(p[1].fantasma, true);
  assert.equal(p[1].nome, "Port 9");
  assert.equal(t.cavi.length, 1);
});

/** Apparati finti per l'instradamento: `n` porte ciascuno. */
function app(id: number, n: number, rango = 2): ApparatoComposto {
  return { nodo: `dev:${id}`, refId: id, nome: `app-${id}`, tipo: "switch", ip: null, rackId: null, rango,
    porte: Array.from({ length: n }, (_, i) => ({ id: `dev:${id}|${i}`, nodo: `dev:${id}`, numero: String(i + 1), nome: `p${i + 1}`, tipo: "trunk" as const,
      destinazione: null, dubbio: false, collegamento: null, altroNodo: null, fantasma: false, fascio: null, velocita: null, vlan: null })) };
}

function segmenti(punti: Array<[number, number]>) {
  return punti.slice(1).map((p, i) => [punti[i], p] as const);
}

test("instrada: niente sovrapposizioni, il cavo fra le file 1 e 3 passa dal bordo, ogni collegamento una volta", () => {
  // Tre apparati da 30 porte: una riga ciascuno (oltre 28 porte, riga sua).
  const apparati = [app(1, 30, 0), app(2, 30, 1), app(3, 30, 2)];
  const righe = disponi(apparati, 1600);
  assert.equal(righe.length, 3);
  const cavi = [
    { id: "a", collegamento: "a", da: "dev:1|0", a: "dev:2|0", tipo: "trunk" as const, dubbio: false },
    { id: "b", collegamento: "b", da: "dev:1|1", a: "dev:2|5", tipo: "trunk" as const, dubbio: false },
    { id: "c", collegamento: "c", da: "dev:1|2", a: "dev:2|3", tipo: "trunk" as const, dubbio: false },
    { id: "lungo", collegamento: "lungo", da: "dev:1|4", a: "dev:3|4", tipo: "trunk" as const, dubbio: false },
    { id: "lungo", collegamento: "lungo", da: "dev:1|4", a: "dev:3|4", tipo: "trunk" as const, dubbio: false },
  ];
  const d = instrada(righe, cavi);
  assert.equal(d.linee.length, 4, "il doppione dello stesso cavo si disegna una volta");
  assert.equal(new Set(d.linee.map((l) => l.id)).size, 4);

  // Nessun tratto orizzontale sovrapposto a un altro alla stessa y.
  const orizz = d.linee.flatMap((l) => segmenti(l.punti).filter(([p, q]) => p[1] === q[1]).map(([p, q]) => ({ l: l.id, y: p[1], a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) })));
  for (const x of orizz) for (const y of orizz) {
    if (x.l >= y.l || x.y !== y.y) continue;
    assert.ok(x.b < y.a || y.b < x.a, `${x.l} e ${y.l} si sovrappongono a y=${x.y}`);
  }

  // Il cavo lungo non attraversa la fila 2 dentro il contenuto.
  const lungo = d.linee.find((l) => l.id === "lungo")!;
  assert.equal(lungo.lungo, true);
  const top2 = d.yRighe[1], bot2 = d.yRighe[1] + righe[1].h;
  const xMin = d.dx, xMax = d.dx + Math.max(...righe.map((r) => r.w));
  for (const [p, q] of segmenti(lungo.punti)) {
    const traversa = Math.max(p[1], q[1]) > top2 && Math.min(p[1], q[1]) < bot2;
    if (traversa) assert.ok(p[0] < xMin || p[0] > xMax, "il tratto che passa accanto alla fila 2 sta nella corsia di bordo");
  }
  assert.ok(d.attacchi["dev:1|4"] && d.attacchi["dev:3|4"]);
});

test("righe: gli apparati piccoli si affiancano finché ci stanno; un armadio nuovo apre una riga", () => {
  const piccoli = [app(1, 8), app(2, 8), app(3, 8)];
  assert.equal(disponi(piccoli, 2000).length, 1);
  assert.equal(disponi(piccoli, 300).length, 3);
  const conArmadio = [app(1, 8), { ...app(2, 8), rackId: 5 }];
  assert.equal(disponi(conArmadio, 2000).length, 2);
});

test("rotta: site non numerico 400, assente = primo sito; un sito senza apparati dà apparati vuoti", () => {
  assert.equal(parseSitoTavola("abc").ok, false);
  assert.equal(parseSitoTavola("-3").ok, false);
  assert.deepEqual(parseSitoTavola("0"), { ok: true, data: 0 });
  assert.deepEqual(parseSitoTavola(null), { ok: true, data: null });
  assert.deepEqual(parseSitoTavola("12"), { ok: true, data: 12 });
  const r = ritagliaSito({ nodes: [nodo(1, "switch")], links: [], sites: [{ locationId: SITO, name: "Sede A", headNodeId: null, headProposed: false, nodeIds: [] }] }, 42);
  assert.deepEqual(r.deviceIds, []);
  assert.deepEqual(r.collegamenti, []);
  // Un'istanza senza sedi: gli apparati senza sede stanno nel «sito» 0, che compare nell'elenco.
  const senza = ritagliaSito({ nodes: [nodo(1, "switch", { siteId: null }), nodo(2, "switch", { siteId: null })], links: [coll("L", "dev:1", "Port 1", "dev:2", "Port 1")], sites: [] }, 0);
  assert.deepEqual(senza.siti, [{ id: 0, name: "Senza sede" }]);
  assert.deepEqual(senza.deviceIds, [1, 2]);
  const t = componiTavola({ sito: 0, nodi: senza.nodi, collegamenti: senza.collegamenti, apparati: [{ node: "dev:1", porte: [porta(1)] }, { node: "dev:2", porte: [porta(1)] }] });
  assert.equal(t.cavi.length, 1);
  assert.equal(t.cavi[0].tipo, "trunk");
});

test("disponiEInstrada: con le corsie di bordo la tavola sta nella larghezza utile, nessun cavo fuori", () => {
  // Dodici apparati piccoli e cavi lunghi dalla prima riga a tutte le altre: tante corsie di bordo.
  const apparati = Array.from({ length: 18 }, (_, i) => app(i + 1, 8));
  const cavi = apparati.slice(1).map((a, i) => ({ id: `c${i}`, collegamento: `c${i}`, da: `dev:1|${i % 8}`, a: `${a.nodo}|0`, tipo: "trunk" as const, dubbio: false }));
  const L = 900;
  const primo = instrada(disponi(apparati, L), cavi);
  assert.ok(primo.larghezza > L, "senza i due giri la tavola esce dal riquadro (la prova vale solo se è così)");
  const { disegno } = disponiEInstrada(apparati, cavi, L);
  assert.ok(disegno.larghezza <= L, `larghezza ${disegno.larghezza} oltre ${L}`);
  for (const l of disegno.linee) for (const [x] of l.punti) assert.ok(x >= 0 && x <= disegno.larghezza, `${l.id} esce a x=${x}`);
  assert.equal(disegno.linee.length, cavi.length);
});

test("ricerca: un risultato per apparato trovato, le porte per client letto, in ordine di vista", () => {
  const t = componiTavola({
    sito: SITO, nodi: [nodo(1, "switch"), nodo(2, "firewall", { name: "prova-fw" })], collegamenti: [],
    apparati: [{ node: "dev:1", porte: [porta(1), porta(2, { nomeClient: "pc-prova", ipClient: "192.0.2.77" })] }, { node: "dev:2", porte: [porta(1)] }],
  });
  assert.deepEqual(cercaInTavola(t.apparati, "PROVA"), [{ nodo: "dev:2", porta: null }, { nodo: "dev:1", porta: "dev:1|1" }]);
  assert.deepEqual(cercaInTavola(t.apparati, "192.0.2.77"), [{ nodo: "dev:1", porta: "dev:1|1" }]);
  assert.deepEqual(cercaInTavola(t.apparati, "p"), []);
});
