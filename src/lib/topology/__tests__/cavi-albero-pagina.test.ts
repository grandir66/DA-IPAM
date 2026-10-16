// L'albero della pagina con la mappa nuova (spec topologia §13.7.7, §13.8.3 a schermo, §13.10.3; prove I40, I57; Task 7 del
// piano di T3). Con `model.cavi` l'albero della vista è lo stesso Prim del modello per cavo (`primCavi`) sulle linee della
// vista: schermo e traccia scelgono uguale. In una mappa passo passo un segmento o un ponte radio che non sta fra gli oggetti si
// contrae in una linea fra gli oggetti visibili che lega («segmento», «≋ radio»): senza, Prim farebbe due radici (I40). I cavi
// bloccati sono ridondanze, si vedono a richiesta (I57). Senza `model.cavi` l'albero è quello di T1, bit per bit. Reti piccole
// inventate (righe come le scrivono i lettori), le reti-campione coi fatti di T2 (gli stessi di cavi-mappa.test.ts) e le due
// fixture anonime.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { alberoDellaPagina, contrazioni, lineaDellaVista } from "@/lib/topology/cavi/albero-pagina";
import { modelloMappaCavi } from "@/lib/topology/cavi/mappa";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { partenzeScartate } from "@/lib/topology/cavi/pannello";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import { computeMapView, type MapComputed } from "@/lib/topology/map-compute";
import { redundancyCounts, visibleEdges } from "@/lib/topology/map-screen";
import { buildTopologyModel } from "@/lib/topology/model";
import { LINK_ATTRS_DEFAULT, type MapLink, type TopologyModel, type TopologyModelInput } from "@/lib/topology/model-types";
import { autoVisible, buildTree, proposeHead, type TreeResult } from "@/lib/topology/tree";
import { baseInput, dev, host } from "./support/righe";
import { altreMarcheSnmp, conHypervisor, mista, porte, soloMikrotik, soloUnifi } from "./support/reti-campione";
import { fb, fp, ingresso, vic } from "./support/cavi";

const mk = { vendor: "mikrotik", via: "ssh" } as const;
const lan = (n: number) => ({ id: n, cidr: `10.${n}.0.0/24`, name: `rete ${n}`, gateway: `10.${n}.0.1`, location_id: null });
/** Le righe dei due capi di un cavo fra due MikroTik letti via SSH, porte col nome di fabbrica. */
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string) => [
  vic({ device_id: a, local_port: `${pa},bridge`, remote_device_name: nomeB, remote_port: `bridge/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},bridge`, remote_device_name: nomeA, remote_port: `bridge/${pa}`, source: "device", remote_platform: "MikroTik" }),
];
const carica = (nome: string): TopologyModelInput => ({ macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [],
  ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) } as TopologyModelInput);

function mappaDi(ing: IngressoCavi, testa: string | null = null) {
  const t1 = buildTopologyModel(ing.t1);
  const m = costruisciModelloCavi(ing, t1, { testaScelta: testa });
  return { t1, m, mappa: modelloMappaCavi(t1, m, ing) };
}
const vista = (model: TopologyModel, passo?: { members: string[]; roots: string[] }): MapComputed<TopologyModel> => computeMapView(model, {
  auto: passo === undefined, members: passo?.members ?? [], roots: passo?.roots ?? [], head: null, tweaks: [], expanded: new Set(), orientation: "lr",
});
const padreSu = (tree: Pick<TreeResult, "via">, n: string): string | null => { const l = tree.via.get(n); return l ? (l.a === n ? l.b : l.a) : null; };
const contratte = (links: readonly MapLink[]) => links.filter((l) => l.cavo?.genere === "contrazione");

// ── Le reti-campione coi fatti di T2 (gli stessi di cavi-mappa.test.ts e cavi-ombra.test.ts) ──────────────────────────────────

const devFatto = (id: number, k: string, n: string, over: Parameters<typeof fp>[3] = {}) => fp(id, k, n, { source: "device", in_bridge: 1, ...over });
const macs = (device_id: number, l: string[]) => l.map((mac) => ({ device_id, mac, source: "device" }));
const ingMikrotik = (): IngressoCavi => ingresso(soloMikrotik(), {
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
const ingUnifi = (): IngressoCavi => ingresso(soloUnifi(), {
  uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }, { device_id: 4, uplink_local_port_idx: 1, uplink_source: "lldp_uplink" }],
  fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })],
});

/**
 * La sede della WAN in forma inventata (S10, come in cavi-mappa.test.ts): la WAN di RTR-1 (ether8, fuori dal bridge), la porta 8
 * di SW-2 e la ether8 del router di riserva sentono un segmento con un modem non censito; SW-2 ↔ SW-5 ↔ RTR-RIS per cavo.
 */
const reteWan = () => baseInput({
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
});
const SEG = "seg:1:8";

