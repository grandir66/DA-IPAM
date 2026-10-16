// Criteri G11-G15 (spec topologia §13.3.0) sulle cinque famiglie di reti-campione, col modello per cavo (Task 12 del piano di T3):
// una prova per criterio e per famiglia, coi titoli «G11 · famiglie 1, 2, 3 · …» come in `reti-campione.test.ts`, sui fatti di T2 nella
// forma dei lettori (quelli di `cavi-ombra.test.ts` per le famiglie 1 e 2, i fatti SNMP per la 3, le VM per la 4, il salto radio per
// la 5). G16 sta in `cavi-quattro-letture.test.ts`. I fatti che servono a un caso sono aggiunti alla rete della famiglia: la tabella
// attesa di T1 (`reti-campione.test.ts`) non cambia. Un difetto del modello trovato qui è un `todo` col perché.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import type { Collegamento } from "@/lib/topology/cavi/collegamenti";
import type { FattoPorta, IngressoCavi, ViciniCaviRow } from "@/lib/topology/cavi/prove";
import { altreMarcheSnmp, conHypervisor, mista, porte, soloMikrotik } from "./support/reti-campione";
import { fb, fp, ingresso, vic } from "./support/cavi";
import { ingMikrotik, ingUnifi } from "./support/famiglie-cavi";
import { dev } from "./support/righe";

const mod = (i: IngressoCavi) => modelloMappaDaIngresso(i, { testaScelta: null }).m;
const fra = (m: ReturnType<typeof mod>, x: string, y: string) => m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));
const riassunto = (cs: Collegamento[]) => cs.map((c) => [c.genere, c.stato, c.fiducia, c.membri?.length]);
const aggiungi = (i: IngressoCavi, vicini: ViciniCaviRow[], fatti: FattoPorta[] = []): IngressoCavi =>
  ({ ...i, vicini: [...i.vicini, ...vicini], fattiPorta: [...i.fattiPorta, ...fatti] });

// ─── G11 · il fascio è una linea sola ───────────────────────────────────────────────────────────────────────────────────────

test("G11 · famiglie 1, 2, 3 · famiglia 1: il fascio bond1 è una linea sola da 2 × 25G, provata dal partner LACP, coi membri nel bridge", () => {
  const m = mod(ingMikrotik());
  const f = fra(m, "dev:3", "dev:11");
  assert.deepEqual(riassunto(f), [["fascio", "inoltra", "certo", 2]]);
  assert.equal(f[0].velocitaMbps, 50000, "la somma dei membri");
  assert.equal(f[0].fascioDedotto, false, "provato, non dedotto");
  assert.ok(f[0].prove.some((p) => p.classe === "fascio"), "c'è la prova del partner LACP");
  assert.deepEqual(f[0].membri?.map((x) => x.stato), ["inoltra", "inoltra"]);
});

/** La stessa coppia con due cavi e il fascio che nessuno scrive: né il partner né il gruppo. Solo se i due capi parlano lo spanning tree (I66) è un fascio. */
const senzaProvaDelFascio = (stp: boolean): IngressoCavi => {
  const i = ingMikrotik();
  const membri = new Set(["n:sfp28-1", "n:sfp28-2"]);
  const fatti = i.fattiPorta.map((f) => (membri.has(f.port_key) ? { ...f, lag_group: null, lag_partner: null, ...(stp ? { stp_state: "forwarding", stp_role: "designated" } : {}) } : f));
  return { ...i, fattiPorta: fatti };
};

test("G11 · famiglie 1, 2, 3 · famiglia 1: senza la prova del fascio, due cavi in inoltro con lo spanning tree fra i due capi sono un fascio dedotto; senza spanning tree sono due linee (I66)", () => {
  const dedotto = fra(mod(senzaProvaDelFascio(true)), "dev:3", "dev:11");
  assert.deepEqual(riassunto(dedotto), [["fascio", "inoltra", "certo", 2]]);
  assert.equal(dedotto[0].fascioDedotto, true);
  const due = fra(mod(senzaProvaDelFascio(false)), "dev:3", "dev:11");
  assert.deepEqual(riassunto(due), [["cavo", "inoltra", "certo", undefined], ["cavo", "inoltra", "certo", undefined]], "porte di bordo, nessun BPDU: due linee");
});

