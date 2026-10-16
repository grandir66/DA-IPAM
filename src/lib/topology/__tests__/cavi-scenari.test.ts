// Gli scenari di T3 sulle due fixture delle reti vere e sulle reti-campione (spec topologia §13.12.1; Task 12 del piano di T3), coi
// fatti simulati in memoria sull'ingresso del modello (`ingresso(fixture, { fattiPorta, fattiBridge, macApparati })`): le due
// fixture sono quelle di oggi, anonime, e non hanno i fatti di T2. Id (interi del DB, non identificano nessuno), come in
// `model-fixtures.test.ts`: cliente A router 1 = dev:1, accesso A = dev:112, core 1 = dev:114; e dalle porte delle righe: accesso B
// = dev:124, accesso C = dev:78, accesso D = dev:102, core 2 = dev:120, il router di riserva è l'host:95 (nome annunciato diverso).
// Hub: router = dev:1, aggregazione = dev:11, switch di accesso = dev:10, hypervisor = dev:2-5, gateway del controller = dev:186.
// Poi i «Casi da non dimenticare» del piano sulle reti-campione, e l'invariante «schermo = traccia» con la regola «dalle VM» accesa
// (`DALLE_VM_SOLO_DETTAGLI` resta com'è: la prova la passa alla funzione).
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelloMappaCavi, modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import { alberoDellaPagina, contrazioni } from "@/lib/topology/cavi/albero-pagina";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import type { Collegamento } from "@/lib/topology/cavi/collegamenti";
import type { FattoPorta, IngressoCavi } from "@/lib/topology/cavi/prove";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { resolveMapView } from "@/lib/topology/map-view";
import { buildTopologyModel } from "@/lib/topology/model";
import type { LinkOverrideRow, TopologyModelInput } from "@/lib/topology/model-types";
import { fb, fp, ingresso, vic } from "./support/cavi";
import { RETI_CAVI, caricaFixture, conHypervisorEAltri } from "./support/famiglie-cavi";
import { letturaA, N } from "./support/quattro-letture";
import { baseInput, dev } from "./support/righe";
import { porte } from "./support/reti-campione";

const mod = (i: IngressoCavi, testa: string | null = null) => modelloMappaDaIngresso(i, { testaScelta: testa });
const fra = (m: ReturnType<typeof mod>["m"], x: string, y: string) => m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));
const portaDi = (t1: TopologyModelInput, d: number, i: number): string => t1.ports!.find((p) => p.device_id === d && p.port_index === i)!.port_name;
/** La chiave della porta di `nodo` nel collegamento; undefined se `nodo` non è un suo capo. */
const chiave = (c: Collegamento, nodo: string): string | null | undefined => [c.a, c.b].find((p) => p.nodo === nodo)?.chiave;
/** Il cavo fra due apparati su quelle porte (per indice, quella del primo e quella del secondo). */
const cavo = (m: ReturnType<typeof mod>["m"], x: string, ix: number, y: string, iy: number): Collegamento => {
  const c = fra(m, x, y).find((k) => chiave(k, x) === `i:${ix}` && chiave(k, y) === `i:${iy}`);
  assert.ok(c, `nessun cavo ${x}:${ix} ↔ ${y}:${iy}`);
  return c;
};
const A = () => caricaFixture("topologia-cliente-a.json");
const HUB = () => caricaFixture("topologia-domarc.json");
const discarding = { stp_state: "discarding", stp_role: "alternate" } as const;

// ─── Cliente A ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** I fatti che il controller darebbe su core 2 (le porte 9 e 12 ferme) e che il router darebbe sulla sua porta da 2,5G (fuori dal bridge). */
const fattiS5 = (t1: TopologyModelInput): FattoPorta[] => [
  fp(120, "i:9", "x", discarding), fp(120, "i:12", "x", discarding), fp(120, "i:11", "x", { stp_state: "forwarding" }),
  fp(1, `n:${portaDi(t1, 1, 1)}`, portaDi(t1, 1, 1), { source: "device", in_bridge: 0 }),
];