/** Tre cavi fra SW-2 (core 1) e SW-3 (core 2): quello sulla ether2 inoltra a 1G, ether3 ed ether4 sono bloccati a 10G. */
const treCavi = (primaries: TopologyModelInput["primaries"] = []) => ingresso(baseInput({
  devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
  neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"),
    ...cavo(2, "ether3", 3, "ether3", "SW-3", "SW-2"), ...cavo(2, "ether4", 3, "ether4", "SW-3", "SW-2")],
  ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]),
    ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"], [3, "ether3", "10000 Mbps"], [4, "ether4", "10000 Mbps"]]),
    ...porte(3, [[2, "ether2", "1000 Mbps"], [3, "ether3", "10000 Mbps"], [4, "ether4", "10000 Mbps"]])],
  networks: [lan(1)],
  primaries,
}), { fattiPorta: [
  fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding", stp_role: "alternate" }),
  fp(3, "n:ether4", "ether4", { source: "device", stp_state: "discarding", stp_role: "alternate" }),
] });

/**
 * Un ponte radio fra due sedi (§13.7.6): router R (dev:1) ha sulla ether3 il cavo verso la radio vicina V (dev:7) e sente oltre
 * la radio lontana L (dev:8, porta wlan60): il salto radio è letto. Dall'altra parte il router S2 (dev:2) e, con `terzo`, il
 * router S3 (dev:3) hanno il loro cavo verso L.
 */
const ponteRadio = (terzo = false) => ingresso(baseInput({
  devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }),
    dev(8, { name: "RADIO-LONTANA", device_type: "access_point", ...mk }), dev(2, { name: "RTR-S2", device_type: "router", ...mk }),
    ...(terzo ? [dev(3, { name: "RTR-S3", device_type: "router", ...mk })] : [])],
  networks: [lan(1)],
}), { vicini: [
  vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: 2, local_port: "ether1", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/ether2", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ...(terzo ? [vic({ device_id: 3, local_port: "ether1", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/ether3", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" })] : []),
] });

/**
 * Un hypervisor con due cavi (§12.5, §13.8.3 punto 6, come in cavi-albero.test.ts): verso SW-2 a 1G letto dai due capi (certo),
 * verso SW-3 a 10G letto da un capo solo. Decide la regola dell'hypervisor (il più veloce), non la fiducia. `vendor` «altro»: un
 * server che è hypervisor solo perché ha le sue VM (non per la classe). `aMano`: il cavo veloce è anche dichiarato a mano (una
 * linea «a mano, confermato», che concorre perché ha un cavo visto).
 */
const hypervisor = (opz: { vendor: string; aMano?: boolean }) => {
  const d = [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk }),
    dev(9, { name: "HV-1", device_type: "server", vendor: opz.vendor, host: "10.0.0.9", port_count: 0 })];
  const vm = { scannedDeviceId: 9, vmid: 100, name: "vm-100", node: "HV-1", status: "running", type: "qemu", macs: [], ips: [], scannedAt: "2026-10-13T06:00:00.000Z" };
  return ingresso(baseInput({
    devices: d, networks: [lan(1)],
    neighbors: [
      ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(1, "ether2", 3, "ether2", "SW-3", "RTR-1"),
      vic({ device_id: 2, local_port: "ether5,bridge", remote_device_name: "HV-1", remote_port: "eno1", source: "device" }),
      vic({ device_id: 3, local_port: "ether5,bridge", remote_device_name: "HV-1", remote_port: "eno2", source: "device" }),
      vic({ device_id: 9, local_port: "eno1", remote_device_name: "SW-2", remote_port: "bridge/ether5", source: "device", remote_platform: "MikroTik" }),
    ],
    scanHosts: [{ scannedDeviceId: 9, hostname: "HV-1", ips: ["10.0.0.9"], macs: [] }], vms: [vm],
    ports: [...porte(2, [[5, "ether5", "1000 Mbps"]]), ...porte(3, [[5, "ether5", "10000 Mbps"]])],
    overrides: opz.aMano ? [{ id: 1, action: "add", a_node: "dev:3", a_port: "ether5", b_node: "dev:9", b_port: "eno2", medium: null, created_by: "tecnico", created_at: "2026-10-14 08:00:00" }] : [],
  }));
};

/**
 * §13.7.6 punto 4 (come in cavi-albero.test.ts): la radio vicina è registrata server; la lontana è un server (`lontanaHost`
 * false) o un host «workstation» (true). Sono foglie per la classe, fanno da ponte perché capi del salto.
 */
const ponteCapiFoglia = (lontanaHost: boolean, classificazione = "workstation") => ingresso(baseInput({
  devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(5, { name: "RADIO-V", device_type: "server", vendor: "mikrotik" }), dev(7, { name: "RTR-S2", device_type: "router", ...mk }),
    ...(lontanaHost ? [] : [dev(6, { name: "RADIO-L", device_type: "server", vendor: "mikrotik" })])],
  hosts: lontanaHost ? [host(60, { ip: "10.1.0.60", hostname: "RADIO-L", classification: classificazione })] : [],
  networks: [lan(1)],
}), { vicini: [
  vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-V", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-L", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: 7, local_port: "ether1", remote_device_name: "RADIO-L", remote_port: "bridge/ether2", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
] });

/**
 * Due ★ sulla stessa linea, una per capo (revisione del Task 7): RTR-1 ↔ SW-2 a 10G, RTR-1 ↔ SW-3 a 1G, SW-2 ↔ SW-3 sulla ether3
 * con la ★ di SW-3 e poi quella di SW-2. Il modello le forza tutte e due; una linea ha un solo `primaryFor`.
 */
