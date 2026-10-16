// Le fixture dedicate di T3 (spec topologia §13.12.2, «In più, fixture dedicate»; Task 12 del piano di T3): reti piccole inventate, ognuna
// per un caso visto sul campo o temuto, scritte nella forma dei lettori. Ogni prova dice i collegamenti, lo stato, la fiducia e i padri
// attesi. Nomi, MAC e VLAN inventati («XQ_7_ABC», «lan-piano2», «PONTE-A»: nessuna regola li conosce, I58). I casi che il modello sbaglia
// sono `todo` col perché; nessuna prova cambia il modello.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import type { Collegamento } from "@/lib/topology/cavi/collegamenti";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import { porte } from "./support/reti-campione";
import { fb, fp, ingresso, ORA_T2, vic } from "./support/cavi";
import { baseInput, dev, host } from "./support/righe";

const mk = { vendor: "mikrotik", via: "ssh" } as const;
const uf = { vendor: "ubiquiti", via: "api" } as const;
const cisco = { vendor: "cisco", via: "snmp_v2" } as const;
const mod = (i: IngressoCavi, testa: string | null = null) => modelloMappaDaIngresso(i, { testaScelta: testa }).m;
const fra = (m: ReturnType<typeof mod>, x: string, y: string) => m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));
/** Genere, stato, fiducia di ogni collegamento della coppia. */
const gsf = (cs: Collegamento[]) => cs.map((c) => [c.genere, c.stato, c.fiducia]);
const chiaviDi = (c: Collegamento, nodo: string) => (c.a.nodo === nodo ? c.a : c.b).chiave;
/** Le righe dei due capi di un cavo fra due MikroTik letti via SSH, nel bridge. */
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string, br = "bridge") => [
  vic({ device_id: a, local_port: `${pa},${br}`, remote_device_name: nomeB, remote_port: `${br}/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},${br}`, remote_device_name: nomeA, remote_port: `${br}/${pa}`, source: "device", remote_platform: "MikroTik" }),
];
const lan = { id: 1, cidr: "10.30.0.0/24", name: "lan", gateway: "10.30.0.1", location_id: null };

// ─── La trappola della radice regionale (I22) ───────────────────────────────────────────────────────────────────────────────

test("I22 · la radice regionale non sceglie e non crea: lo switch RSTP di altra marca dietro il secondo router della regione sta sotto il secondo router", () => {
  // Due MikroTik della stessa regione MSTP (RT-1 radice regionale, RT-2) e uno switch RSTP di altra marca attaccato a RT-2. Lo switch
  // riceve i BPDU dalla radice regionale, quindi il «bridge designato» della sua porta radice è RT-1 anche se fisicamente è su RT-2.
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-REGIONE-1", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "RT-REGIONE-2", device_type: "router", host: "10.30.0.2", ...mk }),
      dev(3, { name: "SW-ALTRA-MARCA", host: "10.30.0.3", ...cisco })],
    networks: [lan], knownMacs: [{ device_id: 1, mac: "02:00:c3:00:01:00" }, { device_id: 2, mac: "02:00:c3:00:02:00" }, { device_id: 3, mac: "02:00:c3:00:03:00" }],
    ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"]]), ...porte(3, [[1, "Gi1/0/1", "1000 Mbps"]])],
    neighbors: [],
  });
  const regione = { region_name: "REGIONE-Y", region_revision: 3, config_digest: "02:00:00:00:00:D2" };
  const ing = ingresso(t1, {
    vicini: [...cavo(1, "ether1", 2, "ether1", "RT-REGIONE-2", "RT-REGIONE-1"),
      vic({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "SW-ALTRA-MARCA", remote_mac: "02:00:c3:00:03:00", remote_port: "Gi1/0/1", source: "device" })],
    fattiBridge: [
      fb(1, { protocol: "mstp", bridge_id: "4096.02:00:C3:00:01:00", root_id: "4096.02:00:C3:00:01:00", ...regione }),
      fb(2, { protocol: "mstp", bridge_id: "32768.02:00:C3:00:02:00", root_id: "4096.02:00:C3:00:01:00", root_port: "ether1", ...regione }),
      fb(3, { source: "snmp", protocol: "rstp", bridge_id: "32768.02:00:C3:00:03:00", root_id: "4096.02:00:C3:00:01:00", root_port: "Gi1/0/1" }),
    ],
    fattiPorta: [fp(3, "i:1", "Gi1/0/1", { source: "snmp", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "4096.02:00:C3:00:01:00" })],
  });
  const m = mod(ing, "dev:1");
  assert.deepEqual(m.collegamenti.map((c) => [c.a.nodo, c.b.nodo].sort().join("|")).sort(), ["dev:1|dev:2", "dev:2|dev:3"], "nessun collegamento nato dal bridge designato");
  assert.deepEqual(gsf(fra(m, "dev:2", "dev:3")), [["cavo", "inoltra", "probabile"]], "visto da RT-2 solo: probabile — il bridge designato indica RT-1, non lo conferma");
  assert.equal(m.albero.padri["dev:3"], "dev:2", "lo switch sta sotto il secondo router, non sotto la radice regionale");
  assert.equal(m.albero.padri["dev:2"], "dev:1");
});

