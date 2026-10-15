// Le letture in più nel modello di T1 e nel modello per cavo in ombra (spec topologia §13.11.3, §13.12.1-13.12.2, R7, I33).
//
// 1. «Letture spente»: il modello di T1 e l'albero della mappa automatica sulle reti-campione e sulle due fixture delle reti vere
//    sono quelli di PRIMA di T2, bit per bit. Le impronte sono calcolate sul commit che precede T2 (806319f2, «documenti: piano
//    di T2») con lo stesso `improntaT1` (support/impronta.ts, che importa solo codice di prima di T2: si copia in quel checkout
//    e si lancia con `node --import tsx`). Se una cambia: se è un cambio voluto del modello di T1 (T1b, o T3 quando una mappa
//    sarà accesa), si rigenerano sul commit nuovo e si scrive perché; se è T2, è un difetto.
// 2. «Letture accese» sulle famiglie 1 (solo MikroTik) e 2 (solo UniFi) con i fatti che T2 legge nella forma che i lettori
//    scrivono: il modello per cavo in ombra dice ciò che la mappa nuova farebbe (il fascio, le porte radice, i cavi diretti
//    instradati e certi coi MAC di MK2, la WAN del gateway, il segmento, nessuna anomalia falsa), e per farlo non tocca il
//    modello di T1: né il suo ingresso, né il suo modello, né lo stato che ricalcolandolo si vedrebbe. Che la mappa di oggi, a
//    letture accese, sia quella di prima su un DB lo prova `src/lib/__tests__/topologia-t2-freno.test.ts` (I33, R7).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { altreMarcheSnmp, conHypervisor, mista, soloMikrotik, soloUnifi } from "./support/reti-campione";
import { fb, fp, ingresso } from "./support/cavi";
import { improntaT1, serializza } from "./support/impronta";

const carica = (nome: string): TopologyModelInput => ({ macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [],
  ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) } as TopologyModelInput);

// ── 1. Letture spente: il modello di T1 è quello di prima di T2 ─────────────

/** Calcolate sul commit 806319f2 (prima di T2) e riverificate identiche sul codice di T2 il 15/10 (Task 13). */
const PRIMA_DI_T2: ReadonlyArray<readonly [string, () => TopologyModelInput, { modello: string; albero: string }]> = [
  ["famiglia 1 · solo MikroTik", soloMikrotik, { modello: "a1430e44eafe08bc34846aa9", albero: "b4fce2c5a785ebc932a8fb65" }],
  ["famiglia 2 · solo UniFi", soloUnifi, { modello: "a3fedeab2e50a7ce9adb0ea9", albero: "21361a0cfb23a9325d3a708d" }],
  ["famiglia 3 · altre marche via SNMP", altreMarcheSnmp, { modello: "929acdf8a356c7db1b5327f8", albero: "1d738e2b54770928dfcbd581" }],
  ["famiglia 4 · con hypervisor", conHypervisor, { modello: "9c498b5eab4bf65d65100708", albero: "c2077ce005844e068f43c22e" }],
  ["famiglia 5 · mista", mista, { modello: "6e9f50dfc49a1e115d416355", albero: "11c7145a629e9072978c20e4" }],
  ["fixture della rete B", () => carica("topologia-domarc.json"), { modello: "630feddad888967da2dfe948", albero: "1683b0c52e3325f302252357" }],
  ["fixture del cliente A", () => carica("topologia-cliente-a.json"), { modello: "6740b97b3216d4c675015983", albero: "4657037a9473d7fc3bc70625" }],
];

for (const [nome, rete, atteso] of PRIMA_DI_T2) {
  test(`letture spente, ${nome}: il modello di T1 e l'albero sono quelli di prima di T2, bit per bit`, () => {
    assert.deepEqual(improntaT1(rete()), atteso);
  });
}

// ── 2. Letture accese: il modello per cavo in ombra, e il modello di T1 che non si muove ─