/** Famiglia 2 con un secondo cavo fra l'aggregazione e lo switch da 48: il controller dice `lag_idx` su un membro. */
const unifiConDueCavi = (lag: boolean): IngressoCavi => aggiungi(ingUnifi(), [
  vic({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "USW-48", remote_mac: "02:00:d0:00:03:00", remote_port: "SFP+ 2", source: "unifi" }),
  vic({ device_id: 3, local_port: "SFP+ 2", remote_device_name: "USW-AGG", remote_mac: "02:00:d0:00:02:00", remote_port: "SFP+ 2", source: "unifi" }),
], lag ? [fp(2, "i:1", "SFP+ 1", { lag_group: "lag:1" }), fp(3, "i:49", "SFP+ 1", { lag_group: "lag:1" }), fp(2, "i:2", "SFP+ 2", { lag_group: "lag:1" }), fp(3, "i:50", "SFP+ 2", { lag_group: "lag:1" })]
  : [fp(2, "i:1", "SFP+ 1", { stp_state: "forwarding" })]);

test("G11 · famiglie 1, 2, 3 · famiglia 2: il fascio provato dal controller (`lag_idx`) è una linea sola; i due cavi senza spanning tree sono due linee", () => {
  const f = fra(mod(unifiConDueCavi(true)), "dev:2", "dev:3");
  assert.deepEqual(riassunto(f), [["fascio", "inoltra", "certo", 2]]);
  assert.equal(f[0].fascioDedotto, false);
  assert.equal(f[0].velocitaMbps, 20000);
  const due = fra(mod(unifiConDueCavi(false)), "dev:2", "dev:3");
  assert.deepEqual(due.map((c) => c.genere), ["cavo", "cavo"], "senza prova del fascio e senza spanning tree sui due capi: due linee");
});

test("G11 · famiglie 1, 2, 3 · famiglia 2: WAN e LAN di un gateway del controller non sono un fascio (I66)", () => {
  const m = mod(ingUnifi());
  const f = fra(m, "dev:1", "dev:2");
  assert.deepEqual(f.map((c) => [c.genere, c.wan === true]).sort(), [["cavo", false], ["cavo", true]], "due linee: la LAN e la WAN");
});

/** Famiglia 3 con un secondo cavo CDP fra i due Cisco: Po1 sui due capi (`ifType` 161), membri nel gruppo «if:<indice>». */
const snmpConDueCavi = (modo: "po1" | "stp" | "bordo"): IngressoCavi => {
  const t1 = altreMarcheSnmp();
  t1.ports = [...(t1.ports ?? []), ...porte(2, [[2, "Te1/1/2", "10000 Mbps"], [50, "Po1", null]]), ...porte(3, [[2, "Te1/1/2", "10000 Mbps"], [60, "Po1", null]])];
  const s = (n: number, i: number, nome: string, over: Partial<FattoPorta> = {}) => fp(n, `i:${i}`, nome, { source: "snmp", ...over });
  const fatti = modo === "po1"
    ? [s(2, 1, "Te1/1/1", { lag_group: "if:50" }), s(2, 2, "Te1/1/2", { lag_group: "if:50" }), s(2, 50, "Po1", { if_kind: "lag" }),
      s(3, 1, "Te1/1/1", { lag_group: "if:60" }), s(3, 2, "Te1/1/2", { lag_group: "if:60" }), s(3, 60, "Po1", { if_kind: "lag" })]
    : modo === "stp" ? [s(2, 1, "Te1/1/1", { stp_state: "forwarding" }), s(2, 2, "Te1/1/2", { stp_state: "forwarding" }), s(3, 1, "Te1/1/1", { stp_state: "forwarding" }), s(3, 2, "Te1/1/2", { stp_state: "forwarding" })]
    : [];
  return ingresso(t1, { vicini: [vic({ device_id: 2, local_port: "Te1/1/2", remote_device_name: "SW-C2", remote_port: "Te1/1/2", protocol: "cdp", source: "snmp" }),
    vic({ device_id: 3, local_port: "Te1/1/2", remote_device_name: "SW-C1", remote_port: "Te1/1/2", protocol: "cdp", source: "snmp" })], fattiPorta: fatti });
};

test("G11 · famiglie 1, 2, 3 · famiglia 3: «Po1» (ifType 161) è un fascio provato; due cavi con lo spanning tree sui due capi, un fascio dedotto; senza, due linee", () => {
  const po1 = fra(mod(snmpConDueCavi("po1")), "dev:2", "dev:3");
  assert.deepEqual(riassunto(po1), [["fascio", "inoltra", "certo", 2]]);
  assert.equal(po1[0].fascioDedotto, false);
  const stp = fra(mod(snmpConDueCavi("stp")), "dev:2", "dev:3");
  assert.deepEqual([stp[0].genere, stp[0].fascioDedotto], ["fascio", true]);
  const bordo = fra(mod(snmpConDueCavi("bordo")), "dev:2", "dev:3");
  assert.deepEqual(bordo.map((c) => c.genere), ["cavo", "cavo"]);
});

