// La mappa nuova (spec topologia §13.11.4, T3.1, T3.2, T3.7; §13.7.3; §13.4.6): il modello per cavo nella forma che la pagina e
// la stampa leggono. Una linea per collegamento con l'id del collegamento; il segmento come nodo, con gli alias dei suoi membri
// (Caso 1 del piano); la ★ per collegamento e le ★ di prima; isolati e «Da sistemare» sulle linee nuove; «dalle VM» nei dettagli;
// «Candidati per porta»; ogni id «seg:» accettato dalle rotte. Reti-campione con i fatti di T2 di `cavi-ombra.test.ts` e reti
// piccole inventate (righe come le scrivono i lettori).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ID_SEGMENTO } from "@/lib/topology/api-input";
import { candidatiPerPorta, modelloMappaCavi, modelloMappaDaIngresso, nomiDellaMappa } from "@/lib/topology/cavi/mappa";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import { motivoDaSistemare } from "@/lib/topology/da-sistemare";
import { computeMapView } from "@/lib/topology/map-compute";
import { redundancyCounts } from "@/lib/topology/map-screen";
import { resolveMapView } from "@/lib/topology/map-view";
import { buildTopologyModel } from "@/lib/topology/model";
import { LINK_SOURCE_RANK, type ModelCounts, type ModelVmRow, type TopologyModel, type TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";
import { altreMarcheSnmp, conHypervisor, mista, porte, riga, soloMikrotik, soloUnifi } from "./support/reti-campione";
import { fb, fp, ingresso, ORA_T2, vic } from "./support/cavi";

const mk = { vendor: "mikrotik", via: "ssh" } as const;
const uf = { vendor: "ubiquiti", via: "api" } as const;
const lan = (n: number) => ({ id: n, cidr: `10.${n}.0.0/24`, name: `rete ${n}`, gateway: `10.${n}.0.1`, location_id: null });
/** Le righe dei due capi di un cavo fra due MikroTik letti via SSH, porte col nome di fabbrica. */
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string) => [
  vic({ device_id: a, local_port: `${pa},bridge`, remote_device_name: nomeB, remote_port: `bridge/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},bridge`, remote_device_name: nomeA, remote_port: `bridge/${pa}`, source: "device", remote_platform: "MikroTik" }),
];

function mappaDi(ing: IngressoCavi, opz: { testa?: string | null; dalleVmSoloDettagli?: boolean } = {}) {
  const t1 = buildTopologyModel(ing.t1);
  const m = costruisciModelloCavi(ing, t1, { testaScelta: opz.testa ?? null, ...(opz.dalleVmSoloDettagli !== undefined ? { dalleVmSoloDettagli: opz.dalleVmSoloDettagli } : {}) });
  return { t1, m, mappa: modelloMappaCavi(t1, m, ing) };
}
const fra = (mappa: TopologyModel, x: string, y: string) => mappa.links.filter((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));

// ── Le reti-campione coi fatti di T2 (gli stessi di cavi-ombra.test.ts) ─────────────────────────────────────────────────────

const devFatto = (id: number, k: string, n: string, over: Parameters<typeof fp>[3] = {}) => fp(id, k, n, { source: "device", in_bridge: 1, ...over });
const macs = (device_id: number, l: string[]) => l.map((mac) => ({ device_id, mac, source: "device" }));
function ingMikrotik(t1: TopologyModelInput = soloMikrotik()): IngressoCavi {
  return ingresso(t1, {
    fattiBridge: [
      fb(3, { bridge_name: "BR_RP", bridge_id: "0.02:00:a0:00:03:00", root_id: "0.02:00:a0:00:03:00" }),
      fb(11, { bridge_name: "BR_AGG", bridge_id: "32768.02:00:a0:00:11:00", root_id: "0.02:00:a0:00:03:00", root_port: "bond1" }),
      fb(1, { bridge_name: "BR_FX", bridge_id: "32768.02:00:a0:00:01:00", root_id: "0.02:00:a0:00:03:00", root_port: "sfp-sfpplus1" }),
    ],
    fattiPorta: [
      devFatto(3, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }), devFatto(3, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }),
      devFatto(3, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "designated", stp_state: "forwarding", edge: 0, bpdu_rx: 10 }),
      devFatto(3, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
      devFatto(3, "n:sfp-sfpplus3", "sfp-sfpplus3", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
      devFatto(11, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }), devFatto(11, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }),
      devFatto(11, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "0.02:00:a0:00:03:00" }),
      devFatto(1, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "32768.02:00:a0:00:11:00" }),
      devFatto(1, "n:sfp-sfpplus2", "sfp-sfpplus2", { in_bridge: 0 }), devFatto(1, "n:sfp-sfpplus4", "sfp-sfpplus4", { in_bridge: 0 }),
    ],
    macApparati: [
      ...macs(3, ["02:00:A0:00:03:00", "02:00:A0:00:03:01", "02:00:A0:00:03:10", "02:00:A0:00:03:11", "02:00:A0:00:03:13", "02:00:A0:00:03:21", "02:00:A0:00:03:22", "02:00:A0:00:03:88"]),
      ...macs(11, ["02:00:A0:00:11:00", "02:00:A0:00:11:02", "02:00:A0:00:11:10", "02:00:A0:00:11:21", "02:00:A0:00:11:22"]),
      ...macs(1, ["02:00:A0:00:01:01", "02:00:A0:00:01:02", "02:00:A0:00:01:04", "02:00:A0:00:01:16", "02:00:A0:00:01:20"]),
    ],
  });
}
const ingUnifi = (): IngressoCavi => ingresso(soloUnifi(), {
  uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }, { device_id: 4, uplink_local_port_idx: 1, uplink_source: "lldp_uplink" }],
  fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })],
});
const RETI: ReadonlyArray<readonly [string, () => IngressoCavi]> = [
  ["famiglia 1 · solo MikroTik", () => ingMikrotik()], ["famiglia 2 · solo UniFi", ingUnifi], ["famiglia 5 · mista", () => ingresso(mista())],
];

