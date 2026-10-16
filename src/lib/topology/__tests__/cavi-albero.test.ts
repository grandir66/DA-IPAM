// L'albero dallo spanning tree (spec topologia §13.8.3), in ombra: la porta radice sceglie; un bloccato fa da padre solo se
// non c'è altro; un instradato non batte un percorso nel bridge, ma verso un segmento non perde; il segmento sotto il membro
// più vicino alla testa; il gateway del controller attaccato per la LAN; «disabled» su una porta accesa sceglie; l'anomalia
// «core che esce da uno switch di accesso»; la testa dalle prove, mai per id. Reti piccole inventate: le righe stanno
// nell'ingresso del modello di oggi (fonti `device` e `unifi`), così la classe di ogni oggetto è quella della mappa di oggi.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import type { ModelDeviceRow, ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";
import { porte } from "./support/reti-campione";
import { fb, fp, ingresso, vic } from "./support/cavi";

const ombra = (ing: IngressoCavi, testa: string | null = null) => costruisciModelloCavi(ing, buildTopologyModel(ing.t1), { testaScelta: testa });
const mk = { vendor: "mikrotik", via: "ssh" } as const;
const lan = (n: number) => ({ id: n, cidr: `10.${n}.0.0/24`, name: `rete ${n}`, gateway: `10.${n}.0.1`, location_id: null });
/** Le righe dei due capi di un cavo fra due MikroTik letti via SSH, porte col nome di fabbrica. */
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string): ModelNeighborRow[] => [
  vic({ device_id: a, local_port: `${pa},bridge`, remote_device_name: nomeB, remote_port: `bridge/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},bridge`, remote_device_name: nomeA, remote_port: `bridge/${pa}`, source: "device", remote_platform: "MikroTik" }),
];
const rete = (devices: ModelDeviceRow[], neighbors: ModelNeighborRow[], over: Partial<TopologyModelInput> = {}) =>
  baseInput({ devices, neighbors, networks: [lan(1)], ...over });
/** La chiave della porta che il collegamento ha su quel nodo. */
const capoDi = (c: ReturnType<typeof ombra>["collegamenti"][number], nodo: string) => (c.a.nodo === nodo ? c.a : c.b).chiave;
const fra = (m: ReturnType<typeof ombra>, x: string, y: string) =>
  m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

test("I24 e punto 1: la porta radice sceglie il padre", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", host: "10.1.0.1", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")]);
  const m = ombra(ingresso(t1, {
    fattiBridge: [fb(3, { bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: "ether2" }), fb(1, { bridge_id: "0.02:00:00:00:00:01", root_id: "0.02:00:00:00:00:01" })],
  }));
  assert.equal(m.albero.testa, "dev:1");
  assert.equal(m.albero.padri["dev:3"], "dev:2", "la porta radice di SW-3 va verso SW-2");
});

test("un collegamento bloccato fa da padre solo se non c'è altro (I24)", () => {
  const d = [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })];
  const bloccato = ombra(ingresso(rete(d, [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")]),
    { fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding", stp_role: "alternate" })] }));
  assert.equal(bloccato.albero.padri["dev:3"], "dev:2");
  const solo = ombra(ingresso(rete(d, cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")), { fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding" })] }));
  assert.equal(solo.albero.padri["dev:3"], "dev:1", "senza altro, il bloccato fa da padre");
});

test("I23: un instradato non batte un percorso nel bridge", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(4, { name: "SW-4", ...mk })], [
    vic({ device_id: 1, local_port: "ether2", remote_device_name: "SW-4", remote_port: "bridge/ether4", source: "device", remote_platform: "MikroTik" }),
    ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether3", 4, "ether3", "SW-4", "SW-2"),
  ]);
  const m = ombra(ingresso(t1));
  assert.equal(fra(m, "dev:1", "dev:4")[0]?.stato, "instradato", "la porta del router è fuori dal bridge");
  assert.equal(m.albero.padri["dev:4"], "dev:2");
});