// ─── Uno switch non gestito ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("uno switch non gestito: due apparati sulla porta sono un segmento — nessun cavo dalla porta, il segmento è un oggetto sotto lo switch", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-NONGESTITO", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "SW-GESTITO", host: "10.30.0.2", ...uf, controller_mac: "02:00:c4:00:02:00" })],
    hosts: [host(11, { ip: "10.30.0.11", mac: "02:00:c4:00:0b:01", hostname: "srv-uno", classification: "server" }), host(12, { ip: "10.30.0.12", mac: "02:00:c4:00:0c:01", hostname: "srv-due", classification: "server" })],
    networks: [lan], ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "Port 1", "1000 Mbps"], [5, "Port 5", "1000 Mbps"]])],
    neighbors: [],
  });
  const ing = ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: "SW-GESTITO", remote_mac: "02:00:c4:00:02:00", remote_port: "Port 1", source: "device" }),
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "RT-NONGESTITO", remote_port: "ether1", source: "unifi" }),
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "srv-uno", remote_mac: "02:00:c4:00:0b:01", remote_port: "eno1", source: "unifi" }),
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "srv-due", remote_mac: "02:00:c4:00:0c:01", remote_port: "eno1", source: "unifi" }),
  ] });
  const m = mod(ing);
  assert.deepEqual(m.segmenti.map((s) => [s.id, s.altriApparati, s.membri.map((p) => p.nodo).sort()]), [["seg:2:5", 0, ["dev:2", "host:11", "host:12"]]]);
  assert.equal(m.collegamenti.some((c) => c.genere === "cavo" && [c.a.nodo, c.b.nodo].some((n) => n.startsWith("host:"))), false, "nessun cavo dalla porta del segmento");
  assert.equal(m.albero.padri["seg:2:5"], "dev:2");
});

// ─── L'EoIP nella regione: bloccato nell'albero comune, attivo nell'istanza 1 ────────────────────────────────────────────────

/** Due router della stessa regione MSTP con un EoIP fra loro (e nient'altro): lo stato d'istanza arriva nella forma neutra (`instance`, `vlans`). */
function conEoipInRegione(istanze: boolean, regioneUguale = true): IngressoCavi {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-EOIP-1", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "RT-EOIP-2", device_type: "router", host: "10.30.0.2", ...mk })],
    networks: [lan], ports: [...porte(1, [[1, "eoip-sede2", "1000 Mbps"]]), ...porte(2, [[1, "eoip-sede1", "1000 Mbps"]])], neighbors: [],
  });
  const reg = { region_name: "REGIONE-Y", region_revision: 3, config_digest: "02:00:00:00:00:D2" };
  const altra = regioneUguale ? reg : { ...reg, region_revision: 4 };
  return ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "eoip-sede2,bridge", remote_device_name: "RT-EOIP-2", remote_port: "bridge/eoip-sede1", protocol: "mndp", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 2, local_port: "eoip-sede1,bridge", remote_device_name: "RT-EOIP-1", remote_port: "bridge/eoip-sede2", protocol: "mndp", source: "device", remote_platform: "MikroTik" })],
    fattiPorta: [
      fp(1, "i:1", "eoip-sede2", { source: "device", if_kind: "tunnel", running: 1, stp_state: "discarding", stp_role: "alternate" }),
      fp(2, "i:1", "eoip-sede1", { source: "device", if_kind: "tunnel", running: 1, stp_state: "forwarding" }),
    ],
    fattiBridge: [
      fb(1, { protocol: "mstp", ...reg }), fb(2, { protocol: "mstp", ...altra }),
      ...(istanze ? [fb(1, { protocol: "mstp", instance: 1, root_port: "eoip-sede2", vlans: "20-22", ...reg })] : []),
    ],
  });
}

test("l'EoIP nella regione: bloccato nell'albero comune e attivo nell'istanza 1 è «bloccato_comune», con le VLAN dell'istanza; è una ridondanza, mai il padre", () => {
  const m = mod(conEoipInRegione(true), "dev:1");
  const t = fra(m, "dev:1", "dev:2");
  assert.deepEqual(t.map((c) => [c.genere, c.stato, c.fiducia, c.attivoPerVlan]), [["tunnel", "bloccato_comune", "probabile", [20, 21, 22]]], "il tunnel è probabile (annunci MNDP), non un cavo");
  assert.equal(t[0].istanzeNonLette, undefined);
});

test("l'EoIP nella regione: senza nessuna riga d'istanza (T2-a non c'è) il tunnel è «bloccato», e il collegamento dice che le istanze non sono lette", () => {
  const t = fra(mod(conEoipInRegione(false), "dev:1"), "dev:1", "dev:2");
  assert.deepEqual(t.map((c) => [c.genere, c.stato, c.istanzeNonLette]), [["tunnel", "bloccato", true]]);
});