/**
 * La sede della WAN in forma inventata (S10, come «I49 e I50» di cavi-albero.test.ts): la WAN di RTR-1 (ether8, fuori dal bridge),
 * la porta 8 di SW-2 e la ether8 del router di riserva sentono un segmento con un modem non censito. RTR-1 sta nella sede 1, gli
 * altri nella sede 2. Il router di riserva ha un host fuso per MAC (host:90), che fa da alias della testa.
 */
const reteWan = (over: Partial<TopologyModelInput> = {}) => baseInput({
  devices: [dev(1, { name: "RTR-1", device_type: "router", location_id: 1, ...mk }), dev(2, { name: "SW-2", location_id: 2, ...mk }),
    dev(9, { name: "RTR-RIS", device_type: "router", location_id: 2, ...mk }), dev(5, { name: "SW-5", location_id: 2, ...mk })],
  hosts: [host(90, { ip: "10.1.0.90", mac: "02:00:e9:00:09:01", hostname: "ris-secondo-indirizzo", classification: "router" })],
  knownMacs: [{ device_id: 9, mac: "02:00:e9:00:09:01" }],
  locations: [{ id: 1, name: "sede 1", parent_id: null, head_device_id: null }, { id: 2, name: "sede 2", parent_id: null, head_device_id: null }],
  networks: [lan(1)],
  neighbors: [
    ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"),
    vic({ device_id: 1, local_port: "ether8", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether8", remote_device_name: "MODEM", remote_port: "eth0", source: "device", remote_mac: "02:00:00:00:77:01" }),
    vic({ device_id: 2, local_port: "ether8,bridge", remote_device_name: "RTR-1", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 2, local_port: "ether8,bridge", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
    ...cavo(2, "ether5", 5, "ether5", "SW-5", "SW-2"), ...cavo(5, "ether6", 9, "ether6", "RTR-RIS", "SW-5"),
  ],
  ports: [...porte(1, [[1, "ether1", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [5, "ether5", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]),
    ...porte(9, [[6, "ether6", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(5, [[5, "ether5", "1000 Mbps"], [6, "ether6", "1000 Mbps"]])],
  ...over,
});
const SEG = "seg:1:8";

// ── T3.1: una linea per collegamento ─────────────────────────────────────────────────────────────────────────────────────

for (const [nome, rete] of RETI) {
  test(`T3.1, ${nome}: una linea per collegamento, con l'id del collegamento e il suo cavo; le fonti di oggi solo per compatibilità`, () => {
    const { m, mappa } = mappaDi(rete());
    assert.ok(m.collegamenti.length > 0);
    assert.equal(mappa.links.length, m.collegamenti.length);
    assert.deepEqual(mappa.links.map((l) => l.id), m.collegamenti.map((c) => c.id).sort());
    const perId = new Map(m.collegamenti.map((c) => [c.id, c]));
    for (const l of mappa.links) {
      const c = perId.get(l.id)!;
      assert.deepEqual([l.a, l.b, l.cavo?.genere, l.cavo?.stato, l.cavo?.fiducia], [c.a.nodo, c.b.nodo, c.genere, c.stato, c.fiducia], l.id);
      assert.deepEqual(l.cavo?.frasi, c.frasi);
      assert.deepEqual(l.cavo?.detti, [...new Set(c.prove.map((p) => p.detto))]);
      assert.ok(l.sources.length > 0 && l.source === l.sources[0], l.id);
      assert.deepEqual(l.sources, [...l.sources].sort((x, y) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || (x < y ? -1 : 1)));
      assert.equal(new Set(l.sources).size, l.sources.length, "senza doppi");
      assert.deepEqual([l.redundant, l.altriCavi, l.perche], [false, undefined, undefined], "una linea è un cavo: niente «altri cavi» né «perché» di T1");
      assert.equal(l.stale, c.nonVisto);
      assert.equal(l.uplinkFrom, c.verso);
      assert.equal(l.speedMbps, c.velocitaMbps);
    }
    // I nodi: quelli del modello di oggi più i segmenti, in ordine di id; i conteggi con le chiavi di ModelCounts.
    const ids = mappa.nodes.map((n) => n.id);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(mappa.nodes.filter((n) => n.kind !== "segmento").length, buildTopologyModel(rete().t1).nodes.length);
    const chiavi: Array<keyof ModelCounts> = ["nodes", "devices", "links", "linksBySource", "deviceLinks", "attachedLinks", "staleLinks", "unmatchedNeighbors",
      "isolatedDevices", "fusedHosts", "mergedHosts", "devicesWithoutSite", "sitesWithHead", "promoteProposals", "suspiciousTypes", "vms", "hypervisors", "vmsOnNodes", "senzaProve"];
    assert.deepEqual(Object.keys(mappa.counts).sort(), [...chiavi].sort());
    assert.equal(mappa.counts.links, mappa.links.length);
    assert.equal(mappa.counts.nodes, mappa.nodes.length);
  });
}

test("T3.1 (ADR 0012 M-2, §13.7.2 passo 11): due cavi fra gli stessi apparati sono due linee; quello che l'albero non usa conta nel «⇄ N»", () => {
  const ing = ingresso(baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(2, "ether3", 3, "ether3", "SW-3", "SW-2")],
    ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "10000 Mbps"], [3, "ether3", "1000 Mbps"]]),
      ...porte(3, [[2, "ether2", "10000 Mbps"], [3, "ether3", "1000 Mbps"]])],
    networks: [lan(1)],
  }));
  const { t1, mappa } = mappaDi(ing);
  assert.equal(fra(t1, "dev:2", "dev:3").length, 1, "in T1 una linea per coppia");
  assert.equal(fra(mappa, "dev:2", "dev:3").length, 2, "con la mappa nuova una linea per cavo");
  const vista = (model: TopologyModel) => computeMapView(model, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  assert.equal(redundancyCounts(vista(t1).tree.links).get("dev:3") ?? 0, 0, "in T1 il secondo cavo stava fra gli «Altri cavi visti» e non contava");
  const v = vista(mappa);
  const due = v.tree.links.filter((l) => (l.a === "dev:2" && l.b === "dev:3") || (l.a === "dev:3" && l.b === "dev:2"));
  assert.deepEqual(due.map((l) => l.redundant).sort(), [false, true], "uno è il principale, l'altro una ridondanza");
  assert.equal(redundancyCounts(v.tree.links).get("dev:3"), 1, "«⇄ 1»: conta i collegamenti");
});

test("T3.1: i membri di un fascio sono orientati come la linea, anche se un membro è stato letto dall'altro capo", () => {
  const avanti = (d: number, k: string, n: string) => fp(d, k, n, { source: "device", stp_state: "forwarding", stp_role: "designated" });
  const ing = ingresso(baseInput({
    devices: [dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    ports: [...porte(2, [[2, "ether2", "10000 Mbps"], [3, "ether3", "10000 Mbps"]]), ...porte(3, [[12, "ether12", "10000 Mbps"], [13, "ether13", "10000 Mbps"]])],
  }), {
    vicini: [
      vic({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "SW-3", remote_port: "bridge/ether12", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 3, local_port: "ether13,bridge", remote_device_name: "SW-2", remote_port: "bridge/ether3", source: "device", remote_platform: "MikroTik" }),
    ],
    fattiPorta: [avanti(2, "i:2", "ether2"), avanti(2, "i:3", "ether3"), avanti(3, "i:12", "ether12"), avanti(3, "i:13", "ether13")],
  });
  const { mappa } = mappaDi(ing);
  const l = mappa.links.find((x) => x.cavo?.genere === "fascio");
  assert.ok(l?.cavo?.fascio, "il fascio dedotto c'è");
  const porteDi = (nodo: string) => (nodo === "dev:2" ? ["ether2", "ether3"] : ["ether12", "ether13"]);
  for (const x of l.cavo.fascio.membri) {
    assert.ok(porteDi(l.a).includes(x.aPort) && porteDi(l.b).includes(x.bPort), `${x.aPort} ↔ ${x.bPort} su ${l.a} ↔ ${l.b}`);
  }
  assert.equal(l.cavo.fascio.dedotto, true);
});

test("T3.1: i campi di T1 della linea — a mano, tipo, PoE, età; il partner LACP vale «lldp» (Scelte, 2); il ponte radio è senza fili", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk }),
      dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }), dev(8, { name: "RADIO-LONTANA", device_type: "access_point", ...mk })],
    neighbors: cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"),
    ports: [...porte(1, [[1, "ether1", "1000 Mbps"], [3, "ether3", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [4, "ether4", "1000 Mbps"]]), ...porte(3, [[4, "ether4", "1000 Mbps"]])],
    portInfo: [{ device_id: 2, port_name: "ether1", speed: "1000 Mbps", poe_status: "on", poe_power_mw: 15400 }],
    overrides: [{ id: 1, action: "add", a_node: "dev:2", a_port: "ether4", b_node: "dev:3", b_port: "ether4", medium: "fibra" }],
    networks: [lan(1)],
  });
  const { mappa } = mappaDi(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ] }));
  const [c12] = fra(mappa, "dev:1", "dev:2");
  assert.deepEqual([c12.source, c12.sources, c12.manual, c12.medium, c12.poeW, c12.lastSeen, c12.daysUnseen, c12.stale],
    ["lldp", ["lldp"], null, null, 15.4, ORA_T2, 0, false]);
  const [aMano] = fra(mappa, "dev:2", "dev:3");
  assert.deepEqual([aMano.source, aMano.sources, aMano.manual, aMano.medium, aMano.daysUnseen, aMano.stale, aMano.cavo?.fiducia],
    ["manual", ["manual"], { confirmed: false }, "fibra", null, false, "a_mano"]);
  const [radio] = fra(mappa, "dev:7", "dev:8");
  assert.deepEqual([radio.cavo?.genere, radio.medium], ["radio", "wireless"]);
  // Il fascio della testa (famiglia 1): partner LACP e LLDP, una fonte sola di oggi; le parole nuove stanno in `cavo.detti`.
  const fascio = mappaDi(ingMikrotik()).mappa.links.find((l) => l.cavo?.genere === "fascio")!;
  assert.deepEqual(fascio.sources, ["lldp"]);
  assert.ok(fascio.cavo?.detti.includes("partner LACP"), fascio.cavo?.detti.join(", "));
});