// ─── G12 · lo spanning tree: porta radice, bloccato, disabled che inoltra, giù che vince ──────────────────────────────────────

test("G12 · famiglie 2, 3, 5 · famiglia 2: `disabled` su una porta accesa vuol dire senza spanning tree — la porta inoltra e sceglie il padre, nessuna anomalia (I67)", () => {
  const m = mod(ingUnifi());
  const c = fra(m, "dev:3", "dev:4");
  assert.deepEqual(riassunto(c), [["cavo", "inoltra", "certo", undefined]]);
  assert.equal(m.albero.padri["dev:4"], "dev:3");
  assert.deepEqual(m.albero.anomalie, []);
});

test("G12 · famiglie 2, 3, 5 · famiglia 2: ogni stato su una porta giù vale «giù», mai «bloccato» (I25, I67)", () => {
  for (const stp of ["forwarding", "blocking", "discarding"]) {
    const i = ingUnifi();
    i.fattiPorta = [...i.fattiPorta.filter((f) => f.device_id !== 5), fp(5, "i:1", "Port 1", { running: 0, stp_state: stp, stp_role: stp === "forwarding" ? null : "alternate" })];
    const c = fra(mod(i), "dev:3", "dev:5");
    assert.deepEqual(c.map((x) => [x.stato, x.giuSu?.nodo]), [["giu", "dev:5"]], `porta giù con «${stp}»`);
  }
  const acceso = ingUnifi();
  acceso.fattiPorta = [...acceso.fattiPorta, fp(5, "i:1", "Port 1", { running: 1, stp_state: "discarding", stp_role: "alternate" })];
  assert.equal(fra(mod(acceso), "dev:3", "dev:5")[0].stato, "bloccato", "il blocco su una porta accesa è «bloccato»");
});

/** Famiglia 3 con un secondo cavo fra il router e lo switch del secondo piano: la porta radice dello switch dice quale è il suo padre. */
const snmpConPercorsoDoppio = (bloccato: boolean): IngressoCavi => {
  const t1 = altreMarcheSnmp();
  t1.ports = [...(t1.ports ?? []), ...porte(1, [[2, "Gi0/0/2", "1000 Mbps"]]), ...porte(3, [[3, "Gi1/0/3", "1000 Mbps"]])];
  const l = (a: number, pa: string, nome: string, pb: string) => vic({ device_id: a, local_port: pa, remote_device_name: nome, remote_port: pb, source: "snmp" });
  return ingresso(t1, {
    vicini: [l(1, "Gi0/0/2", "SW-C2", "Gi1/0/3"), l(3, "Gi1/0/3", "RTR-C", "Gi0/0/2")],
    fattiPorta: bloccato ? [fp(3, "i:3", "Gi1/0/3", { source: "snmp", stp_state: "discarding", stp_role: "alternate" })] : [],
    fattiBridge: [fb(3, { source: "snmp", bridge_id: "32768.02:00:00:00:00:33", root_id: "0.02:00:00:00:00:01", root_port: bloccato ? "Te1/1/1" : "Gi1/0/3" })],
  });
};

test("G12 · famiglie 2, 3, 5 · famiglia 3: il padre è il vicino sulla porta radice (anche a 1G contro 10G); un cavo bloccato non fa da padre se c'è un percorso che inoltra (I24)", () => {
  const radice = mod(snmpConPercorsoDoppio(false));
  assert.equal(radice.albero.padri["dev:3"], "dev:1", "la porta radice Gi1/0/3 porta a RTR-C, anche se il percorso da SW-C1 è a 10G");
  const fermo = mod(snmpConPercorsoDoppio(true));
  assert.equal(fermo.albero.padri["dev:3"], "dev:2", "porta radice Te1/1/1; il cavo diretto dal router è bloccato");
  assert.equal(fra(fermo, "dev:1", "dev:3")[0].stato, "bloccato");
});

