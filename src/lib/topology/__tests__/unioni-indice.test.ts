// Unioni e separazioni a mano nell'indice dei nodi (piano 2026-10-16, Task 1; ADR 0021): la regola sta in un punto solo,
// `buildNodeIndex`, che è l'indice di tutte e due le mappe. 1: senza righe la mappa è quella di oggi (il freno del rilascio).
// 2-8: il NAS dell'hub (support/nas.ts) da solo, unito, promosso, censito due volte, con un membro sparito. 9-11: le
// separazioni tolgono solo le fusioni automatiche deboli. 12: un'unione non trascina fusioni per nome. 13: nessuno costruisce
// l'indice senza passare da `indiceDeiNodi`, così le due mappe non possono dare due risposte diverse. 14 (revisione del Task 1):
// una catena di due gruppi attraverso due host con lo stesso MAC, e chi è entrato a mano.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import { resolveMapView } from "@/lib/topology/map-view";
import { buildTopologyModel } from "@/lib/topology/model";
import type { MapLink, TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, indiceDeiNodi, resolveNode } from "@/lib/topology/node-index";
import { TESTI_UNIONI, type ComeFuso } from "@/lib/topology/unioni-tipi";
import { ingresso } from "./support/cavi";
import { caricaFixture, RETI_CAVI } from "./support/famiglie-cavi";
import { impronta, improntaT1, serializza } from "./support/impronta";
import { GRUPPO_NAS, nas, nasDueApparati, nasPromosso } from "./support/nas";
import { altreMarcheSnmp, conHypervisor, mista, soloMikrotik, soloUnifi } from "./support/reti-campione";
import { baseInput, dev, host } from "./support/righe";

const fra = (m: Pick<TopologyModel, "links">, x: string, y: string): MapLink[] =>
  m.links.filter((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));
const idDeiNodi = (m: Pick<TopologyModel, "nodes">): string[] => m.nodes.map((n) => n.id);

/** Le sette reti delle impronte `PRIMA_DI_T2` di cavi-ombra.test.ts. */
const SETTE_RETI: ReadonlyArray<readonly [string, () => TopologyModelInput]> = [
  ["famiglia 1 · solo MikroTik", soloMikrotik], ["famiglia 2 · solo UniFi", soloUnifi], ["famiglia 3 · altre marche via SNMP", altreMarcheSnmp],
  ["famiglia 4 · con hypervisor", conHypervisor], ["famiglia 5 · mista", mista],
  ["fixture della rete B", () => caricaFixture("topologia-domarc.json")], ["fixture del cliente A", () => caricaFixture("topologia-cliente-a.json")],
];

test("1 · freno: con elenchi vuoti il modello di T1, l'albero e la mappa per cavo sono quelli senza elenchi", () => {
  for (const [nome, rete] of SETTE_RETI) {
    assert.deepEqual(improntaT1({ ...rete(), unioni: [], separazioni: [] }), improntaT1(rete()), nome);
  }
  for (const [nome, rete] of RETI_CAVI) {
    const senza = serializza(modelloMappaDaIngresso(rete(), { testaScelta: null }).mappa);
    const ing = rete();
    const con = serializza(modelloMappaDaIngresso({ ...ing, t1: { ...ing.t1, unioni: [], separazioni: [] } }, { testaScelta: null }).mappa);
    assert.equal(con, senza, nome);
  }
});

test("2 · NAS senza unione: tre nodi, un LLDP per switch, il collegamento a mano fra il secondo e il terzo; niente `unioni`", () => {
  const m = buildTopologyModel(nas());
  for (const id of ["host:11", "host:12", "host:13"]) assert.ok(idDeiNodi(m).includes(id), id);
  for (const [d, h] of [["dev:1", "host:11"], ["dev:2", "host:12"], ["dev:3", "host:13"]]) {
    assert.deepEqual(fra(m, d, h).map((l) => l.source), ["lldp"], `${d}–${h}`);
  }
  assert.deepEqual(fra(m, "host:12", "host:13").map((l) => l.source), ["manual"]);
  assert.equal("unioni" in m, false);
});