test("l'EoIP nella regione: due regioni diverse (revisione diversa) non sono la stessa regione — «bloccato» e basta", () => {
  const t = fra(mod(conEoipInRegione(true, false), "dev:1"), "dev:1", "dev:2");
  assert.deepEqual(t.map((c) => [c.stato, c.attivoPerVlan]), [["bloccato", undefined]]);
});

// ─── Ponti radio ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Un router, la radio vicina, la radio lontana e il router della sede 2. `inoltra`: il ponte inoltra l'LLDP e le radio si annunciano; altrimenti ognuna è sentita solo dal suo router. */
function ponte(inoltra: boolean, aMano: LinkOverrideRow[] = []): IngressoCavi {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-PONTE-1", device_type: "router", host: "10.30.0.1", ...mk }), dev(5, { name: "PONTE-A", device_type: "server", vendor: "mikrotik", port_count: 0 }),
      dev(6, { name: "PONTE-B", device_type: "server", vendor: "mikrotik", port_count: 0 }), dev(7, { name: "RT-PONTE-2", device_type: "router", host: "10.30.9.1", ...mk })],
    networks: [lan], neighbors: [], overrides: aMano,
  });
  const r = (device_id: number, nome: string, porta: string) => vic({ device_id, local_port: "ether3,bridge", remote_device_name: nome, remote_port: porta, remote_caps: "bridge", source: "device", remote_platform: "MikroTik" });
  return ingresso(t1, { vicini: inoltra
    ? [r(1, "PONTE-A", "bridge/ether1"), r(1, "PONTE-B", "bridge/bond1/wlan60-1"), r(7, "PONTE-B", "bridge/ether2")]
    : [r(1, "PONTE-A", "bridge/ether1"), r(7, "PONTE-B", "bridge/ether2")] });
}

test("un ponte radio che inoltra l'LLDP e si annuncia: le due radio sulla stessa porta sono un salto (non un segmento); il router della sede sta sotto la radio lontana", () => {
  const m = mod(ponte(true), "dev:1");
  assert.deepEqual(m.segmenti, []);
  assert.deepEqual(gsf(fra(m, "dev:5", "dev:6")), [["radio", "inoltra", "probabile"]]);
  assert.deepEqual(m.albero.padri, { "dev:1": null, "dev:5": "dev:1", "dev:6": "dev:5", "dev:7": "dev:6" });
});

test("un ponte radio che non inoltra l'LLDP, col salto dichiarato a mano: cavi fino alle radio, il salto «senza fili» a mano, la catena fino alla sede", () => {
  const aMano: LinkOverrideRow = { id: 1, action: "add", a_node: "dev:5", a_port: "", b_node: "dev:6", b_port: "", medium: "wireless", created_by: "tecnico", created_at: "2026-10-14 08:00:00" };
  const senza = mod(ponte(false), "dev:1");
  assert.equal(fra(senza, "dev:5", "dev:6").length, 0, "senza correzione il salto non c'è: la sede 2 resta fuori dalla catena");
  const m = mod(ponte(false, [aMano]), "dev:1");
  assert.deepEqual(gsf(fra(m, "dev:5", "dev:6")), [["senza_fili", "inoltra", "a_mano"]]);
  assert.deepEqual(m.albero.padri, { "dev:1": null, "dev:5": "dev:1", "dev:6": "dev:5", "dev:7": "dev:6" });
  assert.ok(m.ponti.has("dev:5") && m.ponti.has("dev:6"), "le radio capo di un salto dichiarato fanno da ponte");
});

// ─── Nomi di porta (I12, I13, I14, I46, I70) ─────────────────────────────────────────────────────────────────────────────────

test("I12 · un 48 porte con «Port 1», «SFP_ 1» e «SFP 1» ha tre porte diverse (indici 1, 49, 51), e «SFP_ 1» è «SFP+ 1» a 10G", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "CORE-48", host: "10.30.0.1", ...uf, controller_mac: "02:00:c5:00:01:00" }), dev(2, { name: "SW-VICINO-A", host: "10.30.0.2", ...uf }), dev(3, { name: "SW-VICINO-B", host: "10.30.0.3", ...uf }),
      dev(4, { name: "SW-VICINO-C", host: "10.30.0.4", ...uf })],
    ports: [...porte(1, [[1, "Port 1", "1000 Mbps"], [49, "SFP+ 1", "10000 Mbps"], [51, "SFP 1", "1000 Mbps"]]), ...porte(2, [[1, "SFP+ 1", "10000 Mbps"]]),
      ...porte(3, [[1, "Port 1", "1000 Mbps"]]), ...porte(4, [[1, "Port 1", "1000 Mbps"]])],
    networks: [lan], neighbors: [],
  });
  const ctrl = (device_id: number, local_port: string, nome: string, remote_port: string) => vic({ device_id, local_port, remote_device_name: nome, remote_port, source: "unifi" });
  const m = mod(ingresso(t1, { vicini: [ctrl(1, "SFP_ 1", "SW-VICINO-A", "SFP+ 1"), ctrl(1, "Port 1", "SW-VICINO-B", "Port 1"), ctrl(1, "SFP 1", "SW-VICINO-C", "Port 1"),
    ctrl(2, "SFP_ 1", "CORE-48", "SFP_ 1"), ctrl(3, "Port 1", "CORE-48", "Port 1"), ctrl(4, "Port 1", "CORE-48", "SFP 1")] }));
  const porta = (altro: string) => chiaviDi(fra(m, "dev:1", altro)[0], "dev:1");
  assert.deepEqual([porta("dev:2"), porta("dev:3"), porta("dev:4")], ["i:49", "i:1", "i:51"]);
  assert.deepEqual(fra(m, "dev:1", "dev:2").map((c) => c.velocitaMbps), [10000]);
});