test("I49 e I50 (S10): il segmento sta sotto il membro più vicino alla testa, anche fuori dal bridge; a pari fiducia un cavo vero batte il segmento", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(9, { name: "RTR-RIS", device_type: "router", ...mk }), dev(5, { name: "SW-5", ...mk })],
    [
      ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"),
      // la WAN di RTR-1 (fuori dal bridge) e la porta 8 di SW-2 sentono tutte e due RTR-RIS (e la WAN anche un modem): un segmento
      vic({ device_id: 1, local_port: "ether8", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 1, local_port: "ether8", remote_device_name: "MODEM", remote_port: "eth0", source: "device", remote_mac: "02:00:00:00:77:01" }),
      vic({ device_id: 2, local_port: "ether8,bridge", remote_device_name: "RTR-1", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 2, local_port: "ether8,bridge", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      // RTR-RIS ha anche un cavo vero verso SW-5, che sta sotto SW-2
      ...cavo(2, "ether5", 5, "ether5", "SW-5", "SW-2"), ...cavo(5, "ether6", 9, "ether6", "RTR-RIS", "SW-5"),
    ],
    {
      ports: [...porte(1, [[1, "ether1", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [5, "ether5", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]),
        ...porte(9, [[6, "ether6", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(5, [[5, "ether5", "1000 Mbps"], [6, "ether6", "1000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1), "dev:1");
  const seg = m.segmenti.find((s) => s.membri.some((p) => p.nodo === "dev:1"));
  assert.ok(seg, "c'è il segmento della WAN");
  assert.equal(seg.id, "seg:1:8");
  assert.equal(m.albero.padri[seg.id], "dev:1", "sotto la porta della WAN di RTR-1, non sotto SW-2 per alfabeto");
  assert.equal(m.albero.padri["dev:9"], "dev:5", "il cavo vero batte l'appartenenza al segmento");
});

test("I67 e I68: «disabled» su una porta accesa sceglie e non è un'anomalia; il gateway del controller è attaccato per la LAN", () => {
  const u = { vendor: "ubiquiti", via: "api" } as const;
  const t1 = rete(
    [
      dev(1, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00", ...u }),
      dev(4, { name: "FLEX", controller_mac: "02:00:d0:00:04:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 7, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
    ],
    [
      vic({ device_id: 2, local_port: "SFP28 25", remote_device_name: "GW", remote_mac: "02:00:d0:00:01:00", remote_port: "SFP+ 1" }),
      vic({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "GW", remote_mac: "02:00:d0:00:01:00", remote_port: "SFP+ 2" }),
      vic({ device_id: 4, local_port: "Port 1", remote_device_name: "AGG", remote_mac: "02:00:d0:00:02:00", remote_port: "Port 7" }),
    ],
    {
      uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }, { device_id: 4, port_index: 1, port_name: "Port 1" }],
      ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"], [11, "SFP+ 2", "10000 Mbps"]]), ...porte(2, [[2, "SFP+ 2", "10000 Mbps"], [7, "Port 7", "1000 Mbps"], [25, "SFP28 25", "10000 Mbps"]]),
        ...porte(4, [[1, "Port 1", "1000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })] }), "dev:1");
  const via = m.albero.via.get("dev:2");
  assert.ok(via && !via.wan, "AGG appeso al gateway per la LAN, non per la WAN");
  assert.equal(fra(m, "dev:1", "dev:2").filter((c) => c.wan).length, 1, "la WAN c'è, instradata");
  assert.equal(m.albero.padri["dev:4"], "dev:2");
  assert.ok(m.albero.scelto.has("dev:4"), "l'uplink «disabled» su una porta accesa sceglie");
  assert.deepEqual(m.albero.anomalie, []);
});

test("punto 8: «core che esce da uno switch di accesso» con cavi verso almeno altri due switch dello stesso livello del padre", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(10, { name: "CORE-1", ...mk }), dev(21, { name: "ACC-A", ...mk }), dev(22, { name: "ACC-B", ...mk }), dev(23, { name: "ACC-C", ...mk }), dev(11, { name: "CORE-2", ...mk })],
    [
      ...cavo(1, "ether1", 10, "ether1", "CORE-1", "RTR-1"),
      ...cavo(10, "ether2", 21, "ether2", "ACC-A", "CORE-1"), ...cavo(10, "ether3", 22, "ether3", "ACC-B", "CORE-1"), ...cavo(10, "ether4", 23, "ether4", "ACC-C", "CORE-1"),
      ...cavo(23, "ether9", 11, "ether9", "CORE-2", "ACC-C"), ...cavo(21, "ether8", 11, "ether8", "CORE-2", "ACC-A"), ...cavo(22, "ether7", 11, "ether7", "CORE-2", "ACC-B"),
    ],
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(11, "n:ether8", "ether8", { source: "device", stp_state: "discarding" }), fp(11, "n:ether7", "ether7", { source: "device", stp_state: "discarding" })] }), "dev:1");
  assert.equal(m.albero.padri["dev:11"], "dev:23");
  assert.deepEqual(m.albero.anomalie, [{ nodo: "dev:11", padre: "dev:23", altri: ["dev:21", "dev:22"] }]);
});

test("I63 e punto 7: a pari nodi raggiunti la testa è il gateway di più reti, mai l'id", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-A", device_type: "router", host: "10.5.0.2", ...mk }), dev(2, { name: "RTR-B", device_type: "router", host: "10.1.0.1", ...mk }), dev(3, { name: "SW-3", ...mk })],
    [...cavo(1, "ether1", 3, "ether1", "SW-3", "RTR-A"), ...cavo(2, "ether1", 3, "ether2", "SW-3", "RTR-B")],
    { networks: [lan(1), { id: 2, cidr: "10.2.0.0/24", name: "rete 2", gateway: "10.1.0.1", location_id: null }] },
  );
  assert.equal(ombra(ingresso(t1)).albero.testa, "dev:2");
});

test("★ (I20): il principale scelto a mano vince sempre, anche su un bloccato", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")],
    { primaries: [{ node_id: "dev:3", other_node: "dev:1", node_port: "ether3", other_port: "ether3" }] },
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding" })] }), "dev:1");
  assert.equal(m.albero.padri["dev:3"], "dev:1");
});

test("I22: il bridge designato conferma un cavo già provato da LLDP; non sceglie il padre e non crea collegamenti", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk })],
    [vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: "SW-2", remote_port: "bridge/ether1", source: "device", remote_platform: "MikroTik" })]);
  const m = ombra(ingresso(t1, {
    fattiPorta: [fp(2, "n:ether1", "ether1", { source: "device", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "0.02:00:00:00:00:01" })],
    fattiBridge: [fb(1, { bridge_id: "0.02:00:00:00:00:01", root_id: "0.02:00:00:00:00:01" })],
  }), "dev:1");
  assert.equal(m.collegamenti.length, 1);
  assert.equal(m.collegamenti[0].fiducia, "certo", "LLDP da un capo e il bridge designato della porta radice dell'altro");
});