test("3 · NAS unito: un nodo coi tre indirizzi, gli alias, i tre LLDP e la ★ sul nodo unito; il collegamento fra due membri sparisce", () => {
  const prima = buildTopologyModel(nas());
  const m = buildTopologyModel({ ...nas(), unioni: GRUPPO_NAS });
  const n = m.nodes.find((x) => x.id === "host:11");
  assert.equal(n?.name, "QWNAS-7");
  assert.deepEqual(n?.fusedHostIds, [12, 13]);
  assert.deepEqual(n?.addresses.map((a) => a.ip), ["10.71.1.20", "10.71.2.20", "10.71.3.20"]);
  assert.equal(idDeiNodi(m).includes("host:12") || idDeiNodi(m).includes("host:13"), false);
  assert.equal(m.canonical["host:12"], "host:11");
  assert.equal(m.canonical["host:13"], "host:11");
  for (const d of ["dev:1", "dev:2", "dev:3"]) assert.deepEqual(fra(m, d, "host:11").map((l) => l.source), ["lldp"], d);
  assert.equal(m.links.some((l) => l.sources.includes("manual")), false, "i capi della correzione sono lo stesso nodo (links.ts)");
  const stella = fra(m, "host:11", "dev:2");
  assert.deepEqual(stella.map((l) => [l.primary, l.primaryFor]), [["user", "host:11"]]);
  assert.equal(m.counts.nodes, prima.counts.nodes - 2);
  assert.deepEqual(m.unioni, { aMano: { "host:11": [12, 13] }, nonApplicate: [], mancanti: [], separazioni: 0 });
});

test("4 · mappa salvata con membro e ritocco su un indirizzo unito: si leggono sul nodo unito, e si dice cosa riscrivere", () => {
  const m = buildTopologyModel({ ...nas(), unioni: GRUPPO_NAS });
  const r = resolveMapView(
    { members: ["dev:1", "host:13"], roots: [], tweaks: [{ nodeId: "host:13", x: 40, y: 80, sig: null, orientation: "lr" }], head: null },
    new Set(idDeiNodi(m)), m.canonical,
  );
  assert.deepEqual(r.visible, ["dev:1", "host:11"]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.tweaks.map((t) => t.nodeId), ["host:11"]);
  assert.deepEqual(r.renames, [{ from: "host:13", to: "host:11" }]);
});

test("5 · schermo = traccia: la mappa per cavo ha il nodo unito, ogni collegamento del NAS lo tocca, nessun capo «fuso»", () => {
  const { t1, m, mappa } = modelloMappaDaIngresso(ingresso({ ...nas(), unioni: GRUPPO_NAS }), { testaScelta: null });
  const nodi = idDeiNodi(mappa);
  assert.ok(nodi.includes("host:11"));
  assert.equal(nodi.includes("host:12") || nodi.includes("host:13"), false);
  const delNas = m.collegamenti.filter((c) => [c.a.nodo, c.b.nodo].some((x) => /^host:1[123]$/.test(x)));
  for (const c of delNas) assert.deepEqual([c.a.nodo, c.b.nodo].filter((x) => /^host:1[123]$/.test(x)), ["host:11"], c.id);
  assert.deepEqual(delNas.map((c) => (c.a.nodo === "host:11" ? c.b.nodo : c.a.nodo)).sort(), ["dev:1", "dev:2", "dev:3"]);
  assert.equal(mappa.cavi.nonCalcolato.some((r) => /ha fuso/.test(r)), false, "l'indice del modello per cavo è quello di T1");
  assert.ok(t1.unioni);
  assert.deepEqual(mappa.unioni, t1.unioni);
});

test("6 · un apparato vince: il NAS promosso prende i tre indirizzi, il primo come suo indirizzo, gli altri due a mano", () => {
  const ing = { ...nasPromosso(), unioni: GRUPPO_NAS };
  const idx = indiceDeiNodi(ing);
  assert.deepEqual(idx.nodes.get("dev:5")?.fusedHostIds, [11, 12, 13]);
  assert.deepEqual([11, 12, 13].map((h) => idx.come.get(h)), ["host_dell_apparato", "a_mano", "a_mano"]);
  assert.deepEqual(idx.aMano.get("dev:5"), [12, 13]);
  const m = buildTopologyModel(ing);
  assert.equal(m.canonical["host:12"], "dev:5");
  assert.equal(m.canonical["host:13"], "dev:5");
  assert.deepEqual(m.unioni?.aMano, { "dev:5": [12, 13] });
});