test("I14 e I70 · due porte con lo stesso nome non si risolvono per nome: porta non nota, e la velocità c'è solo se è la stessa; con l'indice la porta è una", () => {
  const t1 = (v: string) => baseInput({
    devices: [dev(1, { name: "SW-DOPPIO", host: "10.30.0.1", ...uf }), dev(2, { name: "SW-ALTRO", host: "10.30.0.2", ...uf })],
    ports: [...porte(1, [[15, "SFP+ 15", "10000 Mbps"], [16, "SFP+ 15", v]]), ...porte(2, [[1, "Port 1", null]])],   // l'altro capo non dice la velocità: conta solo il nome doppio
    networks: [lan], neighbors: [],
  });
  const riga = (indice: number | null) => vic({ device_id: 1, local_port: "SFP+ 15", local_port_index: indice, remote_device_name: "SW-ALTRO", remote_port: "Port 1", source: "unifi" });
  for (const [v, atteso] of [["10000 Mbps", 10000], ["1000 Mbps", null]] as const) {
    const c = fra(mod(ingresso(t1(v), { vicini: [riga(null)] })), "dev:1", "dev:2")[0];
    assert.equal(chiaviDi(c, "dev:1"), null, "il nome doppio non è una porta");
    assert.equal(c.velocitaMbps, atteso, `due porte a ${v}: ${atteso === null ? "velocità non nota" : "la velocità c'è"}`);
  }
  assert.equal(chiaviDi(fra(mod(ingresso(t1("10000 Mbps"), { vicini: [riga(16)] })), "dev:1", "dev:2")[0], "dev:1"), "i:16", "con l'indice della riga la porta è una");
});

test("«1/1/24» letto col numero: `lldpRemPortId` degli HP/Aruba è «24», e vale la porta d'indice 24 dell'apparato (che ha quel nome), da un capo solo", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-CISCO-A", host: "10.30.0.1", ...cisco }), dev(2, { name: "SW-HP-A", host: "10.30.0.2", vendor: "hp", via: "snmp_v2" })],
    ports: [...porte(1, [[1, "Gi1/0/1", "1000 Mbps"]]), ...porte(2, [[24, "1/1/24", "1000 Mbps"], [25, "1/1/25", "1000 Mbps"]])], networks: [lan], neighbors: [],
  });
  const c = fra(mod(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "Gi1/0/1", local_port_index: 1, remote_device_name: "SW-HP-A", remote_port: "24", source: "snmp" })] }), "dev:1"), "dev:1", "dev:2");
  assert.deepEqual(c.map((x) => [chiaviDi(x, "dev:1"), chiaviDi(x, "dev:2")]), [["i:1", "i:24"]]);
});

test("I13 · «eth0» su uno switch che non ha quella porta non è una porta: più apparati su «eth0» non fanno un segmento", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-NOETH0", host: "10.30.0.1", ...uf })],
    hosts: [host(11, { ip: "10.30.0.11", mac: "02:00:c6:00:0b:01", hostname: "srv-eth-1", classification: "server" }), host(12, { ip: "10.30.0.12", mac: "02:00:c6:00:0c:01", hostname: "srv-eth-2", classification: "server" })],
    ports: porte(1, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"]]), networks: [lan], neighbors: [],
  });
  const m = mod(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "eth0", remote_device_name: "srv-eth-1", remote_mac: "02:00:c6:00:0b:01", remote_port: "eno1", source: "unifi" }),
    vic({ device_id: 1, local_port: "eth0", remote_device_name: "srv-eth-2", remote_mac: "02:00:c6:00:0c:01", remote_port: "eno1", source: "unifi" }),
  ] }));
  assert.deepEqual(m.segmenti, [], "nessun segmento da una porta che l'apparato non ha");
});