const dueStelle = () => ingresso(baseInput({
  devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
  neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(1, "ether2", 3, "ether2", "SW-3", "RTR-1"), ...cavo(2, "ether3", 3, "ether3", "SW-3", "SW-2")],
  ports: [...porte(1, [[1, "ether1", "10000 Mbps"], [2, "ether2", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "10000 Mbps"], [3, "ether3", "1000 Mbps"]]),
    ...porte(3, [[2, "ether2", "1000 Mbps"], [3, "ether3", "1000 Mbps"]])],
  networks: [lan(1)],
  primaries: [
    { node_id: "dev:3", other_node: "dev:2", node_port: "ether3", other_port: "ether3" },
    { node_id: "dev:2", other_node: "dev:3", node_port: "ether3", other_port: "ether3" },
  ],
}));

// ── 1. Schermo = traccia ─────────────────────────────────────────────────────────────────────────────────────────────────────

const RETI: ReadonlyArray<readonly [string, () => IngressoCavi]> = [
  ["famiglia 1 · solo MikroTik", ingMikrotik], ["famiglia 2 · solo UniFi", ingUnifi], ["famiglia 5 · mista", () => ingresso(mista())],
  ["la sede della WAN", () => ingresso(reteWan())], ["famiglia 3 · altre marche via SNMP", () => ingresso(altreMarcheSnmp())],
  ["famiglia 4 · con hypervisor", () => ingresso(conHypervisor())], ["tre cavi, due bloccati", () => treCavi()],
  ["★ sul cavo bloccato", () => treCavi([{ node_id: "dev:3", other_node: "dev:2", node_port: "ether4", other_port: "ether4" }])],
  ["ponte radio", () => ponteRadio(true)], ["ponte radio coi capi registrati server", () => ponteCapiFoglia(false)],
  ["ponte radio con la radio lontana host", () => ponteCapiFoglia(true)], ["ponte radio con la radio lontana host «access_point»", () => ponteCapiFoglia(true, "access_point")],
  ["due ★ sulla stessa linea", dueStelle],
  ["hypervisor proxmox, due cavi", () => hypervisor({ vendor: "proxmox" })], ["hypervisor solo per le sue VM", () => hypervisor({ vendor: "altro" })],
  ["hypervisor, cavo veloce anche a mano", () => hypervisor({ vendor: "altro", aMano: true })],
  ["fixture della rete B", () => ingresso(carica("topologia-domarc.json"))], ["fixture del cliente A", () => ingresso(carica("topologia-cliente-a.json"))],
];

for (const [nome, rete] of RETI) {
  test(`schermo = traccia, ${nome}: la mappa automatica ha la testa, i padri, le linee scelte e le radici dell'albero del modello per cavo`, () => {
    const { m, mappa } = mappaDi(rete());
    const v = vista(mappa);
    assert.equal(v.head, m.albero.testa, "la testa del modello per cavo");
    const padri = Object.fromEntries(Object.keys(m.albero.padri).map((k) => [k, padreSu(v.tree, k)]));
    assert.deepEqual(padri, m.albero.padri, "gli stessi padri");
    assert.deepEqual([...v.tree.via].map(([n, l]) => [n, l.id]).sort(), [...m.albero.via].map(([n, c]) => [n, c.id]).sort(), "le stesse linee scelte");
    assert.deepEqual(v.tree.roots, m.albero.radici, "le stesse radici");
    // I figli nell'ordine in cui l'albero li prende (come buildTree di T1): lo stesso del modello, dove la disposizione li mette.
    const presi = [...m.albero.profondita.keys()];
    for (const p of presi) assert.deepEqual(v.tree.children.get(p), presi.filter((k) => m.albero.padri[k] === p), `figli di ${p}`);
    assert.deepEqual(contratte(v.tree.links), [], "nella mappa automatica i segmenti e le radio ci sono: niente da contrarre");
    // Le copie annotate: «auto» o «user» sulle linee usate, ridondanza sulle altre; la ★ resta col suo nodo.
    const usate = new Set([...v.tree.via.values()].map((l) => l.id));
    for (const l of v.tree.links) {
      assert.equal(l.redundant, !usate.has(l.id), l.id);
      const orig = mappa.links.find((x) => x.id === l.id)!;
      assert.equal(l.primary, usate.has(l.id) ? (orig.primary === "user" ? "user" : "auto") : orig.primary, l.id);
      assert.equal(l.primaryFor, orig.primaryFor, l.id);
    }
    for (const [n, l] of v.tree.via) assert.equal(l, v.tree.links.find((x) => x.id === l.id), `la via di ${n} è la copia annotata`);
  });
}

// ── Revisione del Task 7: i capi che solo il modello per cavo conosce (cavi/mappa.ts) ─────────────────────────────────────────

/**
 * Il buco trovato nel Task 7: la radio lontana registrata come host e trovata dal nome che annuncia è un capo di due collegamenti
 * del modello per cavo, ma il modello di T1 (che crea un host solo quando una sua riga lo usa) non ce l'ha. La pagina prendeva i
 * nodi da T1: le due linee non si disegnavano, e la contrazione via radio appendeva RTR-S2 alla radio vicina (traccia: alla
 * lontana). Ora la mappa ha anche i capi che mancano, dall'indice del modello per cavo, con la sua classe.
 */