test("7 · due apparati no: l'unione non si applica, la mappa è quella senza unione, e si dice perché", () => {
  const { unioni, ...resto } = buildTopologyModel({ ...nasDueApparati(), unioni: GRUPPO_NAS });
  assert.equal(impronta(resto), impronta(buildTopologyModel(nasDueApparati())));
  for (const id of ["dev:5", "dev:6", "host:13"]) assert.ok(idDeiNodi(resto).includes(id), id);
  assert.deepEqual(unioni, {
    aMano: {}, mancanti: [], separazioni: 0,
    nonApplicate: [{ gruppo: 1, membri: ["host:11", "host:12", "host:13"], motivo: TESTI_UNIONI.dueApparati("QWNAS-7", "QWNAS-7-B") }],
  });
});

test("8 · membro sparito: si conta fra i mancanti e l'unione vale per gli altri; un gruppo con un solo membro esistente non fa niente", () => {
  const m = buildTopologyModel({ ...nas(), unioni: [...GRUPPO_NAS, { gruppo: 1, membro: "host:99" }] });
  assert.deepEqual(m.nodes.find((n) => n.id === "host:11")?.fusedHostIds, [12, 13]);
  assert.deepEqual(m.unioni, { aMano: { "host:11": [12, 13] }, nonApplicate: [], mancanti: ["host:99"], separazioni: 0 });
  const { unioni, ...resto } = buildTopologyModel({ ...nas(), unioni: [{ gruppo: 2, membro: "host:12" }, { gruppo: 2, membro: "dev:98" }] });
  assert.equal(impronta(resto), impronta(buildTopologyModel(nas())));
  assert.deepEqual(unioni, { aMano: {}, nonApplicate: [], mancanti: ["dev:98"], separazioni: 0 });
});

/** Una rete minima per ogni fusione automatica debole: [nome, ingresso, l'host che si fonde, l'oggetto con cui si fonde, come]. */
const DEBOLI: ReadonlyArray<readonly [string, TopologyModelInput, number, string, ComeFuso]> = [
  ["stesso apparato fisico", baseInput({ devices: [dev(1, { host: "10.71.9.1", physical_device_id: 7 })],
    hosts: [host(40, { ip: "10.71.9.40", physical_device_id: 7 })] }), 40, "dev:1", "stesso_apparato_fisico"],
  ["stesso MAC di un apparato", baseInput({ devices: [dev(1, { host: "10.71.9.1", controller_mac: "02:00:7e:00:09:01" })],
    hosts: [host(41, { ip: "10.71.9.41", mac: "02:00:7e:00:09:01" })] }), 41, "dev:1", "stesso_mac"],
  ["stesso nome di un apparato", baseInput({ devices: [dev(1, { host: "10.71.9.1", name: "NAS-OMEGA" })],
    hosts: [host(42, { ip: "10.71.9.42", hostname: "nas-omega", classification: "nas" })] }), 42, "dev:1", "stesso_nome"],
  ["due host per MAC", baseInput({ hosts: [host(43, { ip: "10.71.9.43", mac: "02:00:7e:00:09:43" }),
    host(44, { ip: "10.71.9.44", mac: "02:00:7e:00:09:43" })] }), 44, "host:43", "stesso_mac"],
  ["due server per nome", baseInput({ hosts: [host(45, { ip: "10.71.9.45", hostname: "SRV-OMEGA" }),
    host(46, { ip: "10.71.9.46", hostname: "srv-omega" })] }), 46, "host:45", "stesso_nome"],
];
const ipDi = (ing: TopologyModelInput, id: string): string => {
  const [tipo, n] = id.split(":");
  return (tipo === "dev" ? ing.devices.find((d) => d.id === Number(n))?.host : ing.hosts.find((h) => h.id === Number(n))?.ip) ?? "";
};