// ── T3.2: il segmento come nodo, e i suoi alias (Caso 1) ─────────────────────────────────────────────────────────────────

test("T3.2: il segmento è un nodo nella sede del suo primo membro gestito; le linee «membro ↔ segmento» hanno la porta del segmento vuota", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), { testa: "dev:1" });
  const n = mappa.nodes.find((x) => x.id === SEG);
  assert.deepEqual(n, { id: SEG, kind: "segmento", refId: 0, name: "segmento", type: "segmento", mgmtIp: null, fusedHostIds: [], addresses: [], aliases: [],
    siteId: 1, rackId: null, siteProposed: true, hidden: false, vendor: null });
  assert.equal(mappa.classiMappa?.[SEG], "infra", "il segmento fa da ponte nella mappa automatica");
  assert.ok(mappa.sites.find((s) => s.locationId === 1)?.nodeIds.includes(SEG), "sta fra i nodi della sede di RTR-1");
  assert.ok(!mappa.sites.find((s) => s.locationId === 2)?.nodeIds.includes(SEG));
  const membri = mappa.links.filter((l) => l.b === SEG);
  assert.deepEqual(membri.map((l) => l.a).sort(), ["dev:1", "dev:2", "dev:9"]);
  assert.ok(membri.every((l) => l.bPort === "" && l.cavo?.genere === "segmento"));
  assert.deepEqual(mappa.links.filter((l) => l.a === SEG), [], "il segmento sta sempre sul capo b");
  const s = mappa.cavi.segmenti.find((x) => x.id === SEG);
  assert.deepEqual(s?.membri.map((x) => `${x.nodo} ${x.porta}`).sort(), ["dev:1 ether8", "dev:2 ether8", "dev:9 ether8"]);
  assert.equal(s?.altriApparati, 1, "il modem non censito: «+1»");
  assert.ok(!mappa.isolated.includes(SEG) && !(mappa.daSistemare ?? []).some((d) => d.id === SEG));
});