test("revisione del Task 7: un capo che solo il modello per cavo conosce è un nodo della pagina, con la sua classe", () => {
  const { t1, m, mappa } = mappaDi(ponteCapiFoglia(true));
  assert.ok(!t1.nodes.some((n) => n.id === "host:60") && !("host:60" in t1.canonical), "il modello di T1 non ha la radio lontana");
  const segmenti = mappa.nodes.filter((n) => n.kind === "segmento").map((n) => n.id);
  assert.deepEqual(mappa.nodes.map((n) => n.id), [...t1.nodes.map((n) => n.id), ...segmenti, "host:60"].sort(), "T1 + segmenti + i capi che mancano");
  const n = mappa.nodes.find((x) => x.id === "host:60")!;
  assert.deepEqual([n.kind, n.name, n.type, n.mgmtIp, n.siteId, n.hidden], ["host", "RADIO-L", "workstation", "10.1.0.60", null, false]);
  assert.equal(mappa.classiMappa?.["host:60"], "att", "capo di un ponte radio: attaccato, non client");
  assert.ok(autoVisible(mappa).has("host:60"), "sta nella mappa automatica");
  assert.ok(!(mappa.daSistemare ?? []).some((d) => d.id === "host:60") && !mappa.isolated.includes("host:60"));
  assert.deepEqual(contratte(vista(mappa).tree.links), [], "nella mappa automatica non c'è niente da contrarre");
  assert.deepEqual([mappa.counts.nodes, mappa.counts.promoteProposals, mappa.promote], [mappa.nodes.length, 0, []], "una workstation non è una proposta");
  assert.deepEqual(mappa.cavi.nonCalcolato, m.nonCalcolato, "nessun disaccordo d'identità");
  // Una mappa passo passo salvata con quell'id lo ritrova.
  const p = vista(mappa, { members: ["dev:1", "host:60", "dev:7"], roots: ["dev:1"] });
  assert.deepEqual([p.missing, p.tree.roots, padreSu(p.tree, "dev:7")], [[], ["dev:1"], "host:60"]);
});

test("revisione del Task 7: il capo aggiunto entra nelle proposte di promozione come in T1 (classificato «access_point»)", () => {
  const { mappa } = mappaDi(ponteCapiFoglia(true, "access_point"));
  assert.deepEqual(mappa.promote, [{ hostId: 60, name: "RADIO-L", ip: "10.1.0.60", classification: "access_point", links: 2 }]);
  assert.equal(mappa.counts.promoteProposals, 1);
});

test("revisione del Task 7: un capo che il modello di oggi ha fuso in un altro oggetto non si aggiunge (niente doppioni): si conta", () => {
  const ing = ponteCapiFoglia(true);
  const t1 = buildTopologyModel(ing.t1);
  const m = costruisciModelloCavi(ing, t1, { testaScelta: null });
  // Il disaccordo d'identità, simulato: per il modello di oggi la radio lontana è la vicina (dev:5).
  const mappa = modelloMappaCavi({ ...t1, canonical: { ...t1.canonical, "host:60": "dev:5" } }, m, ing);
  assert.ok(!mappa.nodes.some((n) => n.id === "host:60"), "nessun nodo per l'id fuso");
  assert.equal(mappa.nodes.filter((n) => n.id === "dev:5").length, 1);
  assert.deepEqual(mappa.cavi.nonCalcolato.slice(m.nonCalcolato.length),
    ["1 capo di collegamento che il modello di oggi ha fuso con un altro oggetto: le sue linee non si disegnano"]);
});

test("revisione del Task 7: due ★ sulla stessa linea, una per capo — `cavi.stelle` le porta tutte e due e la pagina sceglie come la traccia", () => {
  const { m, mappa } = mappaDi(dueStelle());
  const l = mappa.links.find((x) => (x.a === "dev:2" && x.b === "dev:3") || (x.a === "dev:3" && x.b === "dev:2"))!;
  assert.deepEqual(mappa.cavi.stelle, { "dev:2": l.id, "dev:3": l.id });
  assert.deepEqual(mappa.cavi.stelle, Object.fromEntries(m.albero.stelle.map((s) => [s.nodo, s.linea])));
  const v = vista(mappa);
  assert.deepEqual([padreSu(v.tree, "dev:2"), padreSu(v.tree, "dev:3")], [m.albero.padri["dev:2"], m.albero.padri["dev:3"]]);
  assert.deepEqual([m.albero.padri["dev:2"], m.albero.padri["dev:3"]], ["dev:1", "dev:2"]);
});

test("revisione del Task 7 (I57): una contrazione con un tratto bloccato è «bloccato»; «giù» vince; instradato resta «inoltra»", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const a = mappa.links.find((l) => l.a === "dev:1" && l.b === SEG)!, b = mappa.links.find((l) => l.a === "dev:9" && l.b === SEG)!;
  type S = NonNullable<MapLink["cavo"]>["stato"];
  const stato = (sa: S, sb: S) => contrazioni({ ...mappa, links: mappa.links.map((l) => (l.id === a.id ? { ...a, cavo: { ...a.cavo!, stato: sa } }
    : l.id === b.id ? { ...b, cavo: { ...b.cavo!, stato: sb } } : l)) }, new Set(["dev:1", "dev:9"]))[0].cavo?.stato;
  assert.deepEqual([stato("bloccato", "inoltra"), stato("inoltra", "bloccato_comune"), stato("giu", "bloccato"), stato("instradato", "inoltra"), stato(null, "instradato")],
    ["bloccato", "bloccato", "giu", "inoltra", "inoltra"]);
});