test("G12 · famiglie 2, 3, 5 · famiglia 5: la porta giù con «forwarding» è «giù»; il ponte tra uno switch del controller e uno di un'altra marca non cambia l'albero", () => {
  const i = ingresso(mista());
  const m0 = mod(i);
  const su = fra(m0, "dev:2", "dev:3");
  assert.equal(su[0].stato, "inoltra");
  const giu = mod({ ...i, fattiPorta: [fp(3, "i:2", "Port 2", { running: 0, stp_state: "forwarding" })] });
  assert.deepEqual(fra(giu, "dev:2", "dev:3").map((c) => c.stato), ["giu"]);
  assert.equal(m0.albero.padri["dev:4"], "dev:3", "lo switch SNMP sta sotto lo switch del controller");
});

// ─── G13 · instradato e WAN del gateway ───────────────────────────────────────────────────────────────────────────────────────

test("G13 · famiglie 1, 2, 5 · famiglia 1: i due cavi diretti del secondo router, fuori dal bridge, sono instradati e certi; il router sta sotto l'aggregazione, nel bridge (I23)", () => {
  const m = mod(ingMikrotik());
  const diretti = fra(m, "dev:1", "dev:3").filter((c) => c.genere === "cavo");
  assert.deepEqual(diretti.map((c) => [c.stato, c.fiducia]), [["instradato", "certo"], ["instradato", "certo"]]);
  assert.equal(m.albero.padri["dev:1"], "dev:11", "un instradato non batte un percorso nel bridge");
});

test("G13 · famiglie 1, 2, 5 · famiglia 2: l'uplink del controller del gateway è la sua WAN — instradata, senza verso; il padre è dal cavo della LAN (I68)", () => {
  const m = mod(ingUnifi());
  const wan = fra(m, "dev:1", "dev:2").filter((c) => c.wan);
  assert.deepEqual(wan.map((c) => [c.stato, c.verso]), [["instradato", null]]);
  assert.equal(m.albero.padri["dev:2"], "dev:1");
  assert.notEqual(m.albero.via.get("dev:2")?.wan, true, "il padre non è la WAN");
});

test("G13 · famiglie 1, 2, 5 · famiglia 5: la WAN dei due router è un segmento con il modem — nessun cavo fra i router; i due router hanno ognuno il suo cavo verso lo switch", () => {
  const m = mod(ingresso(mista()));
  assert.equal(fra(m, "dev:1", "dev:2").filter((c) => c.genere === "cavo").length, 0, "nessun cavo router ↔ router");
  assert.deepEqual(m.segmenti.filter((s) => s.id === "seg:1:1").map((s) => [s.altriApparati, s.membri.map((p) => p.nodo).sort()]), [[0, ["dev:1", "dev:2", "host:61"]]], "i due router e il modem");
  assert.deepEqual([fra(m, "dev:1", "dev:3").length, fra(m, "dev:2", "dev:3").length], [1, 1]);
});

// ─── G14 · tunnel, ponti radio, senza fili ───────────────────────────────────────────────────────────────────────────────────

/** Famiglia 1 con l'altro capo dell'EoIP censito (RTR-SEDE2): un tunnel solo se è acceso. */
const conEoip = (acceso: number | null): IngressoCavi => {
  const t1 = soloMikrotik();
  t1.devices = [...t1.devices, dev(7, { name: "RTR-SEDE2", device_type: "router", host: "10.9.0.1", vendor: "mikrotik", via: "ssh" })];
  t1.knownMacs = [...t1.knownMacs, { device_id: 7, mac: "02:00:a9:00:00:01" }];
  const i = ingresso(t1);
  return acceso === null ? i : { ...i, fattiPorta: [fp(3, "n:eoip-sede2", "eoip-sede2", { source: "device", if_kind: "tunnel", running: acceso })] };
};

test("G14 · famiglie 1, 5 · famiglia 1: un annuncio sull'EoIP dà un tunnel — mai un cavo — solo se il tunnel è acceso; spento o non letto, nessuna linea (I29, I69)", () => {
  const acceso = mod(conEoip(1));
  assert.deepEqual(fra(acceso, "dev:3", "dev:7").map((c) => [c.genere, c.fiducia]), [["tunnel", "probabile"]]);
  assert.equal(acceso.collegamenti.some((c) => c.genere === "cavo" && [c.a.nodo, c.b.nodo].includes("dev:7")), false, "mai un cavo");
  for (const [caso, ing] of [["spento", conEoip(0)], ["non letto", conEoip(null)]] as const) {
    assert.deepEqual(fra(mod(ing), "dev:3", "dev:7"), [], `tunnel ${caso}: nessuna linea`);
  }
});