test("Caso 1 (§13.7.3, §13.13.3 punto 4): l'id di ogni membro gestito è un alias del segmento; una mappa salvata lo ritrova, un id che nessun segmento contiene è perso", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), { testa: "dev:1" });
  assert.equal(mappa.canonical["seg:2:8"], SEG);
  assert.equal(mappa.canonical["seg:9:8"], SEG);
  assert.equal(mappa.canonical[SEG], undefined, "solo gli alias diversi dall'id");
  const ids = new Set(mappa.nodes.map((n) => n.id));
  const r = resolveMapView({ members: ["dev:1", "seg:9:8", "seg:77:3"], roots: ["seg:2:8"], head: null,
    tweaks: [{ nodeId: "seg:9:8", x: 10, y: 20, sig: null, orientation: "lr" }] }, ids, mappa.canonical);
  assert.deepEqual(r.visible, ["dev:1", SEG]);
  assert.deepEqual(r.missing, ["seg:77:3"], "nessun segmento contiene quel membro: perso, e si conta (R2)");
  assert.deepEqual(r.roots, [SEG]);
  assert.deepEqual(r.tweaks.map((t) => t.nodeId), [SEG]);
  assert.deepEqual(r.renames.sort((x, y) => (x.from < y.from ? -1 : 1)), [{ from: "seg:2:8", to: SEG }, { from: "seg:9:8", to: SEG }]);
});

// ── La ★ per collegamento ────────────────────────────────────────────────────────────────────────────────────────────────

test("★ per collegamento (§13.9): «user» sulla linea della ★; le ★ di prima e quelle fra due oggetti senza collegamento nei dettagli", () => {
  const ing = ingresso(baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(2, "ether3", 3, "ether3", "SW-3", "SW-2")],
    ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "10000 Mbps"], [3, "ether3", "1000 Mbps"]]),
      ...porte(3, [[2, "ether2", "10000 Mbps"], [3, "ether3", "1000 Mbps"]])],
    networks: [lan(1)],
    primaries: [
      { node_id: "dev:3", other_node: "dev:2", node_port: "ether3", other_port: "ether3" },   // il cavo lento, con le sue porte
      { node_id: "dev:2", other_node: "dev:1", node_port: "ether9", other_port: "ether9" },   // porte che non indicano più un cavo: di prima
      { node_id: "dev:1", other_node: "dev:3", node_port: "", other_port: "" },               // fra due oggetti senza collegamento
    ],
  }));
  const { m, mappa } = mappaDi(ing);
  const lento = fra(mappa, "dev:2", "dev:3").find((l) => l.aPort === "ether3" || l.bPort === "ether3")!;
  const veloce = fra(mappa, "dev:2", "dev:3").find((l) => l.id !== lento.id)!;
  assert.deepEqual([lento.primary, lento.primaryFor], ["user", "dev:3"]);
  assert.deepEqual([veloce.primary, veloce.primaryFor], [null, null]);
  const [r12] = fra(mappa, "dev:1", "dev:2");
  assert.deepEqual([r12.primary, r12.primaryFor], ["user", "dev:2"], "la ★ di prima vale per il migliore della coppia");
  assert.ok(m.albero.stelle.some((s) => !s.diPrima), "c'è anche una ★ che non è di prima");
  assert.deepEqual(mappa.cavi.stelleDiPrima, [
    { nodo: "dev:1", altro: "dev:3", linea: "" },
    { nodo: "dev:2", altro: "dev:1", linea: r12.id },
  ]);
});