test("revisione del Task 7: un oggetto sul bordo con più linee verso la parte contratta usa la migliore (vista, non giù, fiducia, id)", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const buona0 = mappa.links.find((l) => l.a === "dev:1" && l.b === SEG)!;
  const buona: MapLink = { ...buona0, cavo: { ...buona0.cavo!, stato: "inoltra", fiducia: "probabile" } };
  // Un'altra linea di RTR-1 verso il segmento, con un id che viene prima: la visita in ampiezza la trovava per prima.
  const altra = (over: Partial<MapLink>, cavo: Partial<NonNullable<MapLink["cavo"]>>): MapLink =>
    ({ ...buona, id: `cavo:dev:1|n:ether0~${SEG}`, aPort: "ether0", ...over, cavo: { ...buona.cavo!, ...cavo } });
  const porta = (x: MapLink) => contrazioni({ ...mappa, links: [x, ...mappa.links.map((l) => (l.id === buona.id ? buona : l))] }, new Set(["dev:1", "dev:9"]))[0].aPort;
  assert.equal(porta(altra({ stale: true }, { fiducia: "certo" })), "ether8", "una linea non vista perde, anche certa");
  assert.equal(porta(altra({}, { stato: "giu", fiducia: "certo" })), "ether8", "una linea giù perde");
  assert.equal(porta(altra({}, { fiducia: "certo" })), "ether0", "fra due viste vince la fiducia migliore");
  assert.equal(porta(altra({}, { fiducia: "dedotto" })), "ether8");
  assert.equal(porta(altra({}, {})), "ether0", "a pari, l'id più piccolo");
});

test("revisione del Task 7: con una radio sola nella parte contratta la frase la nomina", () => {
  const { mappa } = mappaDi(ponteRadio(), "dev:1");
  const v = vista(mappa, { members: ["dev:1", "dev:8", "dev:2"], roots: ["dev:1"] });
  const l = v.tree.via.get("dev:8")!;
  assert.deepEqual([l.cavo?.genere, l.cavo?.via, l.cavo?.frasi], ["contrazione", "radio", ["via ponte radio: la radio RADIO-VICINA non è in questa mappa"]]);
});

/**
 * Comportamento voluto e fissato (revisione del Task 7, TRAPPOLA): una radio nascosta nella mappa automatica non è fra gli oggetti
 * visibili, e la pagina la contrae; il modello per cavo (la traccia) non la vede e ha due radici. `cavi.anomalie` viene dal
 * modello: in questo caso può non combaciare con l'albero a schermo.
 */
test("revisione del Task 7: una radio nascosta nella mappa automatica si contrae (una radice); la traccia, che non la vede, ha due radici", () => {
  const ing = ponteRadio();
  ing.t1.devices = ing.t1.devices.map((d) => (d.id === 7 ? { ...d, topology_hidden: 1 } : d));
  const { m, mappa } = mappaDi(ing, "dev:1");
  const v = vista(mappa);
  assert.deepEqual(v.tree.roots, ["dev:1"], "la pagina: una radice");
  const l = v.tree.via.get("dev:8")!;
  assert.deepEqual([l.cavo?.genere, l.cavo?.via, padreSu(v.tree, "dev:8"), padreSu(v.tree, "dev:2")], ["contrazione", "radio", "dev:1", "dev:8"]);
  assert.equal(m.albero.radici.length, 2, "la traccia: due radici");
});

test("schermo = traccia: la ★ sul cavo bloccato vince (I20), e la linea scelta è «user»", () => {
  const { mappa } = mappaDi(treCavi([{ node_id: "dev:3", other_node: "dev:2", node_port: "ether4", other_port: "ether4" }]));
  const v = vista(mappa);
  const l = v.tree.via.get("dev:3")!;
  assert.deepEqual([l.aPort, l.bPort].sort(), ["ether4", "ether4"]);
  assert.deepEqual([l.primary, l.primaryFor, l.cavo?.stato], ["user", "dev:3", "bloccato"]);
});

// ── 2. I40: la contrazione di un segmento ────────────────────────────────────────────────────────────────────────────────────

test("I40 (§13.7.7): due membri del segmento senza il segmento — una radice sola, unita da una linea «contrazione» via segmento", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const [c] = contrazioni(mappa, new Set(["dev:1", "dev:9"]));
  assert.deepEqual(
    { id: c.id, a: c.a, aPort: c.aPort, b: c.b, bPort: c.bPort },
    { id: `contr:${SEG}:dev:1~dev:9`, a: "dev:1", aPort: "ether8", b: "dev:9", bPort: "ether8" },
  );
  assert.deepEqual([c.cavo?.genere, c.cavo?.via, c.cavo?.frasi], ["contrazione", "segmento", ["via segmento non gestito: non è in questa mappa"]]);
  assert.equal(contrazioni(mappa, new Set(["dev:1", "dev:9"])).length, 1);

  const v = vista(mappa, { members: ["dev:1", "dev:9"], roots: ["dev:1"] });
  assert.deepEqual(v.tree.roots, ["dev:1"], "una radice sola");
  const via = v.tree.via.get("dev:9")!;
  assert.deepEqual([via.id, padreSu(v.tree, "dev:9"), via.cavo?.genere, via.cavo?.via, via.primary, via.redundant],
    [`contr:${SEG}:dev:1~dev:9`, "dev:1", "contrazione", "segmento", "auto", false]);
  assert.deepEqual(v.tree.children.get("dev:1"), ["dev:9"]);
  assert.ok(v.tree.links.some((l) => l.id === via.id), "la contrazione usata sta fra le linee della vista");
});