test("I46 · un access point sentito con due nomi di porta (eth0, eth1) da uno switch: un cavo solo, la porta dell'AP da completare", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-AP", host: "10.30.0.1", ...uf }), dev(2, { name: "AP-DUE-NOMI", device_type: "access_point", host: "10.30.0.2", ...uf, port_count: 0 })],
    ports: porte(1, [[3, "Port 3", "1000 Mbps"]]), networks: [lan], neighbors: [],
  });
  const m = mod(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "Port 3", remote_device_name: "AP-DUE-NOMI", remote_port: "eth0", remote_mac: "02:00:c7:00:02:00", source: "unifi" }),
    vic({ device_id: 1, local_port: "Port 3", remote_device_name: "AP-DUE-NOMI", remote_port: "eth1", remote_mac: "02:00:c7:00:02:00", source: "unifi" }),
  ] }));
  const c = fra(m, "dev:1", "dev:2");
  assert.equal(c.length, 1, "un cavo solo");
  assert.deepEqual([chiaviDi(c[0], "dev:1"), chiaviDi(c[0], "dev:2")], ["i:3", null], "la porta dell'AP non si sa: due nomi, nessuno vale come chiave");
});

// Correzione del Task 12 di T3 (H12 dell'hub, §13.6.1 passo 5): il nome che un apparato senza elenco dà alla sua porta nella sua
// riga verso uno switch che ne nomina la porta conta fra i nomi visti; diverso da quello annunciato, la porta annunciata è da
// completare e i cavi si fondono. Solo dove i due capi nominano la porta: i nomi che l'apparato dà alle sue porte verso chi non lo
// vede, o verso chi lo vede senza nominarne la porta, non contano.
test("I46 · i due capi danno due nomi alla porta di un apparato senza elenco («eth0» e un pezzo di MAC): un cavo solo, certo; i nomi verso chi non lo vede non contano", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-NOMI", host: "10.30.0.1", ...uf }), dev(2, { name: "AP-NOMI-DUE", device_type: "access_point", host: "10.30.0.2", ...uf, port_count: 0 }),
      dev(3, { name: "RT-SENZA-ELENCO", device_type: "router", host: "10.30.0.3", ...mk, port_count: 0 }), dev(4, { name: "SW-SENZA-NOME", host: "10.30.0.4", ...uf })],
    hosts: [host(11, { ip: "10.30.0.11", mac: "02:00:c9:00:0b:01", hostname: "srv-nomi-1" }), host(12, { ip: "10.30.0.12", mac: "02:00:c9:00:0c:01", hostname: "srv-nomi-2" })],
    ports: [...porte(1, [[3, "Port 3", "1000 Mbps"], [4, "Port 4", "1000 Mbps"]]), ...porte(4, [[1, "Port 1", "1000 Mbps"]])], networks: [lan], neighbors: [],
  });
  const m = mod(ingresso(t1, { vicini: [
    // l'AP: la sua riga dice «eth0», lo switch lo sente con un pezzo di MAC
    vic({ device_id: 1, local_port: "Port 4", remote_device_name: "AP-NOMI-DUE", remote_mac: "02:00:c9:00:02:00", remote_port: "c9:00:02", source: "unifi" }),
    vic({ device_id: 2, local_port: "eth0", remote_device_name: "SW-NOMI", remote_mac: "02:00:c9:00:01:00", remote_port: "", source: "unifi" }),
    // il router: lo switch lo sente su «ether1»; lui non sente lo switch, ma due server da altre porte, e un secondo switch su
    // «ether4», che lo vede senza nominarne la porta
    vic({ device_id: 1, local_port: "Port 3", remote_device_name: "RT-SENZA-ELENCO", remote_mac: "02:00:c9:00:03:00", remote_port: "bridge/ether1", remote_platform: "MikroTik", source: "unifi" }),
    vic({ device_id: 3, local_port: "ether2", remote_device_name: "srv-nomi-1", remote_mac: "02:00:c9:00:0b:01", remote_port: "eno1", source: "device" }),
    vic({ device_id: 3, local_port: "ether3", remote_device_name: "srv-nomi-2", remote_mac: "02:00:c9:00:0c:01", remote_port: "eno1", source: "device" }),
    vic({ device_id: 3, local_port: "ether4", remote_device_name: "SW-SENZA-NOME", remote_mac: "02:00:c9:00:04:00", remote_port: "Port 1", source: "device" }),
    vic({ device_id: 4, local_port: "Port 1", remote_device_name: "RT-SENZA-ELENCO", remote_mac: "02:00:c9:00:03:00", remote_port: "", source: "unifi" }),
  ] }));
  const ap = fra(m, "dev:1", "dev:2");
  assert.deepEqual(ap.map((c) => [chiaviDi(c, "dev:1"), chiaviDi(c, "dev:2"), c.fiducia]), [["i:4", "n:eth0", "certo"]], "una linea sola, la porta dell'AP dalla sua riga, visto dai due capi");
  const rt = fra(m, "dev:1", "dev:3");
  assert.deepEqual(rt.map((c) => [chiaviDi(c, "dev:1"), chiaviDi(c, "dev:3")]), [["i:3", "n:ether1"]], "«ether2», «ether3» e «ether4» del router non sono nomi visti verso di lui: «ether1» resta la sua porta");
  assert.deepEqual(fra(m, "dev:3", "dev:4").map((c) => [chiaviDi(c, "dev:3"), chiaviDi(c, "dev:4"), c.fiducia]), [["n:ether4", "i:1", "certo"]], "il cavo verso il secondo switch, visto dai due capi");
});