// ── Isolati, «Da sistemare», ruoli, «dalle VM» ───────────────────────────────────────────────────────────────────────────

test("C16: un apparato con solo un ponte radio non è isolato; una VM non entra mai negli isolati; «Da sistemare» dalle classi del modello per cavo", () => {
  const radio = mappaDi(ingresso(baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }),
    dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }), dev(8, { name: "RADIO-LONTANA", device_type: "access_point", ...mk })] }), { vicini: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ] }));
  assert.ok(radio.t1.isolated.includes("dev:8"), "in T1 la radio lontana non ha collegamenti");
  assert.deepEqual(fra(radio.mappa, "dev:7", "dev:8").map((l) => l.cavo?.genere), ["radio"]);
  assert.ok(!radio.mappa.isolated.includes("dev:8"), "il ponte radio conta come collegamento");
  assert.equal(radio.mappa.counts.isolatedDevices, radio.mappa.isolated.filter((id) => id.startsWith("dev:")).length);

  // Famiglia 1: il router virtuale (dev:51) è una VM accesa del suo hypervisor: nessuna linea, e nessun «isolato».
  const vm = mappaDi(ingMikrotik()).mappa;
  assert.ok(vm.vms.some((v) => v.nodeId === "dev:51"));
  assert.deepEqual(vm.links.filter((l) => l.a === "dev:51" || l.b === "dev:51").map((l) => l.id), [], "la VM sta dentro: nessuna linea");
  assert.ok(!vm.isolated.includes("dev:51"), "una VM non è mai isolata");

  for (const [nome, rete] of RETI) {
    const { mappa } = mappaDi(rete());
    const attesi = mappa.nodes.filter((n) => !n.hidden && mappa.classiMappa?.[n.id] === "da_sistemare").map((n) => ({ id: n.id, motivo: motivoDaSistemare(n) }));
    assert.deepEqual(mappa.daSistemare, attesi, nome);
    assert.equal(mappa.counts.senzaProve, attesi.length, nome);
    assert.ok(!mappa.isolated.some((id) => id.startsWith("seg:")), nome);
  }
});

test("Task 10: con la mappa nuova il ruolo di un apparato è «core» o «accesso» quando è scritto così", () => {
  const t1 = soloMikrotik();
  t1.devices = t1.devices.map((d) => (d.id === 11 ? { ...d, topology_role: "core" } : d.id === 21 ? { ...d, topology_role: "accesso" } : d));
  const { t1: oggi, mappa } = mappaDi(ingMikrotik(t1));
  const ruolo = (model: TopologyModel, id: string) => model.nodes.find((n) => n.id === id)?.ruolo;
  assert.deepEqual([ruolo(oggi, "dev:11"), ruolo(oggi, "dev:21")], ["rete", "rete"], "il modello di T1 li legge «rete»");
  assert.deepEqual([ruolo(mappa, "dev:11"), ruolo(mappa, "dev:21"), ruolo(mappa, "dev:3")], ["core", "accesso", undefined]);
});

const vmRow = (scannedDeviceId: number, vmid: number, name: string, node: string, macs: string[]): ModelVmRow =>
  ({ scannedDeviceId, vmid, name, node, status: "running", type: "qemu", macs, ips: [], scannedAt: "2026-10-13T06:00:00.000Z" });
/** La famiglia 4 con un accesso in più dove si vedono solo le VM di pve-1 (come «S11 e I56» di cavi-collegamenti.test.ts). */
function conHypervisorEAltri(): TopologyModelInput {
  const t1 = conHypervisor();
  t1.devices.push(dev(4, { name: "ACC-H2", host: "10.4.0.4", ...uf }),
    dev(43, { name: "pve-3", device_type: "server", vendor: "proxmox", host: "10.4.0.43", proxmox_scan: 1, port_count: 0 }));
  t1.ports = [...(t1.ports ?? []), ...porte(4, [[5, "Port 5", "1000 Mbps"], [25, "SFP+ 1", "10000 Mbps"]]), ...porte(3, [[4, "Port 4", "1000 Mbps"]]), ...porte(2, [[4, "SFP+ 4", "10000 Mbps"]])];
  t1.knownMacs.push({ device_id: 4, mac: "02:00:f4:00:04:00" });
  t1.neighbors.push(
    riga({ device_id: 2, local_port: "SFP+ 4", remote_device_name: "ACC-H2", remote_mac: "02:00:f4:00:04:00", remote_port: "SFP+ 1", source: "unifi", timestamp: "2026-10-13 03:00:00" }),
    riga({ device_id: 4, local_port: "SFP+ 1", remote_device_name: "CORE-H", remote_mac: "02:00:f4:00:02:00", remote_port: "SFP+ 4", source: "unifi", timestamp: "2026-10-13 03:00:00" }),
  );
  t1.macPorts.push({ device_id: 4, mac: "02:00:f4:01:04:01", port_name: "Port 5", timestamp: "2026-10-13 03:00:00", source: "unifi" },
    { device_id: 3, mac: "02:00:f4:03:01:01", port_name: "Port 4", timestamp: "2026-10-13 03:00:00", source: "unifi" });
  t1.vms.push(vmRow(41, 104, "srv-x", "pve-1", ["02:00:f4:01:04:01"]), vmRow(43, 301, "srv-solo", "pve-3", ["02:00:f4:03:01:01"]));
  t1.scanHosts.push({ scannedDeviceId: 43, hostname: "pve-3", ips: ["10.4.0.43"], macs: ["02:00:f4:00:43:01"], scannedAt: "2026-10-13T06:00:00.000Z" });
  return t1;
}