test("S5 · gli stati di oggi del controller: i cavi 1-11 e il segmento della WAN; 8 e 9 bloccati; l'anomalia su core 2", () => {
  const t1 = A();
  const { m } = mod(ingresso(t1, { fattiPorta: fattiS5(t1) }));
  const stato = (c: Collegamento) => [c.genere, c.stato, c.fiducia];
  assert.deepEqual(stato(cavo(m, "dev:114", 10, "dev:1", 9)), ["cavo", "inoltra", "probabile"], "1 · router 1 ↔ core 1, 10G (dall'LLDP di un capo solo, nelle righe di oggi)");
  assert.equal(cavo(m, "dev:114", 10, "dev:1", 9).velocitaMbps, 10000);
  assert.deepEqual(stato(cavo(m, "dev:112", 47, "dev:1", 1)), ["cavo", "instradato", "probabile"], "2 · router 1 ↔ accesso A porta 47, fuori dal bridge");
  assert.deepEqual(stato(cavo(m, "dev:112", 50, "dev:114", 9)), ["cavo", "inoltra", "certo"], "4 · core 1 porta 9 ↔ accesso A");
  assert.deepEqual(stato(cavo(m, "dev:114", 11, "dev:124", 49)), ["cavo", "inoltra", "certo"], "5 · core 1 porta 11 ↔ accesso B");
  assert.deepEqual(stato(cavo(m, "dev:114", 12, "dev:78", 50)), ["cavo", "inoltra", "certo"], "6 · core 1 porta 12 ↔ accesso C");
  assert.deepEqual(stato(cavo(m, "dev:120", 11, "dev:78", 49)), ["cavo", "inoltra", "certo"], "7 · accesso C ↔ core 2 porta 11, la sua porta radice");
  assert.deepEqual(stato(cavo(m, "dev:112", 49, "dev:120", 9)), ["cavo", "bloccato", "certo"], "8 · accesso A ↔ core 2 porta 9, bloccato dal lato di core 2");
  assert.deepEqual(stato(cavo(m, "dev:120", 12, "dev:124", 50)), ["cavo", "bloccato", "certo"], "9 · accesso B ↔ core 2 porta 12, bloccato");
  assert.deepEqual(stato(cavo(m, "dev:124", 51, "dev:102", 25)), ["cavo", "inoltra", "certo"], "10 · accesso B ↔ accesso D");
  const c11 = m.collegamenti.find((c) => [c.a.nodo, c.b.nodo].includes("dev:124") && chiave(c, "dev:124") === "i:16")!;
  assert.deepEqual([stato(c11), [c11.a.nodo, c11.b.nodo].filter((n) => n !== "dev:124")], [["cavo", "inoltra", "probabile"], ["host:95"]], "11 · accesso B porta 16 ↔ router di riserva, LLDP da un capo");
  assert.deepEqual(m.segmenti.map((s) => [s.id, s.altriApparati, s.membri.map((p) => p.nodo).sort()]), [["seg:1:8", 1, ["dev:1", "dev:114"]]], "3 · il segmento della WAN: core 1 porta 15, ether8 di router 1 e un apparato non gestito");
  assert.equal(m.collegamenti.some((c) => c.genere === "cavo" && [c.a.nodo, c.b.nodo].sort().join() === "dev:1,dev:114" && chiave(c, "dev:114") === "i:15"), false, "nessun cavo dalla porta del segmento");
  assert.deepEqual(m.albero.anomalie.map((a) => [a.nodo, a.padre, a.altri]), [["dev:120", "dev:78", ["dev:112", "dev:124"]]], "core 2 esce da uno switch di accesso");
  assert.equal(m.albero.padri["dev:120"], "dev:78", "core 2 sta sotto accesso C, dalla sua porta radice");
});

test("S6 · lo spanning tree del router simulato: radice router 1, poi radice core 1 — lo stesso albero (nel secondo il cavo 1 va «contro verso», ma è l'unico percorso attivo)", () => {
  const t1 = A();
  const mac1 = "02:00:07:00:00:01";   // l'identità di bridge del router: inventata, come tutta la fixture
  const macCore = t1.devices.find((d) => d.id === 114)!.controller_mac!;
  const radiceRouter = fb(1, { bridge_name: "bridge", bridge_id: `32768.${mac1}`, root_id: `32768.${mac1}` });
  const radiceCore = fb(1, { bridge_name: "bridge", bridge_id: `32768.${mac1}`, root_id: `4096.${macCore}`, root_port: portaDi(t1, 1, 9) });
  const uno = mod(ingresso(A(), { fattiBridge: [radiceRouter] })).m, due = mod(ingresso(A(), { fattiBridge: [radiceCore] })).m;
  assert.deepEqual(due.albero.padri, uno.albero.padri, "lo stesso albero");
  assert.deepEqual([uno.albero.avvisi, due.albero.avvisi], [[], []]);
  const cavo1 = (m: typeof uno) => cavo(m, "dev:114", 10, "dev:1", 9);
  assert.equal(cavo1(uno).id, cavo1(due).id, "il cavo 1 è lo stesso");
  assert.equal(uno.albero.scelto.get("dev:1"), undefined, "radice router 1: il router è la radice, nessuna porta radice");
  assert.equal(due.albero.scelto.get("dev:1"), cavo1(due).id, "radice core 1: la porta radice del router è il cavo 1");
  assert.equal(cavo1(due).verso, "dev:114", "e il controller dice che core 1 esce da lì: il cavo va contro verso, ma è l'unico percorso attivo");
});

test("S7 · «Ignora» sul cavo 1: sparisce solo lui; il segmento e il cavo 2 restano", () => {
  const t1 = A();
  const ignora: LinkOverrideRow = { id: 9, action: "ignore", a_node: "dev:114", a_port: portaDi(t1, 114, 10), b_node: "dev:1", b_port: portaDi(t1, 1, 9), medium: null, created_by: null, created_at: "2026-10-14 10:00:00" };
  const prima = mod(ingresso(A())).m;
  const t7 = A();
  t7.overrides = [...t7.overrides, ignora];
  const dopo = mod(ingresso(t7)).m;
  const id = (m: typeof prima) => new Set(m.collegamenti.map((c) => c.id));
  assert.deepEqual([...id(prima)].filter((x) => !id(dopo).has(x)), [cavo(prima, "dev:114", 10, "dev:1", 9).id], "sparisce solo il cavo 1");
  assert.deepEqual([...id(dopo)].filter((x) => !id(prima).has(x)), [], "e non ne compare nessuno");
  assert.deepEqual(dopo.segmenti.map((s) => s.id), ["seg:1:8"], "il segmento resta");
  assert.equal(cavo(dopo, "dev:112", 47, "dev:1", 1).genere, "cavo", "il cavo 2 resta");
  assert.deepEqual(dopo.correzioniOrfane, prima.correzioniOrfane, "la correzione nuova toglie un cavo: non è orfana (resta solo quella del 14/10)");
});

