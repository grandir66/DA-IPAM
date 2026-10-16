// Le prove neutre per porta (spec topologia §13.4.4) dall'ingresso del modello per cavo: tutte le fonti, l'ultimo giro, la
// porta con l'indice del lettore, il tipo letto che vince sul nome, il tunnel, l'uplink del controller, il partner del fascio,
// l'elenco delle porte con la precedenza del §13.5.7. Righe e nomi inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { addNodeMacs, buildNodeIndex } from "@/lib/topology/node-index";
import { comeDi } from "@/lib/topology/links";
import { elenchiCavi, indiceFatti, proveDaInput, type IngressoCavi } from "@/lib/topology/cavi/prove";
import { baseInput, dev, host } from "./support/righe";
import { porte } from "./support/reti-campione";
import { fp, ingresso, vic } from "./support/cavi";

function prove(ing: IngressoCavi, macs: Record<string, string[]> = {}) {
  const idx = buildNodeIndex(ing.t1.devices, ing.t1.hosts, ing.t1.knownMacs, ing.t1.neighbors);
  for (const [n, m] of Object.entries(macs)) addNodeMacs(idx, n, m);
  return proveDaInput(ing, { idx, elenchi: elenchiCavi(ing), come: comeDi(ing.t1), fatti: indiceFatti(ing) }, buildTopologyModel(ing.t1));
}
const mk = { vendor: "mikrotik", via: "ssh" } as const;

test("tutte le fonti; la porta locale con l'indice del lettore (SNMP): «i:N»", () => {
  const t1 = baseInput({ devices: [dev(2, { vendor: "cisco", via: "snmp_v2" }), dev(3)] });
  const p = prove(ingresso(t1, { vicini: [vic({ device_id: 2, local_port: "Gi1/0/24", local_port_index: 10124, remote_device_name: "SW-3", remote_port: "Port 5", source: "snmp" })] }));
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].tipo, p[0].da.chiave, p[0].altro?.nodo, p[0].lettore, p[0].classe], ["cavo", "i:10124", "dev:3", "snmp", "annuncio_collegamento"]);
});

test("il tipo letto vince sul nome: un nome scelto con il tipo «physical» letto è una porta fisica (§13.6.1)", () => {
  const t1 = baseInput({ devices: [dev(1, { device_type: "router", ...mk }), dev(3)] });
  const senza = prove(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "uplink-core", remote_device_name: "SW-3", source: "device" })] }));
  assert.equal(senza[0].da.fisica, null, "senza lettura un nome scelto resta non noto");
  const con = prove(ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "uplink-core", remote_device_name: "SW-3", source: "device" })],
    fattiPorta: [fp(1, "n:uplink-core", "uplink-core", { source: "device", in_bridge: 0 })],
  }));
  assert.deepEqual([con[0].da.fisica, con[0].da.nelBridge], [true, false]);
});

test("un tunnel: dal tipo letto, o dal nome di fabbrica; mai un cavo", () => {
  const t1 = baseInput({ devices: [dev(1, { device_type: "router", ...mk }), dev(2, { device_type: "router", ...mk })] });
  const letto = prove(ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "verso-sede2", remote_device_name: "SW-2", protocol: "mndp", source: "device" })],
    fattiPorta: [fp(1, "n:verso-sede2", "verso-sede2", { source: "device", if_kind: "tunnel" })],
  }));
  assert.equal(letto[0].tipo, "tunnel");
  const fabbrica = prove(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "eoip-tunnel1", remote_device_name: "SW-2", protocol: "mndp", source: "device" })] }));
  assert.equal(fabbrica[0].tipo, "tunnel");
});

test("l'uplink del controller: una prova di verso dalla porta per indice; per un gateway la porta è la WAN", () => {
  const t1 = baseInput({
    devices: [
      dev(1, { device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }),
      dev(2, { controller_mac: "02:00:d0:00:02:00" }),
    ],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "25000 Mbps"]])],
  });
  const p = prove(ingresso(t1, { uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }] })).filter((x) => x.classe === "uplink");
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].da.nodo, p[0].da.chiave, p[0].altro?.nodo, p[0].altro?.chiave, p[0].gateway, p[0].origine], ["dev:1", "i:10", "dev:2", "i:25", true, "lldp_uplink"]);
});

test("il partner LACP di un membro è una prova del fascio e del suo apparato (abbinato coi MAC)", () => {
  const t1 = baseInput({ devices: [dev(3, { device_type: "router", ...mk }), dev(9, { name: "NAS-1", device_type: "nas" })] });
  const p = prove(ingresso(t1, { fattiPorta: [fp(3, "n:sfp-sfpplus9", "sfp-sfpplus9", { source: "device", lag_group: "bond3", lag_partner: "02:00:A0:10:8C:14" })] }), { "dev:9": ["02:00:A0:10:8C:14"] });
  assert.deepEqual(p.map((x) => [x.classe, x.da.nodo, x.altro?.nodo, x.appartiene?.fascio]), [["fascio", "dev:3", "dev:9", "bond3"]]);
});