test("G14 · famiglie 1, 5 · famiglia 1: il tunnel WireGuard verso un router non censito non è un cavo e non è una linea; il router virtuale sente la testa solo come stessa rete", () => {
  const m = mod(ingMikrotik());
  assert.equal(m.collegamenti.some((c) => c.genere === "tunnel"), false, "l'altro capo non è censito");
  assert.equal(m.collegamenti.some((c) => [c.a.nodo, c.b.nodo].includes("dev:51") && c.genere === "cavo"), false, "la VM router non ha cavi: sta dentro il suo hypervisor");
});

/**
 * Famiglia 5 con il ponte radio come lo scrivono i lettori di T2: il router sente sulla stessa porta le due radio, tutte e due con la
 * capacità «bridge», la lontana da un'interfaccia senza fili; il router della sede sente la lontana. (Le righe di T1 non hanno le
 * capacità, e la porta del router sentiva la radio vicina e il router della sede: un segmento.)
 */
const mistaConPonte = (): IngressoCavi => {
  const i = ingresso(mista());
  const radio = (r: ViciniCaviRow) => (r.remote_mac === "02:00:f5:00:71:01" ? { ...r, remote_caps: "bridge", remote_port: "bridge/ether1" }
    : r.remote_mac === "02:00:f5:00:72:01" ? { ...r, remote_caps: "bridge", remote_port: "bridge/bond1/wlan60-1" } : r);
  const vicini = i.vicini.filter((r) => !(r.device_id === 1 && r.remote_device_name === "RTR-SEDE") && !(r.device_id === 5 && r.remote_device_name === "RTR-M")).map(radio);
  return { ...i, vicini: [...vicini, vic({ device_id: 1, local_port: "ether5,bridge", remote_device_name: "", remote_mac: "02:00:f5:00:72:01", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", remote_platform: "MikroTik", source: "device" })] };
};

test("G14 · famiglie 1, 5 · famiglia 5: le due radio sentite sulla stessa porta sono un salto radio, non un segmento; il router della sede sta oltre il salto", () => {
  const m = mod(mistaConPonte());
  assert.deepEqual(m.collegamenti.filter((c) => c.genere === "radio").map((c) => [c.a.nodo, c.b.nodo].sort()), [["host:71", "host:72"]], "un salto fra le due radio");
  assert.equal(m.segmenti.some((s) => s.membri.some((p) => p.nodo === "dev:1" && p.nome === "ether5")), false, "la porta del ponte non è un segmento");
  assert.equal(m.albero.padri["host:71"], "dev:1");
  assert.equal(m.albero.padri["host:72"], "host:71");
  assert.equal(m.albero.padri["dev:5"], "host:72", "il router della sede sta sotto la radio lontana");
});

test("G14 · famiglie 1, 5 · famiglia 2: un AP in mesh ha un uplink senza fili — un collegamento «senza fili», non un cavo (I47)", () => {
  const m = mod(ingUnifi());
  assert.deepEqual(fra(m, "dev:5", "dev:6").map((c) => [c.genere]), [["senza_fili"]]);
  assert.equal(m.albero.padri["dev:6"], "dev:5");
});

// ─── G15 · router e firewall virtuali dentro l'hypervisor ─────────────────────────────────────────────────────────────────────

test("G15 · famiglie 1, 4 · famiglia 1: il router virtuale è una VM dell'hypervisor — i suoi annunci sono «stessa rete», nessun collegamento col suo hypervisor, l'hypervisor sotto un suo cavo", () => {
  const m = mod(ingMikrotik());
  assert.deepEqual(fra(m, "dev:51", "dev:41"), []);
  assert.equal(m.collegamenti.some((c) => [c.a.nodo, c.b.nodo].includes("dev:51")), false, "la VM non ha nessun collegamento");
  assert.equal(m.albero.padri["dev:41"], "dev:11");
  assert.equal(m.albero.padri["dev:51"], undefined, "le VM non sono nell'albero");
});

test("G15 · famiglie 1, 4 · famiglia 4: il router e il firewall virtuali stanno dentro pve-1 — nessun collegamento fra loro e l'hypervisor (I62); gli hypervisor sono sotto un loro cavo", () => {
  const m = mod(ingresso(conHypervisor()));
  for (const vm of ["dev:51", "dev:52"]) {
    assert.deepEqual(m.collegamenti.filter((c) => [c.a.nodo, c.b.nodo].includes(vm)), [], `${vm}: nessun collegamento`);
  }
  assert.ok(m.albero.padri["dev:41"] && m.albero.padri["dev:42"], "gli hypervisor sono nell'albero");
  assert.ok(!["dev:51", "dev:52"].includes(m.albero.padri["dev:41"]!), "mai sotto una sua VM");
});