// ─── Gateway, cavo spostato, porta tolta dal bridge ──────────────────────────────────────────────────────────────────────────

test("I45 · un uplink del controller con velocità diverse ai due capi accesi dà il verso, non le porte: un collegamento «porte da verificare»", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-PADRE", host: "10.30.0.1", ...uf, controller_mac: "02:00:c8:00:01:00" }),
      dev(2, { name: "SW-FIGLIO", host: "10.30.0.2", ...uf, controller_mac: "02:00:c8:00:02:00", uplink_mac: "02:00:c8:00:01:00", uplink_remote_port: 25, uplink_seen_at: ORA_T2 })],
    ports: [...porte(1, [[25, "SFP28 25", "25000 Mbps"]]), ...porte(2, [[49, "SFP+ 1", "10000 Mbps"]])],
    uplinkPorts: [{ device_id: 2, port_index: 49, port_name: "SFP+ 1" }], networks: [lan], neighbors: [],
  });
  const m = mod(ingresso(t1, { uplink: [{ device_id: 2, uplink_local_port_idx: 49, uplink_source: "lldp_uplink" }] }), "dev:1");
  const c = fra(m, "dev:1", "dev:2");
  assert.deepEqual(c.map((x) => [x.genere, x.porteDaVerificare, x.verso, x.fiducia]), [["cavo", true, "dev:2", "probabile"]]);
  assert.deepEqual([chiaviDi(c[0], "dev:1"), chiaviDi(c[0], "dev:2")], [null, null], "le porte non si prendono dalla prova");
});

/** Una porta di uno switch con il vicino di ieri e quello di oggi (I43): le righe hanno ore diverse. */
function cavoSpostato(giorniFaIlVecchio: number): IngressoCavi {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-PIVOT", host: "10.30.0.1", ...uf }), dev(2, { name: "SW-VECCHIO", host: "10.30.0.2", ...uf }), dev(3, { name: "SW-NUOVO", host: "10.30.0.3", ...uf })],
    ports: [...porte(1, [[5, "Port 5", "1000 Mbps"]]), ...porte(2, [[1, "Port 1", "1000 Mbps"]]), ...porte(3, [[1, "Port 1", "1000 Mbps"]])], networks: [lan], neighbors: [],
  });
  const ieri = new Date(Date.parse("2026-10-13T11:00:00Z") - giorniFaIlVecchio * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  return ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "Port 5", remote_device_name: "SW-VECCHIO", remote_mac: "02:00:c9:00:02:00", remote_port: "Port 1", source: "unifi", timestamp: ieri }),
    vic({ device_id: 1, local_port: "Port 5", remote_device_name: "SW-NUOVO", remote_mac: "02:00:c9:00:03:00", remote_port: "Port 1", source: "unifi", timestamp: ORA_T2 }),
    // i due switch leggono i loro vicini (è la loro prova di ruolo di rete); quello vecchio l'ha letto ieri
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-PIVOT", remote_mac: "02:00:c9:00:01:00", remote_port: "Port 5", source: "unifi", timestamp: ieri }),
    vic({ device_id: 3, local_port: "Port 1", remote_device_name: "SW-PIVOT", remote_mac: "02:00:c9:00:01:00", remote_port: "Port 5", source: "unifi", timestamp: ORA_T2 }),
  ] });
}

test("I43 · un cavo spostato: il vicino di ieri, non visto da più della soglia, e quello nuovo — nessun segmento, il cavo nuovo c'è, il vecchio è «non visto»", () => {
  const m = mod(cavoSpostato(5), "dev:1");
  assert.deepEqual(m.segmenti, []);
  assert.deepEqual([fra(m, "dev:1", "dev:3").map((c) => c.nonVisto), fra(m, "dev:1", "dev:2").map((c) => c.nonVisto)], [[false], [true]]);
  assert.equal(m.albero.padri["dev:3"], "dev:1");
  // controprova: entrambi visti oggi sono davvero due apparati sulla porta, e allora è un segmento
  assert.equal(mod(cavoSpostato(0), "dev:1").segmenti.length, 1);
});