test("S8 · il «MAC + 1» degli apparati simulati (`ethernet_table`): il cavo 2 diventa «certo» — l'LLDP del router, e il MAC del suo vicino che l'apparato dichiara suo", () => {
  const t1 = A();
  // Il router annuncia accesso A col MAC del telaio + 1 (come sull'hub per 7 switch su 12), in una riga LLDP; gli apparati simulati dichiarano quel MAC.
  const lldp = (): TopologyModelInput => ({ ...A(), neighbors: A().neighbors.map((n) => (n.device_id === 1 && n.remote_device_name === "ext-1" && n.local_port === "ether1-2.5" ? { ...n, protocol: "lldp" } : n)) });
  const piu1 = [{ device_id: 112, mac: "02:00:16:00:00:02", source: "controller" }];
  const stato = (i: IngressoCavi) => { const c = cavo(mod(i).m, "dev:112", 47, "dev:1", 1); return [c.stato, c.fiducia]; };
  assert.deepEqual(stato(ingresso(t1)), ["inoltra", "probabile"], "prima: probabile (il router non si abbina)");
  assert.deepEqual(stato(ingresso(lldp())), ["inoltra", "probabile"], "l'LLDP senza il MAC dell'apparato: il router annuncia un telaio che nessuno dichiara");
  assert.deepEqual(stato(ingresso(A(), { macApparati: piu1 })), ["inoltra", "probabile"], "il MAC senza l'LLDP: una riga MNDP non conferma mai");
  assert.deepEqual(stato(ingresso(lldp(), { macApparati: piu1 })), ["instradato", "certo"], "l'LLDP e il MAC: il router si abbina dai due capi, il cavo 2 è certo (e fuori dal bridge)");
});