test("lo schema assente si dice, e le parti non calcolate in T2 sono elencate", () => {
  const m = ombra({ ...ingresso(baseInput({ devices: [dev(2)] })), schema: false });
  assert.equal(m.schema, false);
  // Sette in T2; il Task 3 di T3 ne toglie due (l'abbinamento «telaio, nome, IP» e le prove di ruolo coi fatti nuovi).
  assert.ok(m.nonCalcolato.length >= 5);
});

// ── Casi aggiunti dopo il piano (fatti emersi sulle letture vere del 15/10) ────────────────────────────────────────────────

test("§13.5.3 e §13.8.3 punto 1, gateway vero: la porta dell'uplink (WAN) e la porta remota dell'uplink (cavo della LAN) non sono i due capi di un cavo; il cavo viene dall'LLDP per indice", () => {
  const u = { vendor: "ubiquiti", via: "api" } as const;
  const t1 = rete(
    [
      dev(1, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00", ...u }),
    ],
    [],
    {
      uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
      ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"], [11, "SFP+ 2", "25000 Mbps"]]), ...porte(2, [[2, "SFP+ 2", "10000 Mbps"], [25, "SFP28 25", "25000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1, {
    uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_downlink" }],
    vicini: [
      // il gateway scrive le sue porte «ethN», un nome che il suo elenco non ha: il cavo si abbina per indice
      vic({ device_id: 1, local_port: "eth2", local_port_index: 11, remote_device_name: "AGG", remote_mac: "02:00:d0:00:02:00", remote_port: "Port 25", remote_port_index: 25 }),
      vic({ device_id: 2, local_port: "SFP28 25", local_port_index: 25, remote_device_name: "GW", remote_mac: "02:00:d0:00:01:00", remote_port: "eth2" }),
    ],
  }), "dev:1");
  const cs = fra(m, "dev:1", "dev:2");
  const lan = cs.filter((c) => !c.wan);
  const wan = cs.filter((c) => c.wan);
  assert.equal(lan.length, 1, "il cavo della LAN è uno, e non è la WAN");
  assert.deepEqual([capoDi(lan[0], "dev:1"), capoDi(lan[0], "dev:2"), lan[0].stato, lan[0].fiducia], ["i:11", "i:25", "inoltra", "certo"]);
  assert.equal(wan.length, 1, "la WAN è un collegamento a parte");
  assert.deepEqual([capoDi(wan[0], "dev:1"), wan[0].stato, wan[0].verso], ["i:10", "instradato", null]);
  assert.equal(m.albero.padri["dev:2"], "dev:1");
  assert.equal(m.albero.via.get("dev:2")?.wan, undefined, "AGG sta sotto il gateway per il cavo della LAN, non per la WAN");
});

/**
 * Un fascio fra SW-2 e SW-3 (due cavi) e un cavo diretto dal router a SW-3: la porta radice di SW-3 è il fascio. Letto da un
 * MikroTik il fascio è il «bond1» di tutti e due i capi; letto via SNMP i membri lo dicono come «if:<indice dell'interfaccia
 * del fascio>» e il bridge dà la porta radice col nome di quell'interfaccia. Lo stesso albero, lo stesso stato. Con `bloccato` il
 * fascio è fermo (alternate) e la porta radice di SW-3 è il cavo diretto dal router.
 */
function reteConFascio(forma: "mikrotik" | "snmp", bloccato: boolean): IngressoCavi {
  const stato = bloccato ? { stp_state: "discarding", stp_role: "alternate" } : { stp_state: "forwarding" };
  if (forma === "mikrotik") {
    const d = [dev(1, { name: "RTR-1", device_type: "router", host: "10.1.0.1", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })];
    const bond = (n: number, p: string) => fp(n, `n:${p}`, p, { source: "device", lag_group: "bond1", stp_state: "forwarding" });
    return ingresso(rete(d, [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(2, "ether3", 3, "ether3", "SW-3", "SW-2"), ...cavo(1, "ether4", 3, "ether4", "SW-3", "RTR-1")]), {
      fattiPorta: [bond(2, "ether2"), bond(2, "ether3"), bond(3, "ether2"), bond(3, "ether3"), fp(3, "n:bond1", "bond1", { source: "device", ...stato })],
      fattiBridge: [fb(3, { bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: bloccato ? "ether4" : "bond1" })],
    });
  }
  const s = { vendor: "cisco", via: "snmp_v2" } as const;
  const ds = [dev(1, { name: "RTR-1", device_type: "router", host: "10.1.0.1", ...s }), dev(2, { name: "SW-2", ...s }), dev(3, { name: "SW-3", ...s })];
  const lldp = (a: number, pa: string, nomeB: string, pb: string) => vic({ device_id: a, local_port: pa, remote_device_name: nomeB, remote_port: pb, source: "snmp" });
  const fs = (n: number, i: number, nome: string, over: Parameters<typeof fp>[3] = {}) => fp(n, `i:${i}`, nome, { source: "snmp", stp_state: "forwarding", ...over });
  // Le righe stanno nell'ingresso del modello di oggi (la classe degli oggetti viene da lì); la porta si abbina col nome nell'elenco di SNMP.
  return ingresso(rete(ds, [
    lldp(1, "Gi1/0/1", "SW-2", "Gi1/0/1"), lldp(2, "Gi1/0/1", "RTR-1", "Gi1/0/1"), lldp(2, "Gi1/0/2", "SW-3", "Gi1/0/2"), lldp(3, "Gi1/0/2", "SW-2", "Gi1/0/2"),
    lldp(2, "Gi1/0/3", "SW-3", "Gi1/0/3"), lldp(3, "Gi1/0/3", "SW-2", "Gi1/0/3"), lldp(1, "Gi1/0/4", "SW-3", "Gi1/0/4"), lldp(3, "Gi1/0/4", "RTR-1", "Gi1/0/4"),
  ]), {
    fattiPorta: [
      fs(1, 1, "Gi1/0/1"), fs(1, 4, "Gi1/0/4"), fs(2, 1, "Gi1/0/1"), fs(3, 4, "Gi1/0/4"),
      fs(2, 2, "Gi1/0/2", { lag_group: "if:50" }), fs(2, 3, "Gi1/0/3", { lag_group: "if:50" }), fs(2, 50, "Po1", { if_kind: "lag" }),
      fs(3, 2, "Gi1/0/2", { lag_group: "if:60" }), fs(3, 3, "Gi1/0/3", { lag_group: "if:60" }), fs(3, 60, "Po1", { if_kind: "lag", ...stato }),
    ],
    fattiBridge: [fb(3, { source: "snmp", bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: bloccato ? "Gi1/0/4" : "Po1" })],
  });
}

for (const forma of ["mikrotik", "snmp"] as const) {
  test(`fasci (${forma}): la porta radice di un bridge che è un fascio sceglie il fascio, comunque il lettore dica il fascio`, () => {
    const m = ombra(reteConFascio(forma, false), "dev:1");
    const f = fra(m, "dev:2", "dev:3").filter((c) => c.genere === "fascio");
    assert.equal(f.length, 1, "i due cavi sono un fascio");
    assert.equal(f[0].membri?.length, 2);
    assert.equal(f[0].stato, "inoltra");
    assert.equal(m.albero.scelto.get("dev:3"), f[0].id, "il collegamento scelto di SW-3 è il fascio");
    assert.deepEqual(m.albero.avvisi, []);
    assert.equal(m.albero.padri["dev:3"], "dev:2", "senza la porta radice vincerebbe il cavo diretto dal router (spareggio per id)");
  });

  test(`fasci (${forma}): lo stato del fascio si legge sull'interfaccia del fascio (fermo = bloccato) e il padre è il cavo della porta radice`, () => {
    const m = ombra(reteConFascio(forma, true), "dev:1");
    const f = fra(m, "dev:2", "dev:3").filter((c) => c.genere === "fascio");
    assert.equal(f[0].stato, "bloccato");
    assert.equal(m.albero.padri["dev:3"], "dev:1", "la porta radice è il cavo diretto dal router");
  });
}

test("MSTP: bloccato nell'albero comune e attivo per le VLAN di un'istanza resta «fermo» per l'albero: il padre è il cavo che inoltra", () => {
  const d = [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })];
  const regione = { region_name: "REGIONE-A", region_revision: 1, config_digest: "02:00:00:00:00:D1" };
  const t1 = rete(d, [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")]);
  // Senza root_id nessun bridge dice la sua porta radice: decidono le chiavi di Prim, e il cavo fermo (alfabeticamente il primo) deve perdere.
  const ing = ingresso(t1, {
    fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_role: "alternate", stp_state: "discarding" })],
    fattiBridge: [fb(1, { protocol: "mstp", ...regione }), fb(2, { protocol: "mstp", ...regione }), fb(3, { protocol: "mstp", ...regione }),
      fb(3, { protocol: "mstp", instance: 1, root_port: "ether3", vlans: "10-12,20", ...regione })],
  });
  const m = ombra(ing, "dev:1");
  const diretto = fra(m, "dev:1", "dev:3");
  assert.deepEqual(diretto.map((c) => [c.stato, c.attivoPerVlan]), [["bloccato_comune", [10, 11, 12, 20]]]);
  assert.equal(m.albero.padri["dev:3"], "dev:2", "bloccato_comune vale «fermo» come bloccato");
  // Un'altra regione, o una configurazione diversa: non è la stessa MSTP, il cavo è bloccato e basta.
  const altra = ombra(ingresso(t1, { fattiPorta: ing.fattiPorta, fattiBridge: [...ing.fattiBridge.filter((b) => b.device_id !== 1), fb(1, { protocol: "mstp", ...regione, config_digest: "02:00:00:00:00:D2" })] }), "dev:1");
  assert.deepEqual(fra(altra, "dev:1", "dev:3").map((c) => [c.stato, c.attivoPerVlan]), [["bloccato", undefined]]);
  // Se è l'unico cavo, fa da padre anche così.
  const solo = ombra(ingresso(rete(d, cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")), { fattiPorta: ing.fattiPorta, fattiBridge: ing.fattiBridge }), "dev:1");
  assert.equal(solo.albero.padri["dev:3"], "dev:1");
});

test("I22 (negativi): il bridge designato conferma solo se è quello dell'altro capo e se l'altro capo riceve RSTP", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk })],
    [vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: "SW-2", remote_port: "bridge/ether1", source: "device", remote_platform: "MikroTik" })]);
  const radice = [fb(1, { bridge_id: "0.02:00:00:00:00:01", root_id: "0.02:00:00:00:00:01" })];
  const fiducia = (porta: Parameters<typeof fp>[3]) => ombra(ingresso(t1, { fattiBridge: radice, fattiPorta: [fp(2, "n:ether1", "ether1", { source: "device", stp_role: "root", stp_state: "forwarding", ...porta })] }), "dev:1")
    .collegamenti[0].fiducia;
  assert.equal(fiducia({ sending_rstp: 1, designated_bridge: "0.02:00:00:00:00:01" }), "certo");
  assert.equal(fiducia({ sending_rstp: 1, designated_bridge: "0.02:00:00:00:00:99" }), "probabile", "un altro bridge designato: la radice regionale non conferma");
  assert.equal(fiducia({ sending_rstp: 0, designated_bridge: "0.02:00:00:00:00:01" }), "probabile", "l'altro capo non manda RSTP: il bridge designato non è un vicino");
  assert.equal(fiducia({ sending_rstp: 1, designated_bridge: null }), "probabile");
});