const dev = (id: number, k: string, n: string, over: Parameters<typeof fp>[3] = {}) => fp(id, k, n, { source: "device", in_bridge: 1, ...over });
const macs = (device_id: number, l: string[]) => l.map((mac) => ({ device_id, mac, source: "device" }));
const fra = (m: ReturnType<typeof costruisciModelloCavi>, x: string, y: string) =>
  m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

/**
 * Il modello per cavo non deve toccare il modello di T1: né l'ingresso che riceve, né il modello che riceve, né quello che si
 * ricostruisce dopo da capo con gli stessi dati (stato condiviso nascosto). L'identità `ing.t1 === t1` non è la prova: la prova è
 * che tutto, prima e dopo, è lo stesso testo.
 */
function senzaToccareT1(t1: TopologyModelInput, calcola: (modello: ReturnType<typeof buildTopologyModel>) => ReturnType<typeof costruisciModelloCavi>) {
  const ingressoPrima = serializza(t1);
  const modello = buildTopologyModel(t1);
  const modelloPrima = serializza(modello);
  const m = calcola(modello);
  assert.equal(serializza(t1), ingressoPrima, "l'ingresso del modello di T1 è stato toccato dal modello per cavo (R7)");
  assert.equal(serializza(modello), modelloPrima, "il modello di T1 è stato toccato dal modello per cavo (R7)");
  assert.equal(serializza(buildTopologyModel(t1)), modelloPrima, "ricostruito dopo, il modello di T1 è un altro (stato condiviso)");
  return m;
}

test("famiglia 1, letture accese: il fascio della testa, i padri dalle porte radice, i cavi diretti instradati e certi coi MAC di MK2", () => {
  const t1 = soloMikrotik();
  const ing = ingresso(t1, {
    fattiBridge: [
      fb(3, { bridge_name: "BR_RP", bridge_id: "0.02:00:a0:00:03:00", root_id: "0.02:00:a0:00:03:00" }),
      fb(11, { bridge_name: "BR_AGG", bridge_id: "32768.02:00:a0:00:11:00", root_id: "0.02:00:a0:00:03:00", root_port: "bond1" }),
      fb(1, { bridge_name: "BR_FX", bridge_id: "32768.02:00:a0:00:01:00", root_id: "0.02:00:a0:00:03:00", root_port: "sfp-sfpplus1" }),
    ],
    fattiPorta: [
      dev(3, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }), dev(3, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }),
      dev(3, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "designated", stp_state: "forwarding", edge: 0, bpdu_rx: 10 }),
      dev(3, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
      dev(3, "n:sfp-sfpplus3", "sfp-sfpplus3", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
      dev(11, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }), dev(11, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }),
      dev(11, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "0.02:00:a0:00:03:00" }),
      dev(1, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "32768.02:00:a0:00:11:00" }),
      dev(1, "n:sfp-sfpplus2", "sfp-sfpplus2", { in_bridge: 0 }), dev(1, "n:sfp-sfpplus4", "sfp-sfpplus4", { in_bridge: 0 }),
    ],
    macApparati: [
      ...macs(3, ["02:00:A0:00:03:00", "02:00:A0:00:03:01", "02:00:A0:00:03:10", "02:00:A0:00:03:11", "02:00:A0:00:03:13", "02:00:A0:00:03:21", "02:00:A0:00:03:22", "02:00:A0:00:03:88"]),
      ...macs(11, ["02:00:A0:00:11:00", "02:00:A0:00:11:02", "02:00:A0:00:11:10", "02:00:A0:00:11:21", "02:00:A0:00:11:22"]),
      ...macs(1, ["02:00:A0:00:01:01", "02:00:A0:00:01:02", "02:00:A0:00:01:04", "02:00:A0:00:01:16", "02:00:A0:00:01:20"]),
    ],
  });
  const m = senzaToccareT1(t1, (modello) => costruisciModelloCavi(ing, modello, { testaScelta: null }));
  assert.equal(m.albero.testa, "dev:3");
  const fascio = fra(m, "dev:3", "dev:11");
  assert.deepEqual([fascio.length, fascio[0]?.genere, fascio[0]?.membri?.length], [1, "fascio", 2]);
  assert.equal(m.albero.padri["dev:11"], "dev:3", "la porta radice dell'aggregazione è il fascio");
  assert.equal(m.albero.padri["dev:1"], "dev:11", "il router di frontiera sta dove lo mette lo spanning tree (H21 in forma inventata)");
  assert.equal(m.albero.padri["dev:21"], "dev:11");
  const diretti = fra(m, "dev:1", "dev:3").filter((c) => c.genere === "cavo");
  assert.equal(diretti.length, 2);
  assert.ok(diretti.every((c) => c.stato === "instradato" && c.fiducia === "certo"), "fuori dal bridge; certi perché i MAC di MK2 abbinano le righe del router di frontiera");
  assert.deepEqual(m.albero.anomalie, []);
});