test("S10 (13.15 punto 1; I49, I50) · il segmento della WAN sta sotto ether8 di router 1; core 1 porta 15 e il router di riserva restano membri come ridondanze; nessun altro padre cambia", () => {
  const t1 = A();
  const { m } = mod(ingresso(t1));
  assert.equal(m.albero.padri["seg:1:8"], "dev:1", "sotto router 1, il membro più vicino alla testa");
  assert.equal(m.albero.via.get("seg:1:8")?.a.nodo === "dev:1" || m.albero.via.get("seg:1:8")?.b.nodo === "dev:1", true);
  const linee = m.collegamenti.filter((c) => c.genere === "segmento");
  assert.deepEqual(linee.map((c) => c.a.nodo).sort(), ["dev:1", "dev:114"], "i due membri gestiti hanno la loro linea verso il segmento");
  const usate = new Set([...m.albero.via.values()].map((c) => c.id));
  assert.deepEqual(linee.filter((c) => !usate.has(c.id)).map((c) => c.a.nodo), ["dev:114"], "la porta 15 di core 1 è una ridondanza");
  // nessun altro padre cambia rispetto a T1 (la mappa di oggi): c'è solo il segmento in più
  const t1Padri = padriDi(computeMapView(buildTopologyModel(A()), { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" }).tree);
  const diversi = Object.keys({ ...t1Padri, ...m.albero.padri }).filter((k) => t1Padri[k] !== m.albero.padri[k]);
  assert.deepEqual(diversi, ["seg:1:8"]);
  assert.equal(m.albero.padri["host:95"], "dev:124", "il router di riserva sta sotto accesso B, porta 16, non sotto il segmento (I50)");
});

// ─── S11 e I56: «dalle VM» ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Il modello e la mappa con la regola «dalle VM» come si vuole (la costante resta com'è: la prova la passa a `costruisciModelloCavi`). */
function conRegolaDalleVm(ing: IngressoCavi, accesa: boolean) {
  const t1 = buildTopologyModel(ing.t1);
  const m = costruisciModelloCavi(ing, t1, { testaScelta: null, dalleVmSoloDettagli: accesa });
  return { t1, m, mappa: modelloMappaCavi(t1, m, ing) };
}

test("S11 e I56 (famiglia 4: le reti vere non hanno VM, ADR 0010 n. 8) · con la regola accesa un collegamento «dalle VM» non principale non si disegna e sta nei dettagli; i principali e i padri sono uguali", () => {
  const ing = ingresso(conHypervisorEAltri());
  const spenta = conRegolaDalleVm(ing, false), accesa = conRegolaDalleVm(ing, true);
  assert.equal(fra(spenta.m, "dev:4", "dev:41").length, 1, "spenta: una ridondanza a richiesta");
  assert.equal(fra(accesa.m, "dev:4", "dev:41").length, 0, "accesa: non si disegna, nemmeno a richiesta");
  assert.deepEqual(accesa.mappa.cavi.dalleVm, { "dev:41": [{ altro: "dev:4", porta: "Port 5", vm: 1 }] }, "nei dettagli dell'hypervisor, con la porta e le VM");
  assert.deepEqual(spenta.mappa.cavi.dalleVm, {});
  assert.deepEqual(accesa.m.albero.padri, spenta.m.albero.padri, "i padri uguali");
  assert.deepEqual([...accesa.m.albero.via].map(([n, c]) => [n, c.id]), [...spenta.m.albero.via].map(([n, c]) => [n, c.id]), "i principali uguali");
  assert.equal(fra(accesa.m, "dev:3", "dev:43").length, 1, "un server con una VM sola tiene il suo principale");
  assert.equal(accesa.mappa.links.some((l) => [l.a, l.b].sort().join() === "dev:4,dev:41"), false, "la linea non è fra quelle della pagina");
});

test("I56 · con `lldpd` sull'host, un collegamento «dalle VM» su una porta che l'host non conferma si scarta; senza righe dell'host resta", () => {
  const ing = ingresso(conHypervisorEAltri());
  const host = vic({ device_id: 41, local_port: "ens1", remote_device_name: "CORE-H", remote_mac: "02:00:f4:00:02:00", remote_port: "SFP+ 3 - pve-1", source: "host" });
  const senza = conRegolaDalleVm(ing, false).m, con = conRegolaDalleVm({ ...ing, vicini: [...ing.vicini, host] }, false).m;
  assert.equal(fra(senza, "dev:4", "dev:41").length, 1, "senza l'host la VM sulla porta 5 di ACC-H2 fa un collegamento");
  assert.equal(fra(con, "dev:4", "dev:41").length, 0, "l'host conferma altra porta: quel collegamento è scartato");
  assert.deepEqual(con.scartateVm.map((s) => [s.porta.nodo, s.ipervisore]), [["dev:4", "dev:41"]]);
});

// ─── Hub ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const lag = (id: number, porta: string, gruppo: string, partner: string): FattoPorta => fp(id, `n:${porta}`, porta, { source: "device", lag_group: gruppo, lag_partner: partner });

test("H3 · router – aggregazione è un fascio di 2 cavi · 2 × 25G (provato dal partner LACP, il MAC dell'aggregazione)", () => {
  const ing = ingresso(HUB(), { macApparati: [{ device_id: 11, mac: "02:00:01:00:00:04", source: "controller" }],
    fattiPorta: [lag(1, "sfp28-1", "bond1", "02:00:01:00:00:04"), lag(1, "sfp28-2", "bond1", "02:00:01:00:00:04")] });
  const f = fra(mod(ing).m, "dev:1", "dev:11");
  assert.deepEqual(f.map((c) => [c.genere, c.membri?.length, c.velocitaMbps, c.fascioDedotto]), [["fascio", 2, 50000, false]]);
  assert.deepEqual(f[0].membri?.map((x) => x.velocitaMbps), [25000, 25000]);
  const senza = fra(mod(ingresso(HUB())).m, "dev:1", "dev:11");
  assert.deepEqual(senza.map((c) => c.genere), ["cavo", "cavo"], "senza i fatti LAG: due linee (le porte del router sono di bordo, nessun BPDU)");
});

test("H5 · la porta 5 dello switch 48 PoE (4 apparati) è un segmento; gli switch di laboratorio, che sono solo host, non hanno cavi e stanno in «Da sistemare»", () => {
  const { m, mappa } = mod(ingresso(HUB()));
  assert.deepEqual(m.segmenti.map((s) => [s.id, s.altriApparati, s.membri.map((p) => p.nodo)]), [["seg:7:5", 4, ["dev:7"]]]);
  assert.equal(m.collegamenti.some((c) => c.genere === "cavo" && chiave(c, "dev:7") === "i:5"), false, "nessun cavo dalla porta 5");
  assert.ok((mappa.daSistemare ?? []).some((d) => d.id.startsWith("host:")), "gli host-switch senza prove stanno in «Da sistemare»");
});

test("H6 · un segmento nasce solo da una porta fisica certa: nessun «eth0», sulle due reti", () => {
  for (const t1 of [HUB(), A()]) {
    const { m } = mod(ingresso(t1));
    assert.ok(m.segmenti.length > 0);
    assert.deepEqual(m.segmenti.flatMap((s) => s.membri.map((p) => p.nome)).filter((n) => /^eth\d/i.test(n)), []);
  }
});

test("H8 · anomalie contate: l'hub ne ha 0, il cliente A una (core 2)", () => {
  assert.deepEqual(mod(ingresso(HUB())).m.albero.anomalie, []);
  assert.equal(mod(ingresso(A())).m.albero.anomalie.length, 1);
});

test("H11 · il gateway del controller: la sua uplink è la WAN — «instradato (WAN)», senza verso, mai il padre per scelta di verso", () => {
  const { m } = mod(ingresso(HUB()));
  const wan = m.collegamenti.filter((c) => c.wan && [c.a.nodo, c.b.nodo].includes("dev:186"));
  assert.deepEqual(wan.map((c) => [c.genere, c.stato, c.verso, c.porteDaVerificare]), [["cavo", "instradato", null, false]], "la WAN non porta più «porte da verificare» (decisione del Task 4: le due porte non sono i capi di un cavo)");
  assert.deepEqual(wan.map((c) => chiave(c, "dev:186")), ["i:12"], "la porta dell'uplink del gateway");
});

// Il difetto che l'hub trovava (Task 12): la riga dell'AP (porta «eth0», porta dello switch non nota) e quella dello switch (Port N,
// porta dell'AP annunciata come pezzo di MAC) davano due linee, perché il nome unico del §13.6.1 passo 5 (I46) contava solo i nomi
// annunciati verso l'AP, non quello che l'AP dà alla sua porta nella sua riga verso lo stesso switch. Due nomi della stessa porta
// letti dai due capi: la porta annunciata è da completare (passo 6) e i cavi si fondono, col nome che l'AP dà alla sua porta.
test("H12 · nessun access point con due linee verso lo stesso switch (porta annunciata come pezzo di MAC da un lato, «eth0» dall'altro)", () => {
  const { m } = mod(ingresso(HUB()));
  for (const [ap, porta] of [["dev:187", "i:2"], ["dev:191", "i:1"]] as const) {
    const c = fra(m, "dev:12", ap);
    assert.equal(c.length, 1, `${ap}: una linea sola verso lo switch`);
    assert.deepEqual([chiave(c[0], "dev:12"), chiave(c[0], ap), c[0].fiducia], [porta, "n:eth0", "certo"], `${ap}: la porta dello switch dalla sua riga, quella dell'AP dalla riga dell'AP; visto dai due capi`);
  }
});

test("H13 · l'hypervisor sul nome doppio dell'aggregazione sta sotto l'aggregazione, a 10G", () => {
  const { m } = mod(ingresso(HUB()));
  assert.equal(m.albero.padri["dev:4"], "dev:11");
  assert.equal(m.albero.via.get("dev:4")?.velocitaMbps, 10000);
  assert.deepEqual(["dev:2", "dev:3", "dev:5"].map((h) => m.albero.padri[h]), ["dev:11", "dev:11", "dev:11"]);
});

test("H18 · il fascio router – NAS provato solo dal partner LACP (le righe del router sono annunci di rete, mai un cavo): una linea sola con i due membri", () => {
  const solo = fra(mod(ingresso(HUB())).m, "dev:1", "host:59");
  assert.equal(solo.some((c) => c.genere === "fascio"), false, "senza il partner non c'è un fascio: solo l'annuncio di rete sulla porta fisica, probabile, «attraverso apparati non letti»");
  assert.ok(solo.every((c) => c.attraverso === true && c.fiducia === "probabile"));
  const ing = ingresso(HUB(), { fattiPorta: [lag(1, "sfp-sfpplus11", "bond2", "02:00:22:00:00:02"), lag(1, "sfp-sfpplus12", "bond2", "02:00:22:00:00:02")] });
  const f = fra(mod(ing).m, "dev:1", "host:59");
  assert.deepEqual(f.map((c) => [c.genere, c.membri?.length, c.velocitaMbps, c.fascioDedotto]), [["fascio", 2, 20000, false]]);
});

test("H19 · gli switch senza spanning tree: nessuna anomalia «uplink del controller su una porta ferma»; il loro uplink, `disabled` su una porta accesa, inoltra", () => {
  const t1 = HUB();
  const senzaStp = t1.uplinkPorts.filter((u) => { const p = t1.ports!.find((x) => x.device_id === u.device_id && x.port_index === u.port_index); return p?.stp_state === "disabled" && p.status === "up"; });
  assert.ok(senzaStp.length >= 2, "la fixture ha switch con l'uplink disabled su una porta accesa");
  const { m } = mod(ingresso(t1));
  assert.deepEqual(m.albero.avvisi, [], "nessun avviso");
  assert.equal(m.collegamenti.filter((c) => c.stato === "bloccato").length, 0);
  for (const u of senzaStp) assert.equal(m.albero.padri[`dev:${u.device_id}`], "dev:182", `dev:${u.device_id} sceglie il padre dall'uplink`);
});

/** L'hub con il router di frontiera censito in memoria (scelta di Riccardo, §13.16): ha i MAC che gli altri apparati gli sentono addosso. */
function hubConFrontiera(): IngressoCavi {
  const t1 = HUB();
  t1.devices = [...t1.devices, dev(900, { name: "RTR-FRONTIERA", device_type: "router", host: "10.0.5.251", vendor: "mikrotik", via: "ssh" })];
  const macs = ["05", "06", "07", "08", "09", "0a"].map((x) => `02:00:35:00:00:${x}`);
  t1.knownMacs = [...t1.knownMacs, ...macs.map((mac) => ({ device_id: 900, mac }))];
  return ingresso(t1, {
    macApparati: macs.map((mac) => ({ device_id: 900, mac, source: "device" })),
    fattiPorta: [fp(900, "n:sfp-sfpplus2", "sfp-sfpplus2", { source: "device", in_bridge: 0 }), fp(900, "n:sfp-sfpplus4", "sfp-sfpplus4", { source: "device", in_bridge: 0 }),
      fp(900, "n:sfp-sfpplus12", "sfp-sfpplus12", { source: "device", in_bridge: 1, stp_state: "forwarding" })],
    fattiBridge: [fb(900, { bridge_id: "32768.02:00:35:00:00:05", root_id: "0.02:00:04:00:00:01", root_port: "sfp-sfpplus12" })],
  });
}

test("H20 · nessun fascio dedotto fra il router e il router di frontiera (porte di bordo, fuori dal bridge) né fra l'aggregazione e il gateway (WAN e LAN); resta dedotto il fascio fra l'aggregazione e uno switch di accesso", () => {
  const { m } = mod(hubConFrontiera());
  assert.deepEqual(fra(m, "dev:1", "dev:900").map((c) => [c.genere, c.stato]), [["cavo", "instradato"], ["cavo", "instradato"]]);
  assert.deepEqual(fra(m, "dev:11", "dev:186").map((c) => c.genere), ["cavo"]);
  // l'aggregazione e lo switch di accesso, porte 5 e 6 (49 e 50 dell'accesso), tutte e due in inoltro con lo spanning tree
  const stp = (d: number, i: number) => fp(d, `i:${i}`, "x", { stp_state: "forwarding" });
  const f = fra(mod(ingresso(HUB(), { fattiPorta: [stp(10, 49), stp(10, 50), stp(11, 5), stp(11, 6)] })).m, "dev:10", "dev:11");
  assert.deepEqual(f.map((c) => [c.genere, c.fascioDedotto, c.membri?.length]), [["fascio", true, 2]]);
  assert.deepEqual(fra(mod(ingresso(HUB())).m, "dev:10", "dev:11").map((c) => c.genere), ["cavo", "cavo"], "senza lo spanning tree letto sui due capi: due linee");
});

test("H21 · il router di frontiera censito: sotto l'aggregazione, porta 10 (la sua porta radice); i due cavi diretti verso il router «instradato», ridondanze", () => {
  const { m } = mod(hubConFrontiera());
  assert.equal(m.albero.padri["dev:900"], "dev:11");
  assert.equal(chiave(m.albero.via.get("dev:900")!, "dev:11"), "i:10", "sulla porta 10 dell'aggregazione");
  const diretti = fra(m, "dev:1", "dev:900");
  assert.deepEqual(diretti.map((c) => c.stato), ["instradato", "instradato"]);
  const usate = new Set([...m.albero.via.values()].map((c) => c.id));
  assert.equal(diretti.some((c) => usate.has(c.id)), false, "ridondanze, mai il padre");
  assert.equal(m.albero.padri["dev:1"], null, "il router resta la testa");
});

// ─── I «Casi da non dimenticare» del piano, sulle reti-campione ────────────────────────────────────────────────────────────────

/** Tre router sullo stesso segmento della WAN (con un modem non gestito); `senzaPrimo`: il router con l'id più piccolo non lo sente più nessuno. */
function tre(senzaPrimo: boolean): IngressoCavi {
  const g = (id: number) => dev(id, { name: `RT-WAN-${id}`, device_type: "router", host: `10.40.0.${id}`, vendor: "mikrotik", via: "ssh" });
  const t1 = baseInput({
    devices: [g(1), g(2), g(3)], networks: [{ id: 1, cidr: "10.40.0.0/24", name: "lan", gateway: "10.40.0.1", location_id: null }], neighbors: [],
    ports: [1, 2, 3].flatMap((id) => porte(id, [[1, "ether1", "1000 Mbps"]])),
  });
  const sente = (da: number, chi: number) => vic({ device_id: da, local_port: "ether1", remote_device_name: `RT-WAN-${chi}`, remote_port: "ether1", remote_ip: `10.40.0.${chi}`, remote_mac: `02:00:d1:00:0${chi}:01`, source: "device", remote_platform: "MikroTik" });
  const modem = (da: number) => vic({ device_id: da, local_port: "ether1", remote_device_name: "MODEM-WAN", remote_mac: "02:00:d1:00:77:01", remote_port: "eth0", source: "device" });
  const tutti = [1, 2, 3].filter((x) => !(senzaPrimo && x === 1));
  return ingresso(t1, { vicini: tutti.flatMap((da) => [modem(da), ...tutti.filter((x) => x !== da).map((x) => sente(da, x))]), macApparati: [1, 2, 3].map((id) => ({ device_id: id, mac: `02:00:d1:00:0${id}:01`, source: "device" })) });
}

test("Caso 1 · un id «seg:» salvato in una mappa passo passo si risolve nel segmento che contiene ancora quel membro, anche se l'id del segmento cambia perché esce il membro con la chiave più piccola; se nessuno lo contiene, «non più presente» e si conta", () => {
  const prima = mod(tre(false), "dev:2");
  assert.deepEqual(prima.m.segmenti.map((s) => s.id), ["seg:1:1"]);
  assert.equal(prima.mappa.canonical["seg:3:1"], "seg:1:1", "l'id del terzo membro è un alias del segmento di allora");
  // Il primo router non è più sentito da nessuno: il segmento ha un altro id, e la mappa salvata prima ha tre vie di dire «il segmento».
  const dopo = mod(tre(true), "dev:2");
  assert.deepEqual(dopo.m.segmenti.map((s) => s.id), ["seg:2:1"], "il membro con la chiave più piccola è uscito: l'id è cambiato");
  const ids = new Set(dopo.mappa.nodes.map((n) => n.id));
  const r = resolveMapView({ members: ["dev:2", "seg:3:1", "seg:1:1", "seg:77:3"], roots: ["seg:3:1"], head: null, tweaks: [{ nodeId: "seg:3:1", x: 1, y: 2, sig: null, orientation: "lr" }] }, ids, dopo.mappa.canonical);
  assert.deepEqual(r.visible, ["dev:2", "seg:2:1"], "«seg:3:1» è ancora un membro del segmento: vale per il segmento di oggi, una volta sola");
  assert.deepEqual(r.missing, ["seg:1:1", "seg:77:3"], "il membro uscito e quello che nessuno ha mai avuto non ci sono più: persi, e si contano (R2)");
  assert.deepEqual(r.roots, ["seg:2:1"]);
  assert.deepEqual(r.tweaks.map((t) => t.nodeId), ["seg:2:1"], "anche il ritocco segue il segmento");
  // E sulla rete in quattro letture: il segmento della WAN ritrovato dall'id del suo secondo membro.
  const quattro = mod(letturaA(), N.R);
  assert.equal(quattro.mappa.canonical["seg:2:1"], "seg:1:5");
});

/**
 * Caso 1, l'altro verso (revisione finale di T3, M6): entra nel segmento un apparato con l'id più piccolo, e l'id del segmento
 * cambia. L'id di prima è quello di un membro che c'è ancora: una mappa salvata, una ★ e «Togli dal segmento» scritti con lui
 * valgono per il segmento di oggi.
 */
function wanCon(piccolo: boolean, over: Partial<TopologyModelInput> = {}): IngressoCavi {
  const r = (id: number) => dev(id, { name: `RTR-${id}`, device_type: "router", vendor: "mikrotik", via: "ssh" });
  const t1 = baseInput({
    devices: [dev(5, { name: "SW-5" }), r(6), r(7), ...(piccolo ? [r(2)] : [])], ports: porte(5, [[1, "Port 1", "1000 Mbps"], [15, "Port 15", "1000 Mbps"]]),
    knownMacs: [2, 6, 7].map((id) => ({ device_id: id, mac: `02:00:e7:00:0${id}:01` })), ...over,
  });
  const sente = (id: number) => vic({ device_id: 5, local_port: "Port 15", remote_device_name: `RTR-${id}`, remote_mac: `02:00:e7:00:0${id}:01`, remote_port: "ether8" });
  return ingresso(t1, { vicini: [sente(6), sente(7), ...(piccolo ? [sente(2)] : [])] });
}

test("Caso 1 · entra un apparato con l'id più piccolo: l'id del segmento cambia, e l'id di prima (mappa salvata, ★, «Togli dal segmento») vale per il segmento di oggi", () => {
  assert.deepEqual(mod(wanCon(false)).m.segmenti.map((s) => s.id), ["seg:5:15"]);
  const dopo = mod(wanCon(true));
  assert.deepEqual(dopo.m.segmenti.map((s) => s.id), ["seg:2:n-ether8"], "il membro col numero più piccolo è entrato: l'id è cambiato");
  const r = resolveMapView({ members: ["seg:5:15"], roots: ["seg:5:15"], head: null, tweaks: [] }, new Set(dopo.mappa.nodes.map((n) => n.id)), dopo.mappa.canonical);
  assert.deepEqual([r.visible, r.missing, r.roots], [["seg:2:n-ether8"], [], ["seg:2:n-ether8"]], "la mappa salvata ritrova il segmento");
  const stella = mod(wanCon(true, { primaries: [{ node_id: "seg:5:15", other_node: "dev:7", node_port: "", other_port: "" }] }));
  assert.deepEqual(stella.m.albero.stelle.map((s) => [s.nodo, s.altro]), [["seg:2:n-ether8", "dev:7"]], "la ★ salvata con l'id di prima vale per il segmento di oggi");
  const togli: LinkOverrideRow = { id: 4, action: "ignore", a_node: "dev:6", a_port: "ether8", b_node: "seg:5:15", b_port: "", medium: null, note: null, created_by: "tecnico", created_at: "2026-10-16 08:00:00" };
  const tolto = mod(wanCon(true, { overrides: [togli] }));
  assert.deepEqual(tolto.m.collegamenti.filter((c) => c.genere === "segmento").map((c) => c.a.nodo).sort(), ["dev:2", "dev:5", "dev:7"], "«Togli dal segmento» toglie RTR-6");
  assert.deepEqual(tolto.m.correzioniOrfane, [], "e non è orfana");
});

test("Caso 2 · una ★ salvata prima di T3 (senza porte, o con porte che non indicano più un collegamento) vale per il migliore della coppia e i dettagli lo dicono; una ★ su un cavo bloccato vince", () => {
  const t1 = letturaA().t1;
  const con = (primaries: TopologyModelInput["primaries"]) => mod({ ...letturaA(), t1: { ...t1, primaries } }, N.R);
  const prima = con([{ node_id: N.A1, other_node: N.C1, node_port: "", other_port: "" }]);
  const l = prima.mappa.links.find((x) => [x.a, x.b].sort().join() === [N.A1, N.C1].sort().join())!;
  assert.deepEqual([l.primary, l.primaryFor], ["user", N.A1], "la ★ di prima vale per il migliore della coppia");
  assert.deepEqual(prima.mappa.cavi.stelleDiPrima.map((s) => [s.nodo, s.altro]), [[N.A1, N.C1]], "e i dettagli lo dicono: mai persa in silenzio");
  const vecchia = con([{ node_id: N.A1, other_node: N.C1, node_port: "Port 99", other_port: "Port 98" }]);
  assert.equal(vecchia.mappa.cavi.stelleDiPrima.length, 1, "porte che non indicano più nessun collegamento: ★ di prima");
  // ★ sul cavo bloccato (CORE-2 ↔ ACC-2, porta 12, bloccato dal lato di CORE-2): vince sul percorso che inoltra (I20)
  const bloccato = con([{ node_id: N.C2, other_node: N.A2, node_port: "SFP+ 12", other_port: "SFP+ 2" }]);
  assert.equal(cavo(bloccato.m, N.C2, 12, N.A2, 50).stato, "bloccato");
  assert.equal(bloccato.m.albero.padri[N.C2], N.A2, "la ★ sul cavo bloccato vince: CORE-2 sta sotto ACC-2");
});

test("Caso 4 · un fascio con un membro ignorato o giù: la linea resta (un cavo solo, oppure «fascio di 2 cavi, 1 giù»), la velocità è la somma dei membri accesi", () => {
  const ing = letturaA();
  const normale = fra(mod(ing, N.R).m, N.R, N.C1);
  assert.deepEqual(normale.map((c) => [c.genere, c.velocitaMbps]), [["fascio", 50000]]);
  // un membro ignorato: resta un cavo solo, a 25G
  const ignora: LinkOverrideRow = { id: 4, action: "ignore", a_node: N.R, a_port: "sfp28-2", b_node: N.C1, b_port: "SFP28 2", medium: null, created_by: null, created_at: "2026-10-14 10:00:00" };
  const ignorato = fra(mod({ ...ing, t1: { ...ing.t1, overrides: [ignora] } }, N.R).m, N.R, N.C1);
  assert.deepEqual(ignorato.map((c) => [c.genere, c.velocitaMbps]), [["cavo", 25000]], "un membro ignorato: la linea resta, un cavo solo");
  // un membro giù: il fascio resta di 2 cavi, 1 giù; la velocità è dei membri accesi
  const giu = { ...ing, fattiPorta: ing.fattiPorta.map((f) => (f.device_id === ID_R && f.port_name === "sfp28-2" ? { ...f, running: 0 } : f)) };
  const giuM = fra(mod(giu, N.R).m, N.R, N.C1);
  assert.deepEqual(giuM.map((c) => [c.genere, c.stato, c.velocitaMbps]), [["fascio", "inoltra", 25000]]);
  assert.deepEqual(giuM[0].membri?.map((x) => x.stato).sort(), ["giu", "inoltra"]);
  assert.equal(mod(giu, N.R).m.albero.padri[N.C1], N.R, "il fascio con un membro giù è ancora il padre");
});
const ID_R = 1;

// ─── Una mappa passo passo con un tratto contratto (§13.7.7): lo stato della contrazione ────────────────────────────────────

test("Task 7 · una mappa passo passo con il router di testa e quello della sede 2, senza le radio: una contrazione «≋ radio» fra i due; con un tratto bloccato è «bloccato», con uno giù «giù»", () => {
  // Le contrazioni che la pagina calcola per i due oggetti visibili (quella che l'albero usa si vede in `tree.links`; col tratto giù l'albero
  // preferisce il tunnel bloccato, e la contrazione resta una ridondanza: lo stato si legge sulla contrazione).
  const vista = (ing: IngressoCavi) => contrazioni(mod(ing, N.R).mappa, new Set([N.R, N.R2S]));
  const normale = vista(letturaA());
  assert.deepEqual(normale.map((l) => [l.a, l.b, l.cavo?.stato]), [[N.R, N.R2S, "inoltra"]], "una linea fra i due router");
  const tree = computeMapView(mod(letturaA(), N.R).mappa, { auto: false, members: [N.R, N.R2S], roots: [N.R], head: null, tweaks: [], expanded: new Set(), orientation: "lr" }).tree;
  assert.equal(tree.links.some((l) => l.cavo?.genere === "contrazione"), true, "e l'albero della pagina la usa: R2S sta sotto R, una radice sola");
  assert.equal(tree.roots.length, 1);
  const bloccato = letturaA();
  bloccato.fattiPorta = bloccato.fattiPorta.map((f) => (f.device_id === 1 && f.port_name === "ether3" ? { ...f, ...discarding } : f));
  assert.deepEqual(vista(bloccato).map((l) => l.cavo?.stato), ["bloccato"], "un tratto bloccato: la contrazione è «bloccato»");
  const giu = letturaA();
  giu.fattiPorta = giu.fattiPorta.map((f) => (f.device_id === 1 && f.port_name === "ether3" ? { ...f, running: 0 } : f));
  assert.deepEqual(vista(giu).map((l) => l.cavo?.stato), ["giu"], "un tratto giù: «giù» (vince sul bloccato)");
});

// ─── Schermo = traccia, con la regola «dalle VM» accesa, su ogni rete di prova ───────────────────────────────────────────────

const padreSu = (via: ReadonlyMap<string, { a: string; b: string }>, n: string): string | null => { const l = via.get(n); return l ? (l.a === n ? l.b : l.a) : null; };

for (const accesa of [false, true]) {
  for (const [nome, crea] of RETI_CAVI) {
    test(`schermo = traccia, ${nome}, regola «dalle VM» ${accesa ? "accesa" : "spenta"}: la pagina ha la testa, i padri, le linee scelte e le radici del modello per cavo`, () => {
      const { m, mappa } = conRegolaDalleVm(crea(), accesa);
      const v = computeMapView(mappa, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
      assert.equal(v.head, m.albero.testa, "la testa");
      assert.deepEqual(Object.fromEntries(Object.keys(m.albero.padri).map((k) => [k, padreSu(v.tree.via, k)])), m.albero.padri, "i padri");
      assert.deepEqual([...v.tree.via].map(([n, l]) => [n, l.id]).sort(), [...m.albero.via].map(([n, c]) => [n, c.id]).sort(), "le linee scelte");
      assert.deepEqual(v.tree.roots, m.albero.radici, "le radici");
      // lo stesso albero se lo calcola direttamente `alberoDellaPagina` sui nodi visibili
      const visibili = new Set(v.tree.links.flatMap((l) => [l.a, l.b]));
      assert.deepEqual(padriDi(alberoDellaPagina(mappa, visibili, v.tree.roots)), padriDi(v.tree), "alberoDellaPagina e la vista dicono lo stesso");
      if (accesa) for (const d of m.soloDettagli) assert.equal(mappa.links.some((l) => l.id === d.collegamento.id), false, "un collegamento nei dettagli non è fra le linee della pagina");
    });
  }
}

// Un'altra forma della stessa invariante: i capi dei collegamenti sono nodi della pagina (nessuna linea senza il suo nodo).
test("schermo = traccia · ogni linea della pagina ha i suoi due nodi, su ogni rete di prova", () => {
  for (const [nome, crea] of RETI_CAVI) {
    const { mappa } = mod(crea());
    const ids = new Set(mappa.nodes.map((n) => n.id));
    for (const l of mappa.links) assert.ok(ids.has(l.a) && ids.has(l.b), `${nome}: ${l.id}`);
  }
});