test("§13.7.2 passo 10 (S11): i collegamenti «dalle VM» che non si disegnano stanno nei dettagli dell'hypervisor, con l'altro capo, la porta e le VM", () => {
  const { m, mappa } = mappaDi(ingresso(conHypervisorEAltri()), { dalleVmSoloDettagli: true });
  assert.equal(m.soloDettagli.length, 1);
  assert.deepEqual(mappa.cavi.dalleVm, { "dev:41": [{ altro: "dev:4", porta: "Port 5", vm: 1 }] });
  assert.deepEqual(fra(mappa, "dev:4", "dev:41"), [], "quella linea non c'è, nemmeno a richiesta");
  assert.deepEqual(mappaDi(ingresso(conHypervisorEAltri()), { dalleVmSoloDettagli: false }).mappa.cavi.dalleVm, {}, "con la regola spenta (oggi) niente nei dettagli");
});

// ── «Candidati per porta» (§13.4.6) ──────────────────────────────────────────────────────────────────────────────────────

/** Le righe che solo il modello per cavo legge, su RTR-1: un annuncio di rete sulla LAN, un nome scelto, una VLAN. */
const sentitoDaRtr1 = [
  vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: "SW-5", remote_port: "bridge", protocol: "mndp", source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: 1, local_port: "PONTE-A", remote_device_name: "SW-5", remote_port: "ether5", source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: 1, local_port: "vlan20", remote_device_name: "SW-5", remote_port: "vlan20", source: "device", remote_platform: "MikroTik" }),
];

test("§13.4.6 Candidati per porta: la WAN con le prove dei membri e il segmento scelto; MNDP, nome scelto e VLAN scartati col motivo", () => {
  const { m, mappa } = mappaDi(ingresso(reteWan(), { vicini: sentitoDaRtr1 }), { testa: "dev:1" });
  const nomeDi = nomiDellaMappa(mappa);
  const { righe, altri } = candidatiPerPorta(m, "dev:1", nomeDi);
  assert.deepEqual(righe.map((r) => r.porta), ["ether1", "ether8", "PONTE-A", "vlan20"]);
  assert.equal(altri, 0);
  const [lan1, wan, scelto, vlan] = righe;

  const segLinea = mappa.links.find((l) => l.a === "dev:1" && l.b === SEG)!;
  assert.deepEqual(wan.scelto, { linea: segLinea.id, verso: nomeDi(SEG), genere: "segmento" });
  assert.match(nomeDi(SEG), /^segmento con /, "il segmento si nomina coi suoi membri");
  const chi = wan.prove.map((p) => p.chi);
  assert.ok(chi.includes("RTR-RIS") && chi.includes("SW-2"), chi.join(", "));
  assert.ok(chi.some((x) => x.endsWith("(non censito)")), "anche il modem non censito che la porta sente");
  assert.ok(wan.prove.every((p) => p.detto === "LLDP" && p.quando === ORA_T2));
  assert.deepEqual(wan.scartati, []);

  assert.deepEqual(lan1.scelto, { linea: fra(mappa, "dev:1", "dev:2")[0].id, verso: "SW-2", genere: "cavo" });
  assert.deepEqual(lan1.prove.map((p) => p.chi).sort(), ["SW-2", "SW-2", "SW-5"], "i due capi del cavo e l'annuncio di rete");
  assert.deepEqual(lan1.scartati, [{ chi: "SW-5", motivo: "sentito solo con un annuncio di rete: stessa rete" }]);
  assert.deepEqual([scelto.scelto, scelto.scartati], [null, [{ chi: "SW-5", motivo: "nome scelto: non si sa se è una porta fisica" }]]);
  assert.deepEqual([vlan.scelto, vlan.scartati], [null, [{ chi: "SW-5", motivo: "sentito da un'interfaccia logica (VLAN, VRRP, bridge): stessa rete" }]]);

  // Il limite: le prime N porte in ordine, e quante restano fuori.
  const due = candidatiPerPorta(m, "dev:1", nomeDi, 2);
  assert.deepEqual([due.righe.map((r) => r.porta), due.altri], [["ether1", "ether8"], 2]);
  assert.deepEqual(candidatiPerPorta(m, "dev:404", nomeDi), { righe: [], altri: 0 }, "un oggetto senza prove: nessuna riga");
  assert.ok(righe.every((r) => r.altreProve === 0 && r.altriScartati === 0));
});

test("§13.4.6 Candidati per porta (revisione del Task 6): dentro una riga al massimo 16 prove e 16 scartati, con quanti restano fuori", () => {
  const altri = Array.from({ length: 20 }, (_, i) => 101 + i);
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), ...altri.map((id) => dev(id, { name: `SW-RETE-${id}`, ...mk }))],
    knownMacs: altri.map((id) => ({ device_id: id, mac: `02:00:eb:00:${String(id - 100).padStart(2, "0")}:00` })),
    ports: porte(1, [[2, "ether2", "1000 Mbps"]]),
  });
  // Sulla LAN il router sente venti apparati con un annuncio di rete: venti prove, venti scartati.
  const ing = ingresso(t1, { vicini: altri.map((id) => vic({ device_id: 1, local_port: "ether2,bridge", remote_device_name: `SW-RETE-${id}`,
    remote_mac: `02:00:eb:00:${String(id - 100).padStart(2, "0")}:00`, remote_port: "bridge", protocol: "mndp", source: "device", remote_platform: "MikroTik" })) });
  const { m, mappa } = mappaDi(ing);
  const r = candidatiPerPorta(m, "dev:1", nomiDellaMappa(mappa)).righe.find((x) => x.porta === "ether2")!;
  assert.deepEqual([r.prove.length, r.altreProve, r.scartati.length, r.altriScartati], [16, 4, 16, 4]);
});