test("I50 con gli id in ordine contrario: il segmento sta sotto il membro più vicino alla testa, anche se il suo id viene dopo per alfabeto", () => {
  // La testa è dev:20 e il suo vicino dev:10 (profondità 1): a pari chiave lo spareggio per id sceglierebbe dev:10.
  const t1 = rete(
    [dev(20, { name: "RTR-1", device_type: "router", ...mk }), dev(10, { name: "SW-2", ...mk }), dev(30, { name: "RTR-RIS", device_type: "router", ...mk })],
    [
      ...cavo(20, "ether1", 10, "ether1", "SW-2", "RTR-1"),
      vic({ device_id: 20, local_port: "ether8", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 20, local_port: "ether8", remote_device_name: "MODEM", remote_port: "eth0", source: "device", remote_mac: "02:00:00:00:77:01" }),
      vic({ device_id: 10, local_port: "ether8,bridge", remote_device_name: "RTR-1", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 10, local_port: "ether8,bridge", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
    ],
    { ports: [...porte(20, [[1, "ether1", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(10, [[1, "ether1", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(30, [[8, "ether8", "1000 Mbps"]])] },
  );
  const m = ombra(ingresso(t1), "dev:20");
  const seg = m.segmenti.find((s) => s.membri.some((p) => p.nodo === "dev:20"));
  assert.ok(seg, "c'è il segmento");
  assert.equal(m.albero.padri[seg.id], "dev:20");
});

test("§13.8.3 punto 1 (H11): un gateway con la WAN su uno switch e la LAN su un altro sta sotto lo switch della LAN, e l'uplink non sceglie", () => {
  const u = { vendor: "ubiquiti", via: "api" } as const;
  const t1 = rete(
    [
      dev(1, { name: "CORE", controller_mac: "02:00:d0:00:01:00", ...u }),
      dev(6, { name: "SW-A", controller_mac: "02:00:d0:00:06:00", uplink_mac: "02:00:d0:00:01:00", uplink_remote_port: 2, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(7, { name: "SW-B", controller_mac: "02:00:d0:00:07:00", uplink_mac: "02:00:d0:00:01:00", uplink_remote_port: 3, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(5, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:05:00", uplink_mac: "02:00:d0:00:06:00", uplink_remote_port: 2, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
    ],
    [
      vic({ device_id: 6, local_port: "Port 1", remote_device_name: "CORE", remote_mac: "02:00:d0:00:01:00", remote_port: "Port 2" }),
      vic({ device_id: 7, local_port: "Port 1", remote_device_name: "CORE", remote_mac: "02:00:d0:00:01:00", remote_port: "Port 3" }),
      vic({ device_id: 7, local_port: "Port 2", remote_device_name: "GW", remote_mac: "02:00:d0:00:05:00", remote_port: "SFP+ 2" }),
    ],
    {
      uplinkPorts: [{ device_id: 6, port_index: 1, port_name: "Port 1" }, { device_id: 7, port_index: 1, port_name: "Port 1" }, { device_id: 5, port_index: 10, port_name: "SFP+ 1" }],
      ports: [...porte(1, [[2, "Port 2", "1000 Mbps"], [3, "Port 3", "1000 Mbps"]]), ...porte(6, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"]]),
        ...porte(7, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"]]), ...porte(5, [[10, "SFP+ 1", "10000 Mbps"], [11, "SFP+ 2", "10000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1, { uplink: [{ device_id: 5, uplink_local_port_idx: 10, uplink_source: "lldp_downlink" }] }), "dev:1");
  assert.equal(m.albero.padri["dev:5"], "dev:7", "il padre viene dal cavo della LAN");
  assert.equal(m.albero.scelto.has("dev:5"), false, "il gateway non sceglie");
  assert.equal(fra(m, "dev:5", "dev:6").filter((c) => c.wan && c.stato === "instradato" && c.verso === null).length, 1, "la WAN c'è, instradata e senza verso");
  assert.deepEqual([m.albero.padri["dev:6"], m.albero.padri["dev:7"]], ["dev:1", "dev:1"]);
});

test("§13.8.3 punto 1: l'uplink del controller su una porta ferma non sceglie e lo dice; decide il ripiego", () => {
  const u = { vendor: "ubiquiti", via: "api" } as const;
  const t1 = rete(
    [
      dev(1, { name: "CORE", controller_mac: "02:00:d0:00:01:00", ...u }),
      dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00", uplink_mac: "02:00:d0:00:01:00", uplink_remote_port: 2, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(3, { name: "SW-3", controller_mac: "02:00:d0:00:03:00", uplink_mac: "02:00:d0:00:01:00", uplink_remote_port: 3, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(4, { name: "FLEX", controller_mac: "02:00:d0:00:04:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 7, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
    ],
    [
      vic({ device_id: 2, local_port: "Port 1", remote_device_name: "CORE", remote_mac: "02:00:d0:00:01:00", remote_port: "Port 2" }),
      vic({ device_id: 3, local_port: "Port 1", remote_device_name: "CORE", remote_mac: "02:00:d0:00:01:00", remote_port: "Port 3" }),
      vic({ device_id: 4, local_port: "Port 1", remote_device_name: "AGG", remote_mac: "02:00:d0:00:02:00", remote_port: "Port 7" }),
      vic({ device_id: 4, local_port: "Port 2", remote_device_name: "SW-3", remote_mac: "02:00:d0:00:03:00", remote_port: "Port 5" }),
    ],
    {
      uplinkPorts: [{ device_id: 2, port_index: 1, port_name: "Port 1" }, { device_id: 3, port_index: 1, port_name: "Port 1" }, { device_id: 4, port_index: 1, port_name: "Port 1" }],
      ports: [...porte(1, [[2, "Port 2", "1000 Mbps"], [3, "Port 3", "1000 Mbps"]]), ...porte(2, [[1, "Port 1", "1000 Mbps"], [7, "Port 7", "1000 Mbps"]]),
        ...porte(3, [[1, "Port 1", "1000 Mbps"], [5, "Port 5", "1000 Mbps"]]), ...porte(4, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "discarding", stp_role: "alternate" })] }), "dev:1");
  assert.deepEqual(m.albero.avvisi, [{ nodo: "dev:4", testo: "uplink del controller su una porta ferma" }]);
  assert.equal(m.albero.scelto.has("dev:4"), false);
  assert.equal(m.albero.padri["dev:4"], "dev:3", "il cavo fermo fa da padre solo se non c'è altro");
});

test("punto 8: due soli uplink verso due switch dello stesso livello non fanno scattare «core che esce da uno switch di accesso»", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(10, { name: "CORE-1", ...mk }), dev(21, { name: "ACC-A", ...mk }), dev(23, { name: "ACC-C", ...mk }), dev(11, { name: "CORE-2", ...mk })],
    [
      ...cavo(1, "ether1", 10, "ether1", "CORE-1", "RTR-1"), ...cavo(10, "ether2", 21, "ether2", "ACC-A", "CORE-1"), ...cavo(10, "ether4", 23, "ether4", "ACC-C", "CORE-1"),
      ...cavo(23, "ether9", 11, "ether9", "CORE-2", "ACC-C"), ...cavo(21, "ether8", 11, "ether8", "CORE-2", "ACC-A"),
    ],
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(11, "n:ether8", "ether8", { source: "device", stp_state: "discarding" })] }), "dev:1");
  assert.equal(m.albero.padri["dev:11"], "dev:23");
  assert.deepEqual(m.albero.anomalie, []);
});

test("il controller non dice la porta radice: un suo bridge «radice di sé stesso» non toglie la scelta dell'uplink", () => {
  const u = { vendor: "ubiquiti", via: "api" } as const;
  const t1 = rete(
    [
      dev(1, { name: "CORE", controller_mac: "02:00:d0:00:01:00", ...u }),
      dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00", uplink_mac: "02:00:d0:00:01:00", uplink_remote_port: 2, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
    ],
    [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "CORE", remote_mac: "02:00:d0:00:01:00", remote_port: "Port 2" })],
    { uplinkPorts: [{ device_id: 2, port_index: 1, port_name: "Port 1" }], ports: [...porte(1, [[2, "Port 2", "1000 Mbps"]]), ...porte(2, [[1, "Port 1", "1000 Mbps"]])] },
  );
  const m = ombra(ingresso(t1, { fattiBridge: [fb(2, { source: "controller", bridge_id: "32768.02:00:d0:00:02:00", root_id: "02:00:d0:00:02:00" })] }), "dev:1");
  assert.ok(m.albero.scelto.has("dev:2"), "la scelta viene dall'uplink");
});

test("punto 6: il principale dell'hypervisor è il cavo non giù e più veloce; le VM dicono quale", () => {
  const d = [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk }), dev(9, { name: "HV-1", device_type: "server", vendor: "proxmox", host: "10.0.0.9", port_count: 0 })];
  const righe = [
    ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(1, "ether2", 3, "ether2", "SW-3", "RTR-1"),
    vic({ device_id: 2, local_port: "ether5,bridge", remote_device_name: "HV-1", remote_port: "eno1", source: "device" }),
    vic({ device_id: 3, local_port: "ether5,bridge", remote_device_name: "HV-1", remote_port: "eno2", source: "device" }),
    // il cavo lento è letto anche dall'hypervisor (certo), quello veloce da un capo solo (probabile): decide la regola dell'hypervisor, non la fiducia
    vic({ device_id: 9, local_port: "eno1", remote_device_name: "SW-2", remote_port: "bridge/ether5", source: "device", remote_platform: "MikroTik" }),
  ];
  const vm = { scannedDeviceId: 9, vmid: 100, name: "vm-100", node: "HV-1", status: "running", type: "qemu", macs: [], ips: [], scannedAt: "2026-10-13T06:00:00.000Z" };
  const veloce = (giu: boolean) => ombra(ingresso(rete(d, righe, {
    scanHosts: [{ scannedDeviceId: 9, hostname: "HV-1", ips: ["10.0.0.9"], macs: [] }], vms: [vm],
    ports: [...porte(2, [[5, "ether5", "1000 Mbps"]]), ...porte(3, [[5, "ether5", "10000 Mbps"]])],
  }),
    giu ? { fattiPorta: [fp(3, "i:5", "ether5", { source: "device", running: 0 })] } : {}), "dev:1");
  assert.equal(veloce(false).albero.padri["dev:9"], "dev:3", "il più veloce, anche contro un cavo di fiducia migliore");
  assert.equal(veloce(true).albero.padri["dev:9"], "dev:2", "un cavo giù perde, anche se più veloce");
});

for (const nome of ["topologia-cliente-a.json", "topologia-domarc.json"]) {
  test(`${nome}: sui dati anonimi l'albero è un albero (nessun giro, ogni padre è nell'albero) e stessi dati danno lo stesso albero (I39)`, () => {
    const t1 = { macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) } as TopologyModelInput;
    const mod = buildTopologyModel(t1);
    const a = costruisciModelloCavi(ingresso(t1), mod, { testaScelta: null });
    const b = costruisciModelloCavi(ingresso(t1), mod, { testaScelta: null });
    assert.deepEqual(a.albero.padri, b.albero.padri);
    assert.deepEqual(a.collegamenti.map((c) => c.id), b.collegamenti.map((c) => c.id));
    const padri = a.albero.padri;
    assert.ok(Object.keys(padri).length > 0 && a.albero.testa !== null && padri[a.albero.testa] === null);
    for (const id of Object.keys(padri)) {
      const visti = new Set<string>();
      for (let x: string | null = id; x !== null; x = padri[x] ?? null) {
        assert.ok(x in padri, `${x} è nell'albero`);
        assert.ok(!visti.has(x), `giro attraverso ${x}`);
        visti.add(x);
      }
    }
  });
}

// §13.7.6 punto 4 (T3, Task 3 e 5): le radio sono nodi sulla linea. Il router sente sulla stessa porta le due radio di un
// ponte; la vicina è registrata server, la lontana è un host che la classificazione dice client; dall'altra parte il router
// della sede 2 sente la lontana. Prima la vicina era una foglia e il router della sede 2 restava senza padre. Il Task 3 dà
// la classe ai capi (`ponti`); passa quando il Task 5 mette `ponti` nel Prim.
test("§13.7.6 punto 4: un capo di un ponte radio classificato server fa da ponte", { todo: "Task 5: ponti nel Prim" }, () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(5, { name: "RADIO-V", device_type: "server", vendor: "mikrotik" }), dev(7, { name: "RTR-S2", device_type: "router", ...mk })],
    [],
    { hosts: [host(60, { ip: "10.1.0.60", hostname: "RADIO-L", classification: "workstation" })] },
  );
  const m = ombra(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-V", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-L", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 7, local_port: "ether1", remote_device_name: "RADIO-L", remote_port: "bridge/ether2", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ] }), "dev:1");
  assert.deepEqual([m.albero.padri["dev:7"], m.albero.padri["host:60"], m.albero.padri["dev:5"]], ["host:60", "dev:5", "dev:1"]);
});