test("9 · separazioni: ognuna delle cinque fusioni deboli si toglie con la sua coppia, e restano due nodi", () => {
  for (const [nome, ing, h, altro, come] of DEBOLI) {
    const fuso = indiceDeiNodi(ing);
    assert.equal(canonical(fuso, `host:${h}`), altro, nome);
    assert.equal(fuso.come.get(h), come, nome);
    const diviso = indiceDeiNodi({ ...ing, separazioni: [{ membro: `host:${h}`, altro }] });
    assert.equal(canonical(diviso, `host:${h}`), `host:${h}`, nome);
    assert.equal(diviso.come.has(h), false, nome);
    assert.equal(resolveNode(diviso, { ip: ipDi(ing, `host:${h}`) }), `host:${h}`, nome);
    assert.equal(resolveNode(diviso, { ip: ipDi(ing, altro) }), altro, nome);
  }
});

test("10 · non separabili: l'host del host_id e quello con l'IP di gestione restano nell'apparato anche con la coppia", () => {
  const ing = baseInput({
    devices: [dev(1, { host: "10.71.9.1", host_id: 47 }), dev(2, { host: "10.71.9.2" })],
    hosts: [host(47, { ip: "10.71.9.47" }), host(48, { ip: "10.71.9.2" })],
  });
  const separazioni = [{ membro: "host:47", altro: "dev:1" }, { membro: "host:48", altro: "dev:2" }];
  for (const idx of [indiceDeiNodi(ing), indiceDeiNodi({ ...ing, separazioni })]) {
    assert.equal(canonical(idx, "host:47"), "dev:1");
    assert.equal(canonical(idx, "host:48"), "dev:2");
    assert.equal(idx.come.get(47), "host_dell_apparato");
    assert.equal(idx.come.get(48), "stesso_ip");
  }
  const { unioni, ...resto } = buildTopologyModel({ ...ing, separazioni });
  assert.equal(impronta(resto), impronta(buildTopologyModel(ing)));
  assert.equal(unioni?.separazioni, 2);
});

test("11 · gemello separato: senza coppia il gemello con lo stesso MAC entra col membro; con la coppia resta fuori e si trova da sé", () => {
  const t = nasPromosso();
  t.hosts.push(host(14, { network_id: 2, ip: "10.71.2.21", mac: "02:00:7b:00:02:12", classification: "nas" }));
  const unioni = [{ gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }];
  const insieme = indiceDeiNodi({ ...t, unioni });
  assert.deepEqual(insieme.nodes.get("dev:5")?.fusedHostIds, [11, 12, 14]);
  assert.equal(insieme.come.get(14), "a_mano");
  const idx = indiceDeiNodi({ ...t, unioni, separazioni: [{ membro: "host:14", altro: "dev:5" }] });
  assert.deepEqual(idx.nodes.get("dev:5")?.fusedHostIds, [11, 12]);
  assert.equal(canonical(idx, "host:12"), "dev:5");
  assert.equal(canonical(idx, "host:14"), "host:14");
  assert.equal(idx.come.has(14), false);
  assert.equal(resolveNode(idx, { ip: "10.71.2.21" }), "host:14");
  assert.equal(resolveNode(idx, { ip: "10.71.2.21", mac: "02:00:7b:00:02:12" }), "host:14");
  // Col solo MAC il vicino va all'apparato: il MAC è anche del 12, che è dentro l'apparato, e la chiave di un host (il 14, fuori)
  // non la toglie a un apparato (`put` debole). Voluto: un vicino che annuncia quel MAC senza IP è più probabile che sia il NAS.
  assert.equal(resolveNode(idx, { mac: "02:00:7b:00:02:12" }), "dev:5");
});