test("I40: aggiunto il segmento la contrazione sparisce, e il segmento sta sotto il membro più vicino alla partenza", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const conSeg = vista(mappa, { members: ["dev:1", "dev:9", SEG], roots: ["dev:1"] });
  assert.deepEqual(contrazioni(mappa, conSeg.visible), []);
  assert.deepEqual(contratte(conSeg.tree.links), []);
  assert.deepEqual([padreSu(conSeg.tree, SEG), padreSu(conSeg.tree, "dev:9")], ["dev:1", SEG]);
  // Con i tre membri: il segmento sotto la partenza, che è un membro; partendo da SW-2, sotto SW-2.
  for (const partenza of ["dev:1", "dev:2"]) {
    const v = vista(mappa, { members: ["dev:1", "dev:2", "dev:9", SEG], roots: [partenza] });
    assert.equal(padreSu(v.tree, SEG), partenza, `partenza ${partenza}`);
  }
});

test("I40: con tre membri senza il segmento, una contrazione per coppia; l'albero ne usa due, la terza non resta e non conta nel «⇄ N»", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const visibili = new Set(["dev:1", "dev:2", "dev:9"]);
  assert.deepEqual(contrazioni(mappa, visibili).map((l) => l.id),
    [`contr:${SEG}:dev:1~dev:2`, `contr:${SEG}:dev:1~dev:9`, `contr:${SEG}:dev:2~dev:9`]);
  const v = vista(mappa, { members: [...visibili], roots: ["dev:1"] });
  assert.deepEqual(v.tree.roots, ["dev:1"]);
  const usate = new Set([...v.tree.via.values()].map((l) => l.id));
  assert.ok(contratte(v.tree.links).every((l) => usate.has(l.id) && !l.redundant), "solo le contrazioni usate");
  assert.ok(contratte(v.tree.links).length <= 2);
  for (const l of v.tree.links) if (l.redundant) assert.notEqual(l.cavo?.genere, "contrazione");
});

test("§13.8.3 punto 9: una seconda partenza raggiungibile dalla prima attraverso la contrazione si dice nel pannello", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const v = vista(mappa, { members: ["dev:1", "dev:9"], roots: ["dev:1", "dev:9"] });
  assert.deepEqual(v.tree.roots, ["dev:1"]);
  assert.deepEqual(partenzeScartate(v, (id) => id), ["dev:9 è raggiungibile da dev:1: sta nell'albero sotto dev:1"]);
});

// ── 3. La contrazione di un ponte radio ──────────────────────────────────────────────────────────────────────────────────────

test("§13.7.7: router R e router S2 senza le radio — una linea «≋ radio», S2 sotto R", () => {
  const { m, mappa } = mappaDi(ponteRadio(), "dev:1");
  const genere = (x: string, y: string) => mappa.links.filter((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x)).map((l) => l.cavo?.genere);
  assert.deepEqual([genere("dev:1", "dev:7"), genere("dev:7", "dev:8"), genere("dev:8", "dev:2")], [["cavo"], ["radio"], ["cavo"]]);
  assert.ok(m.ponti.has("dev:7") && m.ponti.has("dev:8"));
  const v = vista(mappa, { members: ["dev:1", "dev:2"], roots: ["dev:1"] });
  assert.deepEqual(v.tree.roots, ["dev:1"]);
  const l = v.tree.via.get("dev:2")!;
  assert.deepEqual([l.id, padreSu(v.tree, "dev:2"), l.cavo?.genere, l.cavo?.via, l.cavo?.frasi],
    ["contr:dev:7:dev:1~dev:2", "dev:1", "contrazione", "radio", ["via ponte radio: le radio non sono in questa mappa"]]);
  assert.deepEqual([l.aPort, l.bPort], ["ether3", "ether1"], "le porte dei due oggetti visibili");
  // Con le radio nella mappa non c'è niente da contrarre.
  assert.deepEqual(contratte(vista(mappa, { members: ["dev:1", "dev:7", "dev:8", "dev:2"], roots: ["dev:1"] }).tree.links), []);
});

test("§13.7.7, Scelta 9: tre router oltre il ponte — le contrazioni che l'albero non usa non restano fra le linee e non contano nel «⇄ N»", () => {
  const { mappa } = mappaDi(ponteRadio(true), "dev:1");
  const visibili = ["dev:1", "dev:2", "dev:3"];
  assert.equal(contrazioni(mappa, new Set(visibili)).length, 3, "una per coppia");
  const v = vista(mappa, { members: visibili, roots: ["dev:1"] });
  assert.deepEqual(v.tree.roots, ["dev:1"]);
  const c = contratte(v.tree.links);
  assert.equal(c.length, 2, "solo le due che l'albero usa");
  assert.ok(c.every((l) => !l.redundant && l.primary === "auto"));
  assert.deepEqual([...redundancyCounts(v.tree.links)], [], "nessun «⇄ N»: una contrazione non è un cavo");
});