test("un collegamento senza prove è un difetto del modello: la mappa cade col numero, senza id né nomi di porta (revisione del Task 6)", () => {
  const ing = ingresso(reteWan());
  const t1 = buildTopologyModel(ing.t1);
  const m = costruisciModelloCavi(ing, t1, { testaScelta: null });
  const rotto = (n: number) => ({ ...m, collegamenti: m.collegamenti.map((c, i) => (i < n ? { ...c, prove: [] } : c)) });
  assert.throws(() => modelloMappaCavi(t1, rotto(1), ing), (e: unknown) => e instanceof Error && e.message === "1 collegamento senza prove");
  assert.throws(() => modelloMappaCavi(t1, rotto(2), ing), (e: unknown) => e instanceof Error && e.message === "2 collegamenti senza prove");
});

/** Bordo per porta (come «I9» di cavi-collegamenti.test.ts): sulla porta 5 il cavo verso SW-3 letto solo via SNMP, e la tabella MAC vi vede SRV-11. */
test("§13.4.6 Candidati per porta: la porta di bordo scartata dice il motivo del bordo per porta (§13.7.2 passo 10)", () => {
  const t1 = baseInput({
    devices: [dev(2, { name: "SW-2", controller_mac: "02:00:e3:00:02:00" }), dev(3, { name: "SW-3" }), dev(11, { name: "SRV-11", device_type: "server" })],
    ports: porte(2, [[5, "Port 5", "1000 Mbps"], [6, "Port 6", "1000 Mbps"]]),
    knownMacs: [{ device_id: 3, mac: "02:00:e3:00:03:00" }, { device_id: 11, mac: "02:00:e3:00:11:01" }],
    macPorts: [{ device_id: 2, mac: "02:00:e3:00:11:01", port_name: "Port 5", timestamp: ORA_T2, source: "unifi" }],
  });
  const { m, mappa } = mappaDi(ingresso(t1, { vicini: [
    vic({ device_id: 2, local_port: "Port 5", local_port_index: 5, remote_device_name: "SW-3", remote_mac: "02:00:e3:00:03:00", remote_port: "Port 1", source: "snmp" }),
  ] }));
  const r = candidatiPerPorta(m, "dev:2", nomiDellaMappa(mappa)).righe.find((x) => x.porta === "Port 5")!;
  assert.deepEqual([r.scelto?.verso, r.scelto?.genere], ["SW-3", "cavo"]);
  assert.deepEqual(r.scartati, [{ chi: "SRV-11", motivo: "la porta è il capo di un cavo verso un altro oggetto: non è di bordo" }]);
  assert.ok(r.prove.some((p) => p.chi === "SRV-11" && p.detto === "tabella MAC"));
});

test("§13.4.6 Candidati per porta: oltre una radio non letta due apparati di rete — il salto non è letto, nessun collegamento", () => {
  const sentito = (nome: string, mac: string) => vic({ device_id: 1, local_port: "ether3", remote_device_name: nome, remote_mac: mac, remote_port: "ether1", protocol: "mndp", source: "device", remote_platform: "MikroTik" });
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-SEDE1", device_type: "router", ...mk }), dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }),
      dev(5, { name: "RTR-SEDE2", device_type: "router", ...mk }), dev(6, { name: "RTR-SEDE3", device_type: "router", ...mk }), dev(9, { name: "SW-SEDE2", ...mk })],
    knownMacs: [{ device_id: 7, mac: "02:00:e1:00:07:01" }, { device_id: 5, mac: "02:00:e1:00:05:01" }, { device_id: 6, mac: "02:00:e1:00:06:01" }],
    neighbors: [
      vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_mac: "02:00:e1:00:07:01", remote_port: "ether1", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 5, local_port: "ether2", remote_device_name: "SW-SEDE2", remote_port: "ether1", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 6, local_port: "ether2", remote_device_name: "SW-SEDE2", remote_port: "ether2", source: "device", remote_platform: "MikroTik" }),
      sentito("RTR-SEDE2", "02:00:e1:00:05:01"), sentito("RTR-SEDE3", "02:00:e1:00:06:01"),
    ],
  });
  const { m, mappa } = mappaDi(ingresso(t1));
  assert.equal(m.oltre.length, 1, "la regola «oltre» ha scartato i due router");
  const r = candidatiPerPorta(m, "dev:1", nomiDellaMappa(mappa)).righe.find((x) => x.porta === "ether3")!;
  assert.deepEqual([r.scelto?.verso, r.scelto?.genere], ["RADIO-VICINA", "cavo"]);
  assert.deepEqual(r.scartati, [
    { chi: "RTR-SEDE2", motivo: "Oltre RADIO-VICINA ci sono 2 apparati di rete: il salto non è letto" },
    { chi: "RTR-SEDE3", motivo: "Oltre RADIO-VICINA ci sono 2 apparati di rete: il salto non è letto" },
  ], "il motivo più preciso, una volta per apparato");
});