// Decisione: la WAN non porta più «le porte da verificare» (10G da un capo, 25G dall'altro, I45) — perché la prova del piano è
// precedente alla revisione del Task 11 (§13.5.3, misurato sul controller dell'hub): la porta dell'uplink del gateway (la WAN) e la
// porta remota dell'uplink (il cavo della LAN) non sono i due capi di un cavo. La WAN è la porta 10 del gateway col cavo che
// l'LLDP dà su quella porta (10G da tutti e due i lati), instradata e senza verso; il cavo della LAN è l'altro, e il gateway lo
// scrive «eth9», un nome che il suo elenco non ha. AGG sta sotto il gateway per il cavo della LAN. Le attese sono quelle di
// `cavi-albero.test.ts` («gateway vero»), qui sulla rete-campione intera.
test("famiglia 2, letture accese: il gateway attaccato per la LAN, la WAN instradata e senza verso, il segmento, nessuna anomalia dal Flex", () => {
  const t1 = soloUnifi();
  const ing = ingresso(t1, {
    uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }, { device_id: 4, uplink_local_port_idx: 1, uplink_source: "lldp_uplink" }],
    fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })],
  });
  const m = senzaToccareT1(t1, (modello) => costruisciModelloCavi(ing, modello, { testaScelta: null }));
  assert.equal(m.albero.testa, "dev:1");
  assert.equal(m.albero.padri["dev:2"], "dev:1");
  assert.notEqual(m.albero.via.get("dev:2")?.wan, true, "AGG appeso alla LAN del gateway, non alla WAN");
  const wan = fra(m, "dev:1", "dev:2").filter((c) => c.wan);
  assert.deepEqual(wan.map((c) => [c.stato, c.verso, (c.a.nodo === "dev:1" ? c.a : c.b).chiave]), [["instradato", null, "i:10"]], "la WAN: porta 10, instradata, senza verso");
  const lan = fra(m, "dev:1", "dev:2").filter((c) => !c.wan);
  assert.deepEqual(lan.map((c) => [c.genere, c.stato]), [["cavo", "inoltra"]], "il cavo della LAN è un altro, e non è la WAN");
  assert.equal(m.albero.padri["dev:4"], "dev:3");
  assert.deepEqual(m.albero.anomalie, []);
  assert.ok(m.segmenti.some((s) => s.id === "seg:3:20"), "la porta 20 dello switch da 48 è un segmento (H5 in forma inventata)");
});

// Controprova: la prova sopra vedrebbe un modello per cavo che scrive nel modello di T1.
test("controprova: un modello per cavo che toccasse l'ingresso di T1 sarebbe visto", () => {
  const t1 = soloUnifi();
  assert.throws(() => senzaToccareT1(t1, (modello) => {
    t1.neighbors.pop();
    return costruisciModelloCavi(ingresso(t1), modello, { testaScelta: null });
  }), /toccato/);
});