test("§13.7.7: la contrazione unisce le prove dei due tratti — la più vecchia, la più lenta, giù se un tratto è giù, la fiducia peggiore", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const tratto = (x: string) => mappa.links.find((l) => l.a === x && l.b === SEG)!;
  const a = tratto("dev:1"), b = tratto("dev:9");
  const lento: MapLink = { ...b, speedMbps: 100, stale: true, lastSeen: "2026-10-01 08:00:00", daysUnseen: 12, sources: ["manual"], source: "manual",
    cavo: { ...b.cavo!, stato: "giu", fiducia: "a_mano" } };
  const veloce: MapLink = { ...a, speedMbps: 1000, stale: false, lastSeen: "2026-10-13 11:00:00", daysUnseen: 0, sources: ["lldp"], source: "lldp",
    cavo: { ...a.cavo!, stato: "instradato", fiducia: "probabile" } };
  const modello = { ...mappa, links: mappa.links.map((l) => (l.id === a.id ? veloce : l.id === b.id ? lento : l)) };
  const [c] = contrazioni(modello, new Set(["dev:1", "dev:9"]));
  // Le fonti unite nell'ordine di T1 (LINK_SOURCE_RANK, come `lineaDellaMappa`): «manual» viene prima.
  assert.deepEqual(
    { speed: c.speedMbps, stale: c.stale, lastSeen: c.lastSeen, daysUnseen: c.daysUnseen, sources: c.sources, source: c.source, stato: c.cavo?.stato, fiducia: c.cavo?.fiducia },
    { speed: 100, stale: true, lastSeen: "2026-10-01 08:00:00", daysUnseen: 12, sources: ["manual", "lldp"], source: "manual", stato: "giu", fiducia: "a_mano" },
  );
  assert.deepEqual([c.manual, c.uplinkFrom, c.primary, c.primaryFor, c.redundant, c.cavo?.porteDaVerificare, c.cavo?.detti], [null, null, null, null, false, false, []]);
  // La più vecchia per istante, anche con due forme di data (il testo ordinerebbe « » prima di «T»).
  const iso = { ...modello, links: modello.links.map((l) => (l.id === b.id ? { ...lento, lastSeen: "2026-10-13T02:00:00.000Z" } : l.id === a.id ? { ...veloce, lastSeen: "2026-10-13 03:00:00" } : l)) };
  assert.equal(contrazioni(iso, new Set(["dev:1", "dev:9"]))[0].lastSeen, "2026-10-13T02:00:00.000Z");
});

// ── 4. I57: i cavi bloccati si vedono a richiesta ────────────────────────────────────────────────────────────────────────────

test("I57 (§13.10.3): core 2 con due cavi bloccati e uno attivo — i bloccati sono ridondanze, «⇄ 2», si disegnano solo a richiesta", () => {
  const { mappa } = mappaDi(treCavi(), "dev:1");
  const v = vista(mappa);
  const via = v.tree.via.get("dev:3")!;
  assert.deepEqual([via.aPort, via.bPort, via.cavo?.stato], ["ether2", "ether2", "inoltra"], "il padre è il cavo che inoltra, anche se più lento");
  const bloccati = v.tree.links.filter((l) => l.cavo?.stato === "bloccato");
  assert.equal(bloccati.length, 2);
  assert.ok(bloccati.every((l) => l.redundant));
  assert.equal(redundancyCounts(v.tree.links).get("dev:3"), 2, "«⇄ 2» su core 2");
  const ids = (ls: readonly MapLink[]) => new Set(ls.map((l) => l.id));
  assert.ok(bloccati.every((l) => !ids(visibleEdges(v.tree.links, { showAll: false, selected: null })).has(l.id)), "non si disegnano");
  assert.ok(bloccati.every((l) => ids(visibleEdges(v.tree.links, { showAll: false, selected: "dev:3" })).has(l.id)), "selezionato core 2, si disegnano");
  assert.ok(bloccati.every((l) => ids(visibleEdges(v.tree.links, { showAll: true, selected: null })).has(l.id)), "«mostra tutto»");
});

// ── La testa e le linee del Prim ─────────────────────────────────────────────────────────────────────────────────────────────

test("proposeHead con la mappa nuova: la testa del modello per cavo, anche quando la regola di T1 ne darebbe un'altra (o nessuna)", () => {
  const { mappa } = mappaDi(treCavi());
  assert.equal(proposeHead(mappa), mappa.cavi.testa);
  assert.equal(proposeHead({ ...mappa, cavi: { ...mappa.cavi, testa: "dev:3" } }), "dev:3");
  assert.equal(proposeHead({ ...mappa, cavi: { ...mappa.cavi, testa: null } }), null, "niente ripiego sulla regola di T1");
});

test("lineaDellaVista: la linea della pagina per il Prim, come `lineaDi` per il collegamento", () => {
  const base: MapLink = { id: "x", a: "dev:1", aPort: "p1", b: "dev:2", bPort: "p2", source: "lldp", sources: ["lldp", "manual"], uplinkFrom: "dev:2",
    lastSeen: null, daysUnseen: null, stale: true, ...LINK_ATTRS_DEFAULT, manual: { confirmed: true }, speedMbps: 2500,
    cavo: { genere: "cavo", stato: "bloccato", fiducia: "a_mano_confermato", porteDaVerificare: false, detti: [], frasi: [] } };
  assert.deepEqual(lineaDellaVista(base), { id: "x", a: "dev:1", b: "dev:2", nonVisto: true, stato: "bloccato", fiducia: "a_mano_confermato",
    verso: "dev:2", velocitaMbps: 2500, aMano: false });
  assert.equal(lineaDellaVista({ ...base, sources: ["manual"], source: "manual" }).aMano, true, "solo a mano: tutte le fonti a mano");
  assert.equal(lineaDellaVista({ ...base, vmCount: 3 }).vm, 3);
  const senzaCavo = lineaDellaVista({ ...base, cavo: undefined });
  assert.deepEqual([senzaCavo.stato, senzaCavo.fiducia], [null, "probabile"]);
});