// ── Gli id «seg:» passano le rotte (revisione del Task 8) ────────────────────────────────────────────────────────────────

/** Ogni stringa (valore o chiave) della mappa che è un id di segmento. */
function idSegmento(x: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof x === "string") { if (x.startsWith("seg:")) out.add(x); }
  else if (Array.isArray(x)) for (const y of x) idSegmento(y, out);
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k.startsWith("seg:")) out.add(k); idSegmento(v, out); }
  return out;
}
const carica = (nome: string): TopologyModelInput => ({ macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [],
  ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) } as TopologyModelInput);

test("revisione del Task 8: ogni id «seg:» della mappa (nodi, linee, alias, sedi, dettagli) passa ID_SEGMENTO delle rotte, sulle reti-campione e sulle fixture", () => {
  const reti: Array<[string, IngressoCavi]> = [
    ...RETI.map(([n, r]) => [n, r()] as [string, IngressoCavi]), ["famiglia 3", ingresso(altreMarcheSnmp())], ["famiglia 4", ingresso(conHypervisor())],
    ["WAN", ingresso(reteWan())], ["rete B", ingresso(carica("topologia-domarc.json"))], ["cliente A", ingresso(carica("topologia-cliente-a.json"))],
  ];
  let visti = 0;
  for (const [nome, ing] of reti) {
    const ids = idSegmento(mappaDi(ing).mappa);
    visti += ids.size;
    for (const id of ids) assert.match(id, ID_SEGMENTO, `${nome}: ${id}`);
  }
  assert.ok(visti > 0, "almeno un segmento c'è");
});

test("revisione del Task 8: un nome di porta lungo (apparato senza elenco) dà un id «seg:» entro i limiti delle rotte; due nomi lunghi con lo stesso inizio restano due segmenti", () => {
  const lungo = (coda: string) => `porta-col-nome-scelto-dal-cliente-molto-lungo/${"x".repeat(70)}-${coda}`;
  const sente = (porta: string, nome: string, mac: string) => vic({ device_id: 2, local_port: porta, remote_device_name: nome, remote_mac: mac, remote_port: "Port 1", source: "device" });
  const nodi = [3, 4, 5, 6].map((id) => dev(id, { name: `SW-LUNGO-${id}` }));
  const t1 = baseInput({
    devices: [dev(2, { name: "SW-SENZA-ELENCO" }), ...nodi],
    knownMacs: [3, 4, 5, 6].map((id) => ({ device_id: id, mac: `02:00:ea:00:0${id}:00` })),
    ports: [3, 4, 5, 6].flatMap((id) => porte(id, [[1, "Port 1", "1000 Mbps"]])),
  });
  const ing = ingresso(t1, {
    vicini: [sente(lungo("a"), "SW-LUNGO-3", "02:00:ea:00:03:00"), sente(lungo("a"), "SW-LUNGO-4", "02:00:ea:00:04:00"),
      sente(lungo("b"), "SW-LUNGO-5", "02:00:ea:00:05:00"), sente(lungo("b"), "SW-LUNGO-6", "02:00:ea:00:06:00")],
    fattiPorta: [fp(2, `n:${lungo("a")}`, lungo("a"), { source: "device" }), fp(2, `n:${lungo("b")}`, lungo("b"), { source: "device" })],
  });
  const { m, mappa } = mappaDi(ing);
  const segs = m.segmenti.map((s) => s.id);
  assert.equal(segs.length, 2, segs.join(" | "));
  assert.ok(encodeURIComponent(lungo("a")).length > 90, "il nome codificato supera il limite delle rotte");
  assert.notEqual(segs[0], segs[1]);
  for (const id of idSegmento(mappa)) {
    assert.match(id, ID_SEGMENTO, id);
    assert.ok(id.length <= 120, `${id.length} caratteri`);
  }
  // L'alias del membro col nome lungo è l'id stesso del segmento: la stessa forma accorciata.
  for (const s of m.segmenti) assert.ok(s.id.startsWith("seg:2:n-"), s.id);
  // Valori fissati (revisione del Task 6): se cambia l'accorciamento o l'impronta, gli id salvati nelle mappe (membri, partenze,
  // ritocchi, «Togli dal segmento», ★) non trovano più il loro segmento, in silenzio. Cambiarli vuol dire una conversione.
  const testa = "seg:2:n-porta-col-nome-scelto-dal-cliente-molto-lungo%2Fxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  assert.deepEqual(segs, [`${testa}~93714b80`, `${testa}~96715039`]);
});

// ── Dall'ingresso alla mappa ─────────────────────────────────────────────────────────────────────────────────────────────

test("modelloMappaDaIngresso: la testa scelta passa dall'id canonico; un id che non è un oggetto della mappa non è una testa", () => {
  const ing = ingresso(reteWan());
  assert.equal(modelloMappaDaIngresso(ing, { testaScelta: null }).mappa.cavi.testa, "dev:1", "senza scelta: la testa proposta");
  const conAlias = modelloMappaDaIngresso(ing, { testaScelta: "host:90" });
  assert.equal(conAlias.t1.canonical["host:90"], "dev:9", "host:90 è fuso nel router di riserva");
  assert.equal(conAlias.mappa.cavi.testa, "dev:9");
  assert.equal(modelloMappaDaIngresso(ing, { testaScelta: "dev:404" }).mappa.cavi.testa, "dev:1");
});