test("I44 · una porta tolta dal bridge non è più nel bridge: lo stesso cavo passa da «inoltra» a «instradato»", () => {
  const t1 = baseInput({ devices: [dev(1, { name: "RT-BRIDGE", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "SW-BRIDGE", host: "10.30.0.2", ...mk })],
    ports: [...porte(1, [[2, "ether2", "1000 Mbps"]]), ...porte(2, [[2, "ether2", "1000 Mbps"]])], networks: [lan], neighbors: [] });
  const con = mod(ingresso(t1, { vicini: cavo(1, "ether2", 2, "ether2", "SW-BRIDGE", "RT-BRIDGE") }), "dev:1");
  const senza = mod(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether2", remote_device_name: "SW-BRIDGE", remote_port: "bridge/ether2", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "RT-BRIDGE", remote_port: "ether2", source: "device", remote_platform: "MikroTik" }),
  ] }), "dev:1");
  assert.deepEqual([con, senza].map((m) => fra(m, "dev:1", "dev:2")[0].stato), ["inoltra", "instradato"]);
});

test("I23 · un instradato non batte un percorso nel bridge, nemmeno se è più veloce: lo switch sta sotto l'altro switch (1G, nel bridge), non sotto il router (10G, fuori dal bridge)", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-I23", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "SW-I23-A", host: "10.30.0.2", ...mk }), dev(3, { name: "SW-I23-B", host: "10.30.0.3", ...mk })],
    networks: [lan], neighbors: [],
    ports: [...porte(1, [[1, "ether1", "1000 Mbps"], [3, "sfp-sfpplus1", "10000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"]]), ...porte(3, [[2, "ether2", "1000 Mbps"], [3, "sfp-sfpplus1", "10000 Mbps"]])],
  });
  const diretto = [
    vic({ device_id: 1, local_port: "sfp-sfpplus1", remote_device_name: "SW-I23-B", remote_port: "BR/sfp-sfpplus1", source: "device", remote_platform: "MikroTik" }),   // fuori dal bridge
    vic({ device_id: 3, local_port: "sfp-sfpplus1,BR", remote_device_name: "RT-I23", remote_port: "sfp-sfpplus1", source: "device", remote_platform: "MikroTik" }),
  ];
  const m = mod(ingresso(t1, { vicini: [...cavo(1, "ether1", 2, "ether1", "SW-I23-A", "RT-I23", "BR"), ...cavo(2, "ether2", 3, "ether2", "SW-I23-B", "SW-I23-A", "BR"), ...diretto] }), "dev:1");
  assert.deepEqual(fra(m, "dev:1", "dev:3").map((c) => [c.stato, c.velocitaMbps]), [["instradato", 10000]]);
  assert.equal(m.albero.padri["dev:3"], "dev:2", "sotto lo switch nel bridge");
});

test("I69 · un annuncio su un tunnel di livello 3 sentito da un capo solo dà un tunnel «probabile» (se l'altro capo è censito e il tunnel è acceso), mai un cavo; la frase dice chi non sente", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-WG-1", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "RT-WG-2", device_type: "router", host: "10.30.9.1", ...mk }), dev(3, { name: "SW-WG", host: "10.30.9.2", ...mk })],
    networks: [lan], neighbors: [], ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"]]), ...porte(3, [[1, "ether1", "1000 Mbps"]])],
  });
  const vicini = [
    vic({ device_id: 1, local_port: "wg-sede2", remote_device_name: "RT-WG-2", remote_ip: "10.30.9.1", remote_port: "wg-sede1", protocol: "mndp", source: "device", remote_platform: "MikroTik" }),
    ...cavo(2, "ether1", 3, "ether1", "SW-WG", "RT-WG-2"),   // RT-WG-2 legge i suoi vicini, e non sente RT-WG-1 sul tunnel
  ];
  const tunnel = (running: number) => [fp(1, "n:wg-sede2", "wg-sede2", { source: "device", if_kind: "tunnel", running })];
  const m = mod(ingresso(t1, { vicini, fattiPorta: tunnel(1) }), "dev:2");
  assert.deepEqual(fra(m, "dev:1", "dev:2").map((c) => [c.genere, c.fiducia, c.unVerso]), [["tunnel", "probabile", true]]);
  assert.ok(fra(m, "dev:1", "dev:2")[0].frasi.some((f) => f.includes("non sente")), "la frase dice chi non sente");
  assert.deepEqual(fra(mod(ingresso(t1, { vicini, fattiPorta: tunnel(0) }), "dev:2"), "dev:1", "dev:2"), [], "spento: nessuna linea");
});

// ─── Dalla lettura dell'hub: bridge scelto, fascio nel bridge, un MAC per interfaccia, CDP inoltrato, nomi a caso ──────────────