test("Casi da non dimenticare 5: l'elenco delle porte segue la precedenza controller, poi SNMP, poi switch_ports", () => {
  const t1 = baseInput({ devices: [dev(2)], ports: porte(2, [[1, "Port 1", "1000 Mbps"]]) });
  const e = elenchiCavi(ingresso(t1, {
    fattiPorta: [fp(2, "i:7", "SFP+ 7", { source: "snmp" }), fp(2, "i:9", "SFP+ 9", { source: "controller" })],
  }));
  assert.deepEqual([...(e.get("dev:2")?.perIndice.keys() ?? [])], [9], "il controller vince");
  const s = elenchiCavi(ingresso(t1, { fattiPorta: [fp(2, "i:7", "SFP+ 7", { source: "snmp" })] }));
  assert.deepEqual([...(s.get("dev:2")?.perIndice.keys() ?? [])], [7]);
  assert.deepEqual([...(elenchiCavi(ingresso(t1)).get("dev:2")?.perIndice.keys() ?? [])], [1]);
});

test("I37: le prove dicono chi ha letto con le parole neutre, mai la marca", () => {
  const t1 = baseInput({ devices: [dev(2), dev(3)] });
  const p = prove(ingresso(t1, { vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3" })] }));
  assert.equal(p[0].lettore, "controller");
});

// ── T3.6: l'abbinamento «telaio, nome, IP» (spec §13.6.4, ultimo punto; I15) ─────────────────────────────────────────────
// Due router inventati; l'indirizzo VRRP 10.1.0.1 (un host col MAC virtuale) l'inventario l'ha messo su RTR-2 con l'identità
// fisica. Uno switch sente RTR-1 con una riga sola: il telaio è di RTR-1, l'IP è quello del VRRP. Il modello di oggi
// (resolveNode, IP per primo) la dava a RTR-2; il modello di oggi resta così (spento = T1, piano di T3, «Scelte» 1).
const R1 = "02:00:00:00:01:00";
const dueRouter = () => baseInput({
  devices: [
    dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1", ...mk }),
    dev(2, { name: "RTR-2", device_type: "router", host: "10.0.0.2", physical_device_id: 7, ...mk }),
    dev(3, { name: "SW-3" }),
  ],
  knownMacs: [{ device_id: 1, mac: R1 }],
  hosts: [host(50, { ip: "10.1.0.1", mac: "00:00:5E:00:01:01", physical_device_id: 7, classification: "router" })],
});
const sente = (over: Partial<Parameters<typeof vic>[0]>) => prove(ingresso(dueRouter(), { vicini: [vic({ device_id: 3, local_port: "Port 4", ...over })] }));

test("T3.6 (I15): il telaio prima dell'IP — una riga sola col MAC di RTR-1 e l'IP del VRRP messo su RTR-2 va a RTR-1", () => {
  assert.equal(buildTopologyModel(dueRouter()).nodes.find((n) => n.addresses.some((a) => a.ip === "10.1.0.1"))?.id, "dev:2", "l'IP del VRRP sta su RTR-2");
  // il nome LLDP è diverso da quello in inventario (§13.6.4): decide il telaio
  const p = sente({ remote_device_name: "rtr-uno", remote_mac: R1, remote_ip: "10.1.0.1", remote_port: "ether1" });
  assert.equal(p[0].altro?.nodo, "dev:1");
});

test("T3.6: l'IP solo dalle righe con una porta remota fisica; prima il nome, se identifica", () => {
  assert.equal(sente({ remote_ip: "10.1.0.1", remote_port: "vrrp1" })[0].altro, null, "porta remota logica e solo l'IP: nessun abbinamento");
  assert.equal(sente({ remote_device_name: "10.1.0.1", remote_port: "vrrp1" })[0].altro, null, "un IP al posto del nome è un IP: stessa regola");
  assert.equal(sente({ remote_device_name: "RTR-1", remote_ip: "10.1.0.1", remote_port: "vrrp1" })[0].altro?.nodo, "dev:1", "il nome che identifica");
  assert.equal(sente({ remote_ip: "10.0.0.1", remote_port: "ether1" })[0].altro?.nodo, "dev:1", "da una porta fisica l'IP vale ancora");
});

test("§13.8.2: la prova dice se l'annuncio ha il nome di sistema; un MAC al posto del nome non lo è", () => {
  assert.equal(sente({ remote_device_name: "rtr-uno", remote_mac: R1, remote_port: "ether1" })[0].conNome, true);
  assert.equal(sente({ remote_device_name: "", remote_mac: R1, remote_port: "ether1" })[0].conNome, false);
  assert.equal(sente({ remote_device_name: R1, remote_mac: R1, remote_port: "ether1" })[0].conNome, false);
});

// Lo stesso telaio sulla stessa porta da due annunci: l'LLDP del firmware della scheda (senza nome, capacità senza senso) e
// quello del sistema (col nome). Le righe sono in ordine di nome, e la riga senza nome viene prima: le capacità della prova
// sono quelle dell'annuncio col nome (§13.8.2, «solo da un annuncio col nome di sistema»).
test("§13.8.2: le capacità della prova vengono dall'annuncio col nome di sistema, se c'è", () => {
  const p = prove(ingresso(dueRouter(), { vicini: [
    vic({ device_id: 3, local_port: "Port 4", remote_mac: R1, remote_port: "ether1", remote_caps: "bridge,docsis,telephone" }),
    vic({ device_id: 3, local_port: "Port 4", remote_device_name: "rtr-uno", remote_mac: R1, remote_port: "ether1", remote_caps: "bridge,router" }),
  ] }));
  assert.deepEqual(p.map((x) => [x.altro?.nodo, x.capacita, x.conNome]), [["dev:1", "bridge,router", true]]);
});