test("alberoDellaPagina: le linee fuori vista non entrano; i figli nell'ordine in cui l'albero li prende", () => {
  const { mappa } = mappaDi(ingresso(reteWan()), "dev:1");
  const visibili = new Set(["dev:1", "dev:2", "dev:5"]);
  const t = alberoDellaPagina(mappa, visibili, ["dev:1"]);
  assert.deepEqual(t.roots, ["dev:1"]);
  assert.deepEqual([padreSu(t, "dev:2"), padreSu(t, "dev:5")], ["dev:1", "dev:2"]);
  assert.deepEqual([...t.children].map(([k, f]) => [k, f]), [["dev:1", ["dev:2"]], ["dev:2", ["dev:5"]], ["dev:5", []]]);
  assert.ok(t.links.every((l) => visibili.has(l.a) && visibili.has(l.b)));
});

/**
 * Una parte staccata dalla testa: due AP su un segmento non gestito, e AP-1 con due server attaccati (più linee del segmento).
 * Il modello per cavo dà al segmento la classe «segmento», che fra le radici che restano viene dopo gli apparati di rete e si
 * ordina per numero di linee: la radice è AP-1. Nella pagina il segmento è «infra» in `classiMappa`: letto così, la radice
 * sarebbe il segmento, e schermo e traccia avrebbero due alberi diversi.
 */
test("alberoDellaPagina: un segmento ha la classe del modello per cavo anche fra le radici che restano (schermo = traccia)", () => {
  const nodo = (id: string, type: string, kind: "device" | "host" | "segmento" = "device") => ({
    id, kind, refId: 0, name: id, type, mgmtIp: null, fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null,
    siteProposed: false, hidden: false, vendor: null,
  });
  const linea = (a: string, aPort: string, b: string, genere: "cavo" | "segmento" = "cavo"): MapLink => ({
    ...LINK_ATTRS_DEFAULT, id: `cavo:${a}|n:${aPort}~${b}`, a, aPort, b, bPort: genere === "segmento" ? "" : "eth0", source: "lldp", sources: ["lldp"],
    uplinkFrom: null, lastSeen: "2026-10-13 11:00:00", daysUnseen: 0, stale: false,
    cavo: { genere, stato: "inoltra", fiducia: "probabile", porteDaVerificare: false, detti: ["LLDP"], frasi: [] },
  });
  const seg = "seg:10:ether1";
  const { mappa } = mappaDi(ingresso(reteWan()));
  const modello: TopologyModel = {
    ...mappa,
    nodes: [nodo("dev:1", "router"), nodo("dev:10", "access_point"), nodo("dev:11", "access_point"), nodo("host:20", "server"), nodo("host:21", "server"), nodo(seg, "segmento", "segmento")],
    links: [linea("dev:10", "ether1", seg, "segmento"), linea("dev:11", "ether1", seg, "segmento"), linea("dev:10", "ether2", "host:20"), linea("dev:10", "ether3", "host:21")],
    classiMappa: { [seg]: "infra" },
    vms: [],
    cavi: { ...mappa.cavi, testa: "dev:1", scelto: {}, ponti: [], segmenti: [{ id: seg, membri: [{ nodo: "dev:10", porta: "ether1" }, { nodo: "dev:11", porta: "ether1" }], altriApparati: 0, frase: "" }] },
  };
  const t = alberoDellaPagina(modello, new Set(modello.nodes.map((n) => n.id)), ["dev:1"]);
  assert.deepEqual(t.roots, ["dev:1", "dev:10"]);
  assert.deepEqual([padreSu(t, seg), padreSu(t, "dev:11")], ["dev:10", seg]);
});

// ── 5. Spento = T1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test("spento = T1: senza `cavi` l'albero e la testa sono quelli di T1 (il cavo più veloce vince, anche bloccato: T1 non sa lo stato)", () => {
  const { t1, mappa } = mappaDi(treCavi());
  const senza: TopologyModel = { ...mappa, cavi: undefined };
  const testa = proposeHead(senza);
  assert.equal(testa, proposeHead(t1));
  const t = buildTree(senza, autoVisible(senza), testa ? [testa] : []);
  assert.equal(t.via.get("dev:3")?.cavo?.stato, "bloccato", "la regola di T1 sceglie il più veloce");
  assert.deepEqual(contratte(t.links), []);
  // E il modello di T1 non ha cavi: buildTree è quello di oggi (le prove di tree.test.ts e le impronte PRIMA_DI_T2 lo fissano).
  assert.equal(t1.cavi, undefined);
  assert.deepEqual(contrazioni(t1, new Set(["dev:1"])), [], "senza `cavi` non c'è niente da contrarre");
});