test("dall'hub · un bridge col nome scelto e un fascio nel bridge (`porta,bondN,‹bridge›`): il fascio è una linea sola, nel bridge, qualunque nome abbia il bridge (I59)", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-NOMESCELTO", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "SW-FASCIO", host: "10.30.0.2", ...uf })],
    ports: [...porte(1, [[1, "sfp28-1", "25000 Mbps"], [2, "sfp28-2", "25000 Mbps"]]), ...porte(2, [[1, "Port 1", "10000 Mbps"], [2, "Port 2", "10000 Mbps"]])], networks: [lan], neighbors: [],
  });
  const m = mod(ingresso(t1, {
    vicini: [
      vic({ device_id: 1, local_port: "sfp28-1,bond1,XQ_7_ABC", remote_device_name: "SW-FASCIO", remote_port: "Port 1", source: "device" }),
      vic({ device_id: 1, local_port: "sfp28-2,bond1,XQ_7_ABC", remote_device_name: "SW-FASCIO", remote_port: "Port 2", source: "device" }),
    ],
    fattiPorta: [fp(1, "n:sfp28-1", "sfp28-1", { source: "device", lag_group: "bond1", in_bridge: 1 }), fp(1, "n:sfp28-2", "sfp28-2", { source: "device", lag_group: "bond1", in_bridge: 1 })],
  }), "dev:1");
  assert.deepEqual(fra(m, "dev:1", "dev:2").map((c) => [c.genere, c.stato, c.membri?.length, c.velocitaMbps]), [["fascio", "inoltra", 2, 20000]]);
});

test("I60 · lo stesso router con un MAC per interfaccia sulla stessa porta è un apparato solo: nessun segmento; due router diversi col nome di fabbrica sono due", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-OSSERVA", device_type: "router", host: "10.30.0.1", ...mk })], networks: [lan], ports: porte(1, [[1, "ether1", "1000 Mbps"]]), neighbors: [],
  });
  const m = (nomi: [string, string]) => mod(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: nomi[0], remote_mac: "02:00:ca:00:0a:01", remote_port: "ether5", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: nomi[1], remote_mac: "02:00:ca:00:0a:02", remote_port: "ether6", source: "device", remote_platform: "MikroTik" }),
  ] }), "dev:1");
  assert.deepEqual(m(["RT-NONCENSITO", "RT-NONCENSITO"]).segmenti, [], "un router non censito sentito da due interfacce, col nome che identifica: uno");
  assert.equal(m(["MikroTik", "MikroTik"]).segmenti.length, 1, "due apparati col nome di fabbrica: due, un segmento");
});

test("tre righe CDP inoltrate (scritte `mndp`) su un membro di un fascio non contano come apparati: il fascio resta un cavo, nessun segmento", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-CDP", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "SW-CDP", host: "10.30.0.2", ...mk })],
    networks: [lan], ports: [...porte(1, [[1, "sfp28-1", "25000 Mbps"], [2, "sfp28-2", "25000 Mbps"]]), ...porte(2, [[1, "sfp28-1", "25000 Mbps"], [2, "sfp28-2", "25000 Mbps"]])], neighbors: [],
  });
  const inoltrato = (n: number) => vic({ device_id: 1, local_port: "sfp28-1,bond1,BR_CDP", remote_device_name: `SW-DIETRO-${n}`, remote_mac: `02:00:cb:00:0${n}:01`, remote_port: "bridge/ether1", protocol: "mndp", discovered_by: "cdp", source: "device", remote_platform: "Cisco" });
  const m = mod(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "sfp28-1,bond1,BR_CDP", remote_device_name: "SW-CDP", remote_port: "BR_CDP/bond1/sfp28-1", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "sfp28-2,bond1,BR_CDP", remote_device_name: "SW-CDP", remote_port: "BR_CDP/bond1/sfp28-2", source: "device", remote_platform: "MikroTik" }),
    inoltrato(1), inoltrato(2), inoltrato(3),
  ], fattiPorta: [fp(1, "n:sfp28-1", "sfp28-1", { source: "device", lag_group: "bond1" }), fp(1, "n:sfp28-2", "sfp28-2", { source: "device", lag_group: "bond1" })] }), "dev:1");
  assert.deepEqual(m.segmenti, []);
  assert.deepEqual(fra(m, "dev:1", "dev:2").map((c) => [c.genere, c.membri?.length]), [["fascio", 2]]);
});

test("I58 · nomi inventati a caso («XQ_7_ABC», «lan-piano2», «PONTE-A») come porta locale di un MikroTik: mai fisica né logica, nessun cavo dalle righe su quei nomi", () => {
  const t1 = baseInput({ devices: [dev(1, { name: "RT-NOMI", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "SW-NOMI", host: "10.30.0.2", ...mk })],
    networks: [lan], ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"]])], neighbors: [] });
  const sul = (porta: string) => vic({ device_id: 1, local_port: porta, remote_device_name: "SW-NOMI", remote_port: "bridge/ether1", source: "device", remote_platform: "MikroTik" });
  for (const nome of ["XQ_7_ABC", "lan-piano2", "PONTE-A"]) {
    const m = mod(ingresso(t1, { vicini: [sul(`${nome},bridge`), sul(nome)] }), "dev:1");
    assert.deepEqual(m.collegamenti.filter((c) => c.genere === "cavo"), [], `«${nome}»: nessun cavo dalle righe del router`);
  }
  const fisico = mod(ingresso(t1, { vicini: [sul("ether1,bridge")] }), "dev:1");
  assert.equal(fra(fisico, "dev:1", "dev:2").length, 1, "controprova: con il nome di fabbrica il cavo c'è");
});