test("12 · nessuna fusione trascinata: il nome di un membro unito a mano non attira un altro host con lo stesso nome", () => {
  const t = nasPromosso();
  t.hosts = t.hosts.map((h) => (h.id === 12 ? { ...h, custom_name: "ZETA-NAS" } : h));
  t.hosts.push(host(20, { network_id: 4, ip: "10.71.4.20", mac: "02:00:7d:00:04:20", hostname: "ZETA-NAS", classification: "server" }));
  const idx = indiceDeiNodi({ ...t, unioni: GRUPPO_NAS });
  assert.deepEqual(idx.nodes.get("dev:5")?.fusedHostIds, [11, 12, 13]);
  assert.equal(canonical(idx, "host:20"), "host:20");
  assert.equal(idx.come.has(20), false);
  assert.equal(resolveNode(idx, { ip: "10.71.4.20" }), "host:20");
  // Il nome conteso fra il 12 (unito a mano) e il 20 resta conteso, come senza unione: unendo non cambia padrone (revisione finale).
  assert.equal(resolveNode(indiceDeiNodi(t), { name: "ZETA-NAS" }), null, "senza unione");
  assert.equal(resolveNode(idx, { name: "ZETA-NAS" }), null, "con l'unione");
});

test("13 · lucchetto: fuori da node-index.ts e dalle prove nessuno chiama buildNodeIndex (si passa da indiceDeiNodi)", () => {
  const radice = process.cwd();
  const sorgenti = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", ".next", "__tests__"].includes(e.name) ? [] : sorgenti(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
  const letti = [...sorgenti(path.join(radice, "src")), ...sorgenti(path.join(radice, "scripts"))].map((p) => path.relative(radice, p));
  // Un lucchetto che non vede i file passa sempre: i chiamanti di oggi devono essere fra quelli letti.
  for (const f of ["src/lib/topology/model.ts", "src/lib/topology/cavi/modello.ts", "scripts/misura-vm.ts"]) assert.ok(letti.includes(f), f);
  const fuori = letti
    .filter((f) => f !== "src/lib/topology/node-index.ts")
    .filter((f) => fs.readFileSync(path.join(radice, f), "utf8").includes("buildNodeIndex("));
  assert.deepEqual(fuori, []);
});

test("14 · catena attraverso un gemello fra soli host: due gruppi legati da due host con lo stesso MAC fanno un nodo solo, e chi è entrato si sa", () => {
  // 30 e 31 hanno lo stesso MAC vero (un gruppo automatico); 20 e 40 sono soli, con MAC di altri OUI e senza nome. Il gruppo 1
  // lega 20 a 30, il 2 lega 31 a 40: la catena 20–30=31–40 è un oggetto solo. Revisione del Task 1: con `radicePrima` riscritta
  // dal secondo gruppo, 30 e 31 non risultavano entrati a mano (la loro radice «di prima» diventava quella del rappresentante).
  const ing = baseInput({
    hosts: [
      host(20, { ip: "10.71.5.20", mac: "02:00:71:00:05:20" }),
      host(30, { ip: "10.71.5.30", mac: "02:00:72:00:05:30" }),
      host(31, { ip: "10.71.6.31", mac: "02:00:72:00:05:30" }),
      host(40, { ip: "10.71.6.40", mac: "02:00:73:00:06:40" }),
    ],
  });
  assert.equal(canonical(indiceDeiNodi(ing), "host:31"), "host:30", "senza unioni 30 e 31 sono già un nodo (stesso MAC)");
  const idx = indiceDeiNodi({ ...ing, unioni: [
    { gruppo: 1, membro: "host:20" }, { gruppo: 1, membro: "host:30" }, { gruppo: 2, membro: "host:31" }, { gruppo: 2, membro: "host:40" },
  ] });
  assert.deepEqual([...idx.nodes.keys()], ["host:20"]);
  assert.deepEqual(idx.nodes.get("host:20")?.fusedHostIds, [30, 31, 40]);
  for (const h of [30, 31, 40]) assert.equal(canonical(idx, `host:${h}`), "host:20", `host:${h}`);
  assert.deepEqual(idx.aMano.get("host:20"), [30, 31, 40]);
  assert.deepEqual([30, 31, 40].map((h) => idx.come.get(h)), ["a_mano", "a_mano", "a_mano"]);
  assert.equal(idx.come.has(20), false, "il rappresentante è l'oggetto del nodo");
});
