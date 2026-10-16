// I collegamenti per cavo (spec topologia §13.7.2-13.7.6, §13.6.3), in ombra: una linea per cavo, la fiducia in parole, lo
// stato dai due capi, i segmenti come oggetti, i fasci, i tunnel solo se accesi, il salto radio. Reti piccole inventate
// (righe come le scrivono i lettori), l'incidente o l'origine nel titolo di ogni prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { capo as capoDi, costruisciCollegamenti, type Collegamento } from "@/lib/topology/cavi/collegamenti";
import { costruisciModelloCavi, preparaCavi } from "@/lib/topology/cavi/modello";
import type { IngressoCavi, Prova } from "@/lib/topology/cavi/prove";
import type { LinkOverrideRow, ModelVmRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";
import { conHypervisor, porte, riga } from "./support/reti-campione";
import { fb, fp, ingresso, ORA_T2, vic } from "./support/cavi";

function collega(ing: IngressoCavi) {
  const t1 = buildTopologyModel(ing.t1);
  const p = preparaCavi(ing, t1);
  return costruisciCollegamenti(p.prove, ing.t1.overrides, p.ctx);
}
const fra = (cs: readonly Collegamento[], x: string, y: string): Collegamento[] =>
  cs.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));
const due = (over: Parameters<typeof baseInput>[0] = {}) => baseInput({
  devices: [dev(2, { name: "SW-2" }), dev(3, { name: "SW-3" }), dev(4, { name: "SW-4" })],
  ports: [...porte(2, [[1, "Port 1", "10000 Mbps"], [5, "Port 5", "1000 Mbps"], [6, "Port 6", "10000 Mbps"]]), ...porte(3, [[2, "Port 2", "10000 Mbps"], [7, "Port 7", "10000 Mbps"]]), ...porte(4, [[3, "Port 3", "1000 Mbps"]])],
  ...over,
});

test("passo 3: dai due capi è certo, da un capo probabile; una linea per cavo con le due porte", () => {
  const unoSolo = collega(ingresso(due(), { vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" })] }));
  const c = fra(unoSolo.collegamenti, "dev:2", "dev:3");
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].genere, c[0].fiducia, c[0].velocitaMbps, [c[0].a.chiave, c[0].b.chiave].sort()], ["cavo", "probabile", 10000, ["i:1", "i:2"]]);
  const dueCapi = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 3, local_port: "Port 2", remote_device_name: "SW-2", remote_port: "Port 1" }),
  ] }));
  assert.equal(fra(dueCapi.collegamenti, "dev:2", "dev:3")[0].fiducia, "certo");
});

test("passo 11: due cavi veri fra gli stessi apparati sono due linee (non un fascio senza lo spanning tree fra loro)", () => {
  const r = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" }),
  ] }));
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:3").map((c) => c.genere), ["cavo", "cavo"]);
});

test("I66: due cavi in inoltro con lo spanning tree attivo fra loro sono un fascio dedotto; il fascio letto è un fascio", () => {
  const vicini = [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" }),
  ];
  const attivo = (d: number, k: string, n: string) => fp(d, k, n, { stp_state: "forwarding" });
  const dedotto = collega(ingresso(due(), { vicini, fattiPorta: [attivo(2, "i:1", "Port 1"), attivo(2, "i:6", "Port 6"), attivo(3, "i:2", "Port 2"), attivo(3, "i:7", "Port 7")] }));
  const f = fra(dedotto.collegamenti, "dev:2", "dev:3");
  assert.deepEqual([f.length, f[0].genere, f[0].membri?.length, f[0].velocitaMbps, f[0].fascioDedotto], [1, "fascio", 2, 20000, true]);
  const letto = collega(ingresso(due(), { vicini, fattiPorta: [fp(2, "i:1", "Port 1", { lag_group: "lag:1" }), fp(2, "i:6", "Port 6", { lag_group: "lag:1" })] }));
  const g = fra(letto.collegamenti, "dev:2", "dev:3");
  assert.deepEqual([g.length, g[0].genere, g[0].fascioDedotto], [1, "fascio", false]);
});

test("I7 e §13.7.3: una porta che sente due apparati è un segmento: id «seg:», un'appartenenza per membro, nessun cavo", () => {
  const r = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-3", remote_port: "Port 7" }),
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-4", remote_port: "Port 3" }),
  ] }));
  assert.equal(r.segmenti.length, 1);
  assert.equal(r.segmenti[0].id, "seg:2:5");
  assert.deepEqual(r.segmenti[0].membri.map((m) => `${m.nodo}|${m.chiave}`).sort(), ["dev:2|i:5", "dev:3|i:7", "dev:4|i:3"]);
  assert.equal(r.collegamenti.filter((c) => c.genere === "cavo").length, 0);
  assert.equal(r.collegamenti.filter((c) => c.genere === "segmento").length, 3);
});

test("I43: un vicino vecchio non fa un segmento", () => {
  const r = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-3", remote_port: "Port 7", timestamp: "2026-10-01 11:00:00" }),
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-4", remote_port: "Port 3" }),
  ] }));
  assert.equal(r.segmenti.length, 0);
  assert.equal(fra(r.collegamenti, "dev:2", "dev:4").length, 1);
});

test("I25 e I67: giù vince su «forwarding»; «disabled» su una porta accesa inoltra; discarding o alternate = bloccato", () => {
  const vicini = [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" })];
  const stato = (f: Parameters<typeof fp>[3]) => fra(collega(ingresso(due(), { vicini, fattiPorta: [fp(2, "i:1", "Port 1", f)] })).collegamenti, "dev:2", "dev:3")[0].stato;
  assert.equal(stato({ running: 0, stp_state: "forwarding" }), "giu");
  assert.equal(stato({ stp_state: "disabled" }), "inoltra");
  assert.equal(stato({ stp_state: "discarding" }), "bloccato");
  assert.equal(stato({ stp_role: "alternate", stp_state: "forwarding" }), "bloccato");
  assert.equal(stato({ in_bridge: 0 }), "instradato");
  const giuDaSwitchPorts = collega(ingresso(due({ ports: porte(2, [[1, "Port 1", "10000 Mbps"]]).map((p) => ({ ...p, status: "down" })) }), { vicini }));
  assert.equal(fra(giuDaSwitchPorts.collegamenti, "dev:2", "dev:3")[0].stato, "giu");
});

test("I5 e I58: da un'interfaccia logica nessun cavo; per un router col traduttore del suo prodotto un nome scelto non è una porta fisica", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(3, { name: "SW-3" })], ports: porte(3, [[2, "Port 2", "1000 Mbps"]]) });
  const vlan = collega(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "vlan20", remote_device_name: "SW-3", remote_port: "Port 2", source: "device" })] }));
  assert.equal(vlan.collegamenti.length, 0);
  const scelto = collega(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "PONTE-A", remote_device_name: "SW-3", remote_port: "Port 2", source: "device" })] }));
  assert.equal(scelto.collegamenti.length, 0, "senza il tipo letto, il nome scelto non dà cavi");
  const letto = collega(ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "PONTE-A", remote_device_name: "SW-3", remote_port: "Port 2", source: "device" })],
    fattiPorta: [fp(1, "n:ponte-a", "PONTE-A", { source: "device" })],
  }));
  assert.equal(letto.collegamenti.length, 1, "col tipo letto (MK2) è una porta fisica: il cavo c'è (§13.13.2, «in T2 il tipo letto lo rende»)");
});

test("I3 e I51: fra router un annuncio di segmento non conferma; vale solo come unico vicino su una porta fisica, probabile «attraverso»", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "RTR-2", device_type: "router", ...mk }), dev(3, { name: "SW-3" })] });
  const unico = collega(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "ether4", remote_device_name: "RTR-2", remote_port: "ether2", protocol: "mndp", source: "device" })] }));
  const c = fra(unico.collegamenti, "dev:1", "dev:2");
  assert.deepEqual([c.length, c[0]?.fiducia, c[0]?.attraverso], [1, "probabile", true]);
  const conAltri = collega(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether4", remote_device_name: "RTR-2", remote_port: "ether2", protocol: "mndp", source: "device" }),
    vic({ device_id: 1, local_port: "ether4", remote_device_name: "SW-3", remote_port: "Port 9", protocol: "mndp", source: "device" }),
  ] }));
  assert.equal(conAltri.collegamenti.length, 0);
});

test("I45: un uplink che accoppia porte di velocità diverse dà il verso, non le porte", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "GW", device_type: "switch", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }), dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00" })],
    uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "25000 Mbps"]])],
  });
  const c = fra(collega(ingresso(t1)).collegamenti, "dev:1", "dev:2");
  assert.deepEqual([c.length, c[0].porteDaVerificare, c[0].verso, c[0].a.chiave, c[0].b.chiave], [1, true, "dev:1", null, null]);
});

test("I68 (in ombra): l'uplink di un gateway del controller è la sua WAN: instradato, senza verso", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }), dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00" })],
    uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "10000 Mbps"]])],
  });
  const c = fra(collega(ingresso(t1)).collegamenti, "dev:1", "dev:2")[0];
  assert.deepEqual([c.wan, c.stato, c.verso], [true, "instradato", null]);
});

// Revisione del Task 11 di T2 (D1, spec §13.7.2 passo 3): il controller calcola l'uplink da quell'LLDP, quindi l'uplink del
// figlio non è un secondo testimone. Il figlio entrava fra gli osservatori per la sola prova di uplink, e un cavo visto da
// un capo diventava «certo: lo vedono tutti e due gli apparati».
test("§13.7.2 passo 3: un capo LLDP più l'uplink del controller del figlio resta probabile, non certo", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "SW-1", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }), dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00" })],
    uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "10000 Mbps"]])],
  });
  const daAgg = vic({ device_id: 2, local_port: "SFP28 25", remote_device_name: "SW-1", remote_port: "SFP+ 1" });
  const c = fra(collega(ingresso(t1, { vicini: [daAgg] })).collegamenti, "dev:1", "dev:2");
  assert.deepEqual([c.length, c[0].fiducia, c[0].verso], [1, "probabile", "dev:1"]);
  // La riga del controller porta il telaio (forma vera). Senza, dalla revisione del Task 3 di T3 il nome «AGG» (tre caratteri:
  // non identifica, I3) non abbina più la riga, e il cavo resterebbe visto da un capo solo.
  const daSw = vic({ device_id: 1, local_port: "SFP+ 1", remote_device_name: "AGG", remote_mac: "02:00:d0:00:02:00", remote_port: "SFP28 25" });
  assert.equal(fra(collega(ingresso(t1, { vicini: [daAgg, daSw] })).collegamenti, "dev:1", "dev:2")[0].fiducia, "certo", "dai due capi LLDP sì");
});

// Revisione del Task 11 di T2 (D2, §13.8.3 punto 1): la WAN di un gateway è instradata e senza verso; se la sua porta dà su
// un segmento (modem e altri apparati sulla stessa porta), l'uplink dava il verso al segmento come per uno switch.
test("§13.8.3 punto 1: la WAN di un gateway su un segmento non dà il verso al segmento", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }),
      dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00" }), dev(3, { name: "SW-3" })],
    uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "10000 Mbps"]]), ...porte(3, [[2, "Port 2", "1000 Mbps"]])],
  });
  const r = collega(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "SFP+ 1", remote_device_name: "AGG", remote_port: "SFP28 25" }),
    vic({ device_id: 1, local_port: "SFP+ 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
  ] }));
  assert.equal(r.segmenti.length, 1);
  const seg = r.collegamenti.filter((c) => c.genere === "segmento");
  assert.ok(seg.length >= 2);
  assert.deepEqual(seg.map((c) => c.verso), seg.map(() => null), "nessun verso dalla WAN del gateway");
  // Uno switch con l'uplink su un segmento invece il verso lo dà (passo 4, come prima).
  const sw = baseInput({ ...t1, devices: t1.devices.map((d) => (d.id === 1 ? { ...d, device_type: "switch" } : d)) });
  const r2 = collega(ingresso(sw, { vicini: [
    vic({ device_id: 1, local_port: "SFP+ 1", remote_device_name: "AGG", remote_port: "SFP28 25" }),
    vic({ device_id: 1, local_port: "SFP+ 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
  ] }));
  assert.ok(r2.collegamenti.some((c) => c.genere === "segmento" && c.verso === "dev:1"));
});

test("I69 e I48: un tunnel acceso è un collegamento «tunnel», mai un cavo; spento, o mai letto, nessuna linea", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "RTR-2", device_type: "router", ...mk })] });
  const riga = vic({ device_id: 1, local_port: "wg-sede", remote_device_name: "RTR-2", remote_port: "wg-sede1", protocol: "mndp", source: "device" });
  const acceso = collega(ingresso(t1, { vicini: [riga], fattiPorta: [fp(1, "n:wg-sede", "wg-sede", { source: "device", if_kind: "tunnel", running: 1 })] }));
  assert.deepEqual(acceso.collegamenti.map((c) => [c.genere, c.fiducia]), [["tunnel", "probabile"]]);
  const spento = collega(ingresso(t1, { vicini: [riga], fattiPorta: [fp(1, "n:wg-sede", "wg-sede", { source: "device", if_kind: "tunnel", running: 0 })] }));
  assert.equal(spento.collegamenti.length, 0);
});

test("§13.7.6 punto 3: due radio sulla stessa porta non sono un segmento; la vicina sul cavo, la lontana dopo il salto", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }), dev(8, { name: "RADIO-LONTANA", device_type: "access_point", ...mk })] });
  const r = collega(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ] }));
  assert.equal(r.segmenti.length, 0);
  assert.deepEqual(fra(r.collegamenti, "dev:1", "dev:7").map((c) => c.genere), ["cavo"]);
  assert.deepEqual(fra(r.collegamenti, "dev:7", "dev:8").map((c) => c.genere), ["radio"]);
});

test("§13.9: «Ignora» toglie solo quel cavo; una correzione che non tocca niente è orfana", () => {
  const vicini = [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" }),
  ];
  const ignora = (id: number, aPort: string, bPort: string): LinkOverrideRow => ({ id, action: "ignore", a_node: "dev:2", a_port: aPort, b_node: "dev:3", b_port: bPort, medium: null });
  const r = collega(ingresso(due({ overrides: [ignora(1, "Port 1", "Port 2"), ignora(2, "Port 5", "Port 9")] }), { vicini }));
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:3").map((c) => [c.a.chiave, c.b.chiave].sort().join("|")), ["i:6|i:7"]);
  assert.deepEqual(r.correzioniOrfane, [2]);
});

test("I39: stessi dati, stessi collegamenti (id compresi)", () => {
  const ing = () => ingresso(due(), { vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }), vic({ device_id: 3, local_port: "Port 2", remote_device_name: "SW-2", remote_port: "Port 1" })] });
  assert.deepEqual(collega(ing()).collegamenti.map((c) => c.id), collega(ing()).collegamenti.map((c) => c.id));
  assert.ok(collega(ing()).collegamenti.every((c) => c.id.startsWith(`${c.genere}:`)));
});

// I70 nel modello per cavo (revisione finale di T2, I1): la velocità si cercava solo per chiave «i:N», e una porta col nome
// doppio (nessuna chiave, I14) restava senza velocità. Il modello di oggi la dà se tutte le porte con quel nome vanno alla
// stessa velocità (H13): senza, sull'hub un hypervisor cambiava padre nella traccia solo per questo.
test("I70 — un nome doppio con una velocità sola dà la velocità del cavo; con due velocità no", () => {
  const conPorte = (v2: string) => baseInput({
    devices: [dev(11, { name: "AGG-11", via: "api" }), dev(4, { name: "HV-4", device_type: "server", vendor: "proxmox" })],
    ports: [
      { device_id: 11, port_index: 15, port_name: "SFP+ 15", speed: "10000 Mbps", status: "up", stp_state: null },
      { device_id: 11, port_index: 16, port_name: "SFP+ 15", speed: v2, status: "up", stp_state: null },
    ],
    neighbors: [{ device_id: 11, local_port: "SFP+ 15", remote_device_name: "HV-4", remote_port: "enp1s0", protocol: "lldp", remote_ip: "10.0.0.4", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  });
  const cavo = (v2: string) => {
    const c = fra(collega(ingresso(conPorte(v2))).collegamenti, "dev:11", "dev:4");
    assert.equal(c.length, 1);
    assert.equal(capoDi(c[0], "dev:11").chiave, null, "il nome doppio non dice la porta (I14)");
    return c[0].velocitaMbps;
  };
  assert.equal(cavo("10000 Mbps"), 10000);
  assert.equal(cavo("1000 Mbps"), null);
});

// ── T3, Task 4: i collegamenti che mancano (spec §13.7.2 passi 5, 8-10; §13.7.5; §13.7.6 punto 5; §13.7.8; §13.9) ─────────────

const mk = { vendor: "mikrotik", via: "ssh" } as const;
const uf = { vendor: "ubiquiti", via: "api" } as const;
const ombra = (ing: IngressoCavi, opz: { dalleVmSoloDettagli?: boolean } = {}) =>
  costruisciModelloCavi(ing, buildTopologyModel(ing.t1), { testaScelta: null, ...opz });

/**
 * Sede 1 in forma inventata (§13.7.6 punto 5, I18): router 1 (dev:1) ha su `ether3` il cavo verso la radio vicina (dev:7), che
 * annuncia LLDP ma non legge vicini suoi; oltre la radio, sulla stessa porta, router 1 sente via MNDP il router della sede 2
 * (dev:5), che legge i suoi vicini (è un apparato di rete). Il salto radio non è letto né disegnato.
 */
const sedeOltre = (altri: ReturnType<typeof vic>[] = [], over: Partial<TopologyModelInput> = {}) => baseInput({
  devices: [dev(1, { name: "RTR-SEDE1", device_type: "router", ...mk }), dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }),
    dev(5, { name: "RTR-SEDE2", device_type: "router", ...mk }), dev(6, { name: "RTR-SEDE3", device_type: "router", ...mk }), dev(9, { name: "SW-SEDE2", ...mk }),
    dev(8, { name: "RADIO-LONTANA", device_type: "access_point", ...mk }), dev(10, { name: "RADIO-ALTRA", device_type: "access_point", ...mk })],
  knownMacs: [{ device_id: 7, mac: "02:00:e1:00:07:01" }, { device_id: 5, mac: "02:00:e1:00:05:01" }, { device_id: 6, mac: "02:00:e1:00:06:01" },
    { device_id: 8, mac: "02:00:e1:00:08:01" }, { device_id: 10, mac: "02:00:e1:00:10:01" }],
  neighbors: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_mac: "02:00:e1:00:07:01", remote_port: "ether1", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 5, local_port: "ether2", remote_device_name: "SW-SEDE2", remote_port: "ether1", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 6, local_port: "ether2", remote_device_name: "SW-SEDE2", remote_port: "ether2", source: "device", remote_platform: "MikroTik" }),
    ...altri,
  ],
  ...over,
});
const sentitoSu3 = (nome: string, mac: string) => vic({ device_id: 1, local_port: "ether3", remote_device_name: nome, remote_mac: mac, remote_port: "ether1", protocol: "mndp", source: "device", remote_platform: "MikroTik" });

test("I18 e §13.7.6 punto 5: oltre una radio non letta un solo apparato di rete si appende alla radio, dedotto; con due nessun collegamento", () => {
  const uno = ombra(ingresso(sedeOltre([sentitoSu3("RTR-SEDE2", "02:00:e1:00:05:01")])));
  const c = fra(uno.collegamenti, "dev:7", "dev:5");
  assert.deepEqual(c.map((x) => [x.genere, x.fiducia, x.oltre]), [["cavo", "dedotto", "dev:7"]]);
  assert.ok(c[0].frasi.includes("RTR-SEDE2 si sente dalla porta ether3 oltre RADIO-VICINA: sta oltre il ponte radio, il salto non è letto."), c[0].frasi.join(" | "));
  assert.equal(fra(uno.collegamenti, "dev:1", "dev:5").length, 0, "il router lontano non è un cavo del router 1");
  assert.ok(uno.ponti.has("dev:7"), "la radio vicina del punto 5 è un capo di un salto radio (§13.7.6 punto 4)");
  assert.deepEqual(uno.oltre, []);

  const due = ombra(ingresso(sedeOltre([sentitoSu3("RTR-SEDE2", "02:00:e1:00:05:01"), sentitoSu3("RTR-SEDE3", "02:00:e1:00:06:01")])));
  assert.equal(fra(due.collegamenti, "dev:7", "dev:5").length + fra(due.collegamenti, "dev:7", "dev:6").length, 0);
  assert.deepEqual(due.oltre.map((o) => [o.porta.nodo, o.porta.nome, o.radio, o.apparati]), [["dev:1", "ether3", "dev:7", ["dev:5", "dev:6"]]]);

  // Mai dalla tabella MAC di una porta di passaggio: il router della sede 2 solo nella tabella di ether3 non si appende a niente.
  const soloMac = ombra(ingresso(sedeOltre([], { macPorts: [{ device_id: 1, mac: "02:00:e1:00:05:01", port_name: "ether3", timestamp: ORA_T2, source: "device" }] })));
  assert.deepEqual(soloMac.collegamenti.filter((x) => (x.a.nodo === "dev:5" || x.b.nodo === "dev:5") && x.a.nodo !== "dev:9" && x.b.nodo !== "dev:9"), []);
});

test("§13.7.6 punto 4: i capi di un salto radio dichiarato a mano (tipo wireless) sono capi di un ponte", () => {
  const add: LinkOverrideRow = { id: 1, action: "add", a_node: "dev:7", a_port: "", b_node: "dev:9", b_port: "", medium: "wireless" };
  const m = ombra(ingresso(sedeOltre([], { overrides: [add] })));
  assert.ok(m.ponti.has("dev:7") && m.ponti.has("dev:9"), [...m.ponti].join(","));
});

// §13.7.8 (G15, I62): sull'hub il router virtuale sente gli apparati attraverso il bridge dell'hypervisor; il suo cavo «suo» non
// esiste. Chi lo vede via LLDP vede in realtà il cavo dell'hypervisor che lo ospita.
test("I62 e §13.7.8: un router in una VM sta dentro il suo hypervisor: i suoi annunci sono stessa rete, chi lo vede via LLDP vede il cavo dell'hypervisor", () => {
  const t1 = conHypervisor();
  t1.ports = [...(t1.ports ?? []), ...porte(3, [[4, "Port 4", "1000 Mbps"]])];
  const r = collega(ingresso(t1, { vicini: [
    vic({ device_id: 51, local_port: "ether1", remote_device_name: "ACC-H", remote_mac: "02:00:f4:00:03:00", remote_port: "Port 4", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 3, local_port: "Port 4", remote_device_name: "RTR-VM", remote_mac: "02:00:f4:00:51:01", remote_port: "ether1", timestamp: "2026-10-13 03:00:00" }),
  ] }));
  assert.deepEqual(r.collegamenti.filter((c) => c.a.nodo === "dev:51" || c.b.nodo === "dev:51"), [], "la VM non ha collegamenti suoi");
  assert.ok(r.stessaRete.some((p) => p.da.nodo === "dev:51" && p.altro?.nodo === "dev:3"), "i suoi annunci sono stessa rete");
  const cavo = fra(r.collegamenti, "dev:3", "dev:41").filter((c) => capoDi(c, "dev:3").chiave === "i:4");
  assert.equal(cavo.length, 1, "il cavo è quello dell'hypervisor, sulla porta 4");
  assert.equal(capoDi(cavo[0], "dev:41").chiave, null, "la porta dell'hypervisor non si sa");
  assert.ok(cavo[0].frasi.some((f) => f.endsWith("È una VM di pve-1: il cavo è il suo.")), cavo[0].frasi.join(" | "));
  // Decisione del Task 4: un tunnel di una VM resta un tunnel (non è un percorso fisico; §13.7.5, il router virtuale dell'hub sente
  // il router nel cloud sul tunnel cifrato).
  const conTunnel = collega(ingresso(t1, {
    vicini: [vic({ device_id: 51, local_port: "wg1", remote_device_name: "RTR-H", remote_mac: "02:00:f4:00:01:01", remote_port: "wg1", protocol: "mndp", source: "device" })],
    fattiPorta: [fp(51, "n:wg1", "wg1", { source: "device", if_kind: "tunnel", running: 1 })],
  }));
  assert.deepEqual(conTunnel.collegamenti.filter((c) => c.a.nodo === "dev:51" || c.b.nodo === "dev:51").map((c) => [c.genere, c.fiducia, c.unVerso]), [["tunnel", "probabile", true]]);
});

test("I69 e §13.7.5: un tunnel di livello 3 sentito da un capo solo è un tunnel «probabile» in un verso; l'altro capo non censito, nessuna linea", () => {
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "RTR-2", device_type: "router", ...mk })] });
  const da1 = vic({ device_id: 1, local_port: "wg1", remote_device_name: "RTR-2", remote_mac: "02:00:e2:00:02:01", remote_port: "wg1", protocol: "mndp", source: "device" });
  const fatti = [fp(1, "n:wg1", "wg1", { source: "device", if_kind: "tunnel", running: 1 })];
  const conMac = { ...t1, knownMacs: [{ device_id: 2, mac: "02:00:e2:00:02:01" }, { device_id: 1, mac: "02:00:e2:00:01:01" }] };
  // RTR-2 legge i suoi vicini (una riga verso un modem non censito): che non senta RTR-1 è un fatto letto.
  const legge2 = vic({ device_id: 2, local_port: "ether1", remote_device_name: "MODEM", remote_port: "lan1", source: "device" });
  const r = collega(ingresso(conMac, { vicini: [da1, legge2], fattiPorta: fatti }));
  assert.deepEqual(r.collegamenti.map((c) => [c.genere, c.fiducia, c.unVerso]), [["tunnel", "probabile", true]]);
  // Revisione del Task 4 (minore 7): se RTR-2 non legge vicini, «non sente» non è un fatto: niente «in un verso solo».
  const nonLegge = collega(ingresso(conMac, { vicini: [da1], fattiPorta: fatti }));
  assert.deepEqual(nonLegge.collegamenti.map((c) => [c.genere, c.unVerso]), [["tunnel", undefined]]);
  assert.ok(r.collegamenti[0].frasi.includes("RTR-1 sente RTR-2 sul tunnel wg1, ma RTR-2 non sente RTR-1: il tunnel c'è, e gli annunci passano in un verso solo."), r.collegamenti[0].frasi.join(" | "));
  const daTutti = collega(ingresso(conMac, { vicini: [da1, legge2, vic({ device_id: 2, local_port: "wg1", remote_device_name: "RTR-1", remote_mac: "02:00:e2:00:01:01", remote_port: "wg1", protocol: "mndp", source: "device" })],
    fattiPorta: [...fatti, fp(2, "n:wg1", "wg1", { source: "device", if_kind: "tunnel", running: 1 })] }));
  assert.deepEqual(daTutti.collegamenti.map((c) => [c.genere, c.unVerso]), [["tunnel", undefined]], "sentito dai due capi non è in un verso solo");
  const nonCensito = collega(ingresso(baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk })] }), {
    vicini: [vic({ device_id: 1, local_port: "wg1", remote_device_name: "RTR-CLOUD", remote_port: "wg1", protocol: "mndp", source: "device" })], fattiPorta: fatti }));
  assert.equal(nonCensito.collegamenti.length, 0);
});

/**
 * Bordo per porta (§13.7.2 passo 10, I9). Lo switch dev:2 ha sulla porta 5 il cavo LLDP verso dev:3 letto solo dal modello per
 * cavo (SNMP, che il modello di oggi non legge): per il modello di oggi la porta 5 è di bordo, e la tabella MAC vi attacca il
 * server dev:11. La porta 6 è libera (server dev:12). Il cavo verso il server dev:13 sulla porta 7 è ignorato a mano. Lo switch
 * è gestito da un controller (una prova di ruolo: senza, la sua tabella MAC non conta, T1b).
 */
const bordo = (macZ: string) => baseInput({
  devices: [dev(2, { name: "SW-2", controller_mac: "02:00:e3:00:02:00" }), dev(3, { name: "SW-3" }), dev(11, { name: "SRV-11", device_type: "server" }), dev(12, { name: "SRV-12", device_type: "server" }), dev(13, { name: "SRV-13", device_type: "server" })],
  ports: porte(2, [[5, "Port 5", "1000 Mbps"], [6, "Port 6", "1000 Mbps"], [7, "Port 7", "1000 Mbps"], [8, "Port 8", "1000 Mbps"]]),
  knownMacs: [{ device_id: 3, mac: "02:00:e3:00:03:00" }, { device_id: 11, mac: "02:00:e3:00:11:01" }, { device_id: 12, mac: "02:00:e3:00:12:01" }, { device_id: 13, mac: "02:00:e3:00:13:01" }],
  macPorts: [
    { device_id: 2, mac: "02:00:e3:00:11:01", port_name: "Port 5", timestamp: ORA_T2, source: "unifi" },
    { device_id: 2, mac: "02:00:e3:00:12:01", port_name: "Port 6", timestamp: ORA_T2, source: "unifi" },
    { device_id: 2, mac: "02:00:e3:00:13:01", port_name: macZ, timestamp: ORA_T2, source: "unifi" },
  ],
  overrides: [{ id: 7, action: "ignore", a_node: "dev:2", a_port: "Port 7", b_node: "dev:13", b_port: "eno1", medium: null }],
});
const lldpSnmp = [
  vic({ device_id: 2, local_port: "Port 5", local_port_index: 5, remote_device_name: "SW-3", remote_mac: "02:00:e3:00:03:00", remote_port: "Port 1", source: "snmp" }),
  vic({ device_id: 2, local_port: "Port 7", local_port_index: 7, remote_device_name: "SRV-13", remote_mac: "02:00:e3:00:13:01", remote_port: "eno1", source: "snmp" }),
];

test("I9 e §13.7.2 passo 10: la porta capo di un cavo verso un altro oggetto non è di bordo; il cavo ignorato tiene la porta occupata verso quell'oggetto", () => {
  const r = collega(ingresso(bordo("Port 7"), { vicini: lldpSnmp }));
  assert.equal(fra(r.collegamenti, "dev:2", "dev:11").length, 0, "la tabella MAC della porta 5 non attacca il server: la porta 5 è il cavo verso SW-3");
  assert.deepEqual(r.scartateBordo.map((s) => [s.porta.nodo, s.porta.chiave, s.verso, s.motivo]),
    [["dev:2", "i:5", "dev:11", "la porta è il capo di un cavo verso un altro oggetto: non è di bordo"]]);
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:12").map((c) => [capoDi(c, "dev:2").chiave, c.fiducia]), [["i:6", "dedotto"]], "la porta 6 è libera: di bordo");
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:13"), [], "il cavo ignorato non torna dalla tabella MAC");
  assert.deepEqual(r.correzioniOrfane, []);
  const altrove = collega(ingresso(bordo("Port 8"), { vicini: lldpSnmp }));
  assert.deepEqual(fra(altrove.collegamenti, "dev:2", "dev:13").map((c) => capoDi(c, "dev:2").chiave), ["i:8"], "su un'altra porta il server torna");
  // La regola è del modello per cavo, non solo del modello di oggi che filtra già la sua linea: una prova di bordo sulla porta
  // del cavo ignorato (la forma di proveDaInput) si scarta col suo motivo.
  const ing = ingresso(bordo("Port 7"), { vicini: lldpSnmp });
  const p = preparaCavi(ing, buildTopologyModel(ing.t1));
  const porta7 = p.prove.find((x) => x.da.nodo === "dev:2" && x.da.chiave === "i:7")!.da;
  const finta: Prova = { tipo: "bordo", da: porta7, altro: { nodo: "dev:13", chiave: null, nome: "", certa: false, fisica: null, senzaFili: null, nelBridge: null },
    telaio: null, classe: "tabella_mac", detto: "tabella MAC", lettore: "apparato", visto: ORA_T2, frase: "Dedotto: MAC di SRV-13 visto sulla porta Port 7 di SW-2." };
  const r2 = costruisciCollegamenti([...p.prove, finta], ing.t1.overrides, p.ctx);
  assert.deepEqual(fra(r2.collegamenti, "dev:2", "dev:13"), []);
  assert.deepEqual(r2.scartateBordo.filter((s) => s.verso === "dev:13").map((s) => [s.porta.chiave, s.motivo]), [["i:7", "la porta è il capo di un cavo ignorato a mano verso questo oggetto"]]);
});

/** Un hypervisor (dev:41) con una VM accesa vista sulla porta 9 dello switch dev:3. */
const vmRow = (scannedDeviceId: number, vmid: number, name: string, node: string, macs: string[]): ModelVmRow =>
  ({ scannedDeviceId, vmid, name, node, status: "running", type: "qemu", macs, ips: [], scannedAt: "2026-10-13T06:00:00.000Z" });
const conVm = () => baseInput({
  devices: [dev(3, { name: "SW-3", host: "10.0.0.3" }), dev(41, { name: "pve-41", device_type: "server", vendor: "proxmox", host: "10.0.0.41", proxmox_scan: 1, port_count: 0 })],
  ports: porte(3, [[1, "Port 1", "10000 Mbps"], [9, "Port 9", "1000 Mbps"]]),
  knownMacs: [{ device_id: 3, mac: "02:00:e4:00:03:00" }],
  macPorts: [{ device_id: 3, mac: "02:00:e4:01:01:01", port_name: "Port 9", timestamp: ORA_T2, source: "unifi" }],
  vms: [vmRow(41, 101, "srv-a", "pve-41", ["02:00:e4:01:01:01"])],
  scanHosts: [{ scannedDeviceId: 41, hostname: "pve-41", ips: ["10.0.0.41"], macs: ["02:00:e4:00:41:01"], scannedAt: "2026-10-13T06:00:00.000Z" }],
});

test("I56 (seconda parte), §13.5.5: con `lldpd` sull'host un collegamento «dalle VM» su una porta che l'host non conferma si scarta; senza righe dell'host resta", () => {
  const senza = collega(ingresso(conVm()));
  assert.deepEqual(fra(senza.collegamenti, "dev:3", "dev:41").map((c) => [capoDi(c, "dev:3").chiave, c.prove.map((p) => p.classe).join(",")]), [["i:9", "vm"]]);
  assert.deepEqual(senza.scartateVm, []);
  const host = vic({ device_id: 41, local_port: "eno1", remote_device_name: "SW-3", remote_mac: "02:00:e4:00:03:00", remote_port: "Port 1", source: "host" });
  const con = collega(ingresso(conVm(), { vicini: [host] }));
  assert.deepEqual(fra(con.collegamenti, "dev:3", "dev:41").map((c) => capoDi(c, "dev:3").chiave), ["i:1"], "resta il cavo che l'host vede");
  assert.deepEqual(con.scartateVm.map((s) => [s.porta.nodo, s.porta.chiave, s.ipervisore]), [["dev:3", "i:9", "dev:41"]]);
  // L'host che conferma la porta: il collegamento resta.
  const conferma = collega(ingresso(conVm(), { vicini: [{ ...host, remote_port: "Port 9" }] }));
  assert.deepEqual(conferma.scartateVm, []);
  assert.deepEqual(fra(conferma.collegamenti, "dev:3", "dev:41").map((c) => capoDi(c, "dev:3").chiave), ["i:9"]);
});

// §13.9, «Verifica» da T3: prima un collegamento a mano era confermato da qualunque collegamento fra gli stessi oggetti; da T3 solo
// da un cavo con le stesse porte, o dal MAC dell'altro oggetto sulla porta dichiarata.
test("§13.9: la verifica a mano è per cavo — stesse porte una linea «confermata»; porte diverse due linee; porte vuote si uniscono a un cavo solo; tipo «tunnel»", () => {
  const add = (aPort: string, bPort: string, medium: string | null = null): LinkOverrideRow =>
    ({ id: 1, action: "add", a_node: "dev:2", a_port: aPort, b_node: "dev:3", b_port: bPort, medium, created_by: "tecnico", created_at: "2026-10-14 08:00:00" });
  const t = (overrides: LinkOverrideRow[], over: Partial<TopologyModelInput> = {}) => due({ overrides, knownMacs: [{ device_id: 3, mac: "02:00:e5:00:03:00" }], ...over });
  const cavo1 = vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_mac: "02:00:e5:00:03:00", remote_port: "Port 2" });
  const cavo2 = vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_mac: "02:00:e5:00:03:00", remote_port: "Port 7" });
  const linee = (r: ReturnType<typeof collega>) => fra(r.collegamenti, "dev:2", "dev:3")
    .map((c) => [c.genere, `${capoDi(c, "dev:2").chiave}|${capoDi(c, "dev:3").chiave}`, c.fiducia, c.aManoDiverse ?? false]).sort();

  const stesse = collega(ingresso(t([add("Port 1", "Port 2")]), { vicini: [cavo1] }));
  assert.deepEqual(linee(stesse), [["cavo", "i:1|i:2", "a_mano_confermato", false]]);
  assert.ok(fra(stesse.collegamenti, "dev:2", "dev:3")[0].frasi.some((f) => f.startsWith("Collegato a mano da tecnico il ")), "chi e quando");

  const diverse = collega(ingresso(t([add("Port 6", "Port 7")]), { vicini: [cavo1] }));
  assert.deepEqual(linee(diverse), [["cavo", "i:1|i:2", "probabile", false], ["cavo", "i:6|i:7", "a_mano", true]]);

  const conMac = collega(ingresso(t([add("Port 6", "Port 7")], { macPorts: [{ device_id: 2, mac: "02:00:e5:00:03:00", port_name: "Port 6", timestamp: ORA_T2, source: "unifi" }] })));
  assert.deepEqual(linee(conMac), [["cavo", "i:6|i:7", "a_mano_confermato", false]], "il MAC dell'altro sulla porta dichiarata conferma");

  const vuoteUno = collega(ingresso(t([add("", "")]), { vicini: [cavo1] }));
  assert.deepEqual(linee(vuoteUno), [["cavo", "i:1|i:2", "a_mano_confermato", false]], "porte vuote e un cavo solo: si unisce");

  const vuoteDue = collega(ingresso(t([add("", "")]), { vicini: [cavo1, cavo2] }));
  assert.deepEqual(linee(vuoteDue), [["cavo", "i:1|i:2", "probabile", false], ["cavo", "i:6|i:7", "probabile", false], ["cavo", "null|null", "a_mano", true]],
    "porte vuote e due cavi: la linea a mano sta a sé");

  const tunnel = collega(ingresso(t([add("", "", "tunnel")])));
  const tl = fra(tunnel.collegamenti, "dev:2", "dev:3");
  assert.deepEqual(tl.map((c) => [c.genere, c.fiducia, c.medio]), [["tunnel", "a_mano", "tunnel"]], "un tunnel a mano si disegna anche senza un capo «acceso»");
});

test("§13.9: «Togli dal segmento» toglie solo l'appartenenza di quel membro, anche con l'id del segmento di prima (alias di un altro membro)", () => {
  const t1 = (overrides: LinkOverrideRow[]) => baseInput({
    devices: [dev(3, { name: "SW-3" }), dev(5, { name: "RTR-5", device_type: "router", ...mk }), dev(6, { name: "RTR-6", device_type: "router", ...mk })],
    ports: porte(3, [[15, "Port 15", "1000 Mbps"]]),
    knownMacs: [{ device_id: 5, mac: "02:00:e6:00:05:01" }, { device_id: 6, mac: "02:00:e6:00:06:01" }],
    overrides,
  });
  const vicini = [
    vic({ device_id: 3, local_port: "Port 15", remote_device_name: "RTR-5", remote_mac: "02:00:e6:00:05:01", remote_port: "ether8" }),
    vic({ device_id: 3, local_port: "Port 15", remote_device_name: "RTR-6", remote_mac: "02:00:e6:00:06:01", remote_port: "ether8" }),
  ];
  const togli = (seg: string): LinkOverrideRow => ({ id: 4, action: "ignore", a_node: "dev:6", a_port: "ether8", b_node: seg, b_port: "", medium: null });
  const membri = (r: ReturnType<typeof collega>) => r.collegamenti.filter((c) => c.genere === "segmento").map((c) => c.a.nodo).sort();
  assert.deepEqual(membri(collega(ingresso(t1([]), { vicini }))), ["dev:3", "dev:5", "dev:6"]);
  for (const seg of ["seg:3:15", "seg:5:n-ether8"]) {
    const r = collega(ingresso(t1([togli(seg)]), { vicini }));
    assert.equal(r.segmenti[0].id, "seg:3:15");
    assert.deepEqual(membri(r), ["dev:3", "dev:5"], `con ${seg}`);
    assert.deepEqual(r.correzioniOrfane, [], `con ${seg} la correzione non è orfana`);
  }
  // Un id che nessun segmento contiene più: orfana, contata (R2).
  assert.deepEqual(collega(ingresso(t1([togli("seg:9:4")]), { vicini })).correzioniOrfane, [4]);
});

test("§13.13.3 punto 8: bloccato fra due bridge della stessa regione senza righe d'istanza = «bloccato» con le istanze non lette; con l'istanza, «bloccato_comune»", () => {
  const regione = { protocol: "mstp", region_name: "REGIONE-A", region_revision: 1, config_digest: "02:00:00:00:00:D1" };
  const t1 = baseInput({ devices: [dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })] });
  const vicini = [vic({ device_id: 2, local_port: "ether1", remote_device_name: "SW-3", remote_port: "bridge/ether1", source: "device", remote_platform: "MikroTik" })];
  const fattiPorta = [fp(3, "n:ether1", "ether1", { source: "device", stp_role: "alternate", stp_state: "discarding" })];
  const stato = (fattiBridge: ReturnType<typeof fb>[]) => fra(collega(ingresso(t1, { vicini, fattiPorta, fattiBridge })).collegamenti, "dev:2", "dev:3")
    .map((c) => [c.stato, c.istanzeNonLette, c.attivoPerVlan]);
  assert.deepEqual(stato([fb(2, regione), fb(3, regione)]), [["bloccato", true, undefined]]);
  assert.deepEqual(stato([fb(2, regione), fb(3, regione), fb(3, { ...regione, instance: 1, root_port: "ether1", vlans: "10-12" })]), [["bloccato_comune", undefined, [10, 11, 12]]]);
  assert.deepEqual(stato([fb(2, regione), fb(3, { ...regione, config_digest: "02:00:00:00:00:D2" })]), [["bloccato", undefined, undefined]], "un'altra regione: bloccato e basta");
});

test("Caso 4 del piano: un fascio con un membro giù resta un fascio; la velocità è dei membri accesi, il membro giù porta la sua", () => {
  const t1 = baseInput({ devices: [dev(2, { name: "SW-2" }), dev(3, { name: "SW-3" })],
    ports: [...porte(2, [[1, "Port 1", "25000 Mbps"], [6, "Port 6", "25000 Mbps"]]), ...porte(3, [[2, "Port 2", "25000 Mbps"], [7, "Port 7", "25000 Mbps"]])] });
  const r = collega(ingresso(t1, {
    vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }), vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" })],
    fattiPorta: [fp(2, "i:1", "Port 1", { lag_group: "lag:1" }), fp(2, "i:6", "Port 6", { lag_group: "lag:1", running: 0 })],
  }));
  const f = fra(r.collegamenti, "dev:2", "dev:3");
  assert.deepEqual(f.map((c) => [c.genere, c.velocitaMbps]), [["fascio", 25000]]);
  assert.deepEqual(f[0].membri?.map((m) => [m.a.chiave, m.stato, m.velocitaMbps]).sort(), [["i:1", "inoltra", 25000], ["i:6", "giu", 25000]]);
});

test("§13.10.3: un collegamento giù dice quale capo è giù", () => {
  const vicini = [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" })];
  const c = fra(collega(ingresso(due(), { vicini, fattiPorta: [fp(3, "i:2", "Port 2", { running: 0 })] })).collegamenti, "dev:2", "dev:3")[0];
  assert.deepEqual([c.stato, c.giuSu], ["giu", { nodo: "dev:3", porta: "Port 2" }]);
});

/**
 * Famiglia 4 con due casi in più (S11, I56): una VM di pve-1 vista solo sulla porta 5 di un secondo switch d'accesso (dev:4,
 * col suo cavo verso il core) — il collegamento «dalle VM» che non è il principale di pve-1, come i tre cavi inventati verso
 * l'hypervisor 2 del cliente A (M26); e un server (dev:43) con una VM sola, vista sulla porta 4 dell'accesso: il suo principale.
 */
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

test("S11 e I56: un collegamento solo «dalle VM» che non è il principale del suo hypervisor sta nei dettagli; i padri non cambiano; il principale resta", () => {
  const ing = ingresso(conHypervisorEAltri());
  const spenta = ombra(ing, { dalleVmSoloDettagli: false });
  const accesa = ombra(ing, { dalleVmSoloDettagli: true });
  const verso41 = (m: typeof spenta) => fra(m.collegamenti, "dev:4", "dev:41");
  assert.equal(verso41(spenta).length, 1, "spenta: il collegamento «dalle VM» è una ridondanza a richiesta");
  assert.deepEqual(spenta.soloDettagli, []);
  assert.equal(verso41(accesa).length, 0, "accesa: non si disegna, nemmeno a richiesta");
  assert.deepEqual(accesa.soloDettagli.map((d) => [d.ipervisore, d.altro, d.porta, d.vm]), [["dev:41", "dev:4", "Port 5", 1]]);
  assert.deepEqual(accesa.albero.padri, spenta.albero.padri, "l'hypervisor è una foglia: toglierlo non cambia l'albero");
  assert.equal(fra(accesa.collegamenti, "dev:3", "dev:43").length, 1, "un server con una VM sola tiene il suo principale");
  assert.equal(accesa.albero.via.get("dev:43")?.id, fra(accesa.collegamenti, "dev:3", "dev:43")[0].id);
  // La linea di oggi che ha anche la tabella MAC (il MAC dell'hypervisor sulla porta) non è «solo dalle VM».
  const core42 = fra(accesa.collegamenti, "dev:2", "dev:42");
  assert.ok(core42.some((c) => c.prove.some((p) => p.classe === "tabella_mac") && c.prove.some((p) => p.classe === "vm")), core42.map((c) => c.prove.map((p) => p.classe).join(",")).join(" | "));
});

// ── Revisione del Task 4 (16/10): le correzioni ──────────────────────────────────────────────────────────────────────────────

// Importante 1: l'abbinamento VM ↔ nodo di vms.ts vale anche per IP, e le VM spente ci sono: un firewall fisico con l'IP di una
// vecchia VM spenta diventava «VM» e perdeva tutti i suoi cavi.
test("§13.7.8 (revisione del Task 4): sta dentro l'hypervisor solo la VM accesa e abbinata per MAC; un firewall con l'IP di una VM spenta tiene i suoi cavi", () => {
  const rete = (status: string, macs: string[]) => baseInput({
    devices: [dev(3, { name: "SW-3", controller_mac: "02:00:e7:00:03:00" }), dev(60, { name: "FW-60", device_type: "firewall", host: "10.0.0.60" }),
      dev(41, { name: "pve-41", device_type: "server", vendor: "proxmox", host: "10.0.0.41", proxmox_scan: 1, port_count: 0 })],
    ports: porte(3, [[2, "Port 2", "1000 Mbps"]]),
    knownMacs: [{ device_id: 60, mac: "02:00:e7:00:60:01" }],
    vms: [{ ...vmRow(41, 160, "fw-vecchio", "pve-41", macs), status, ips: ["10.0.0.60"] }],
    scanHosts: [{ scannedDeviceId: 41, hostname: "pve-41", ips: ["10.0.0.41"], macs: ["02:00:e7:00:41:01"], scannedAt: "2026-10-13T06:00:00.000Z" }],
  });
  const lldp = vic({ device_id: 3, local_port: "Port 2", remote_device_name: "FW-60", remote_mac: "02:00:e7:00:60:01", remote_port: "port1" });
  for (const [status, macs, dentro] of [["stopped", ["02:00:e7:01:60:09"], false], ["running", ["02:00:e7:01:60:09"], false], ["running", ["02:00:e7:00:60:01"], true]] as const) {
    const t1 = rete(status, [...macs]);
    assert.equal(buildTopologyModel(t1).vms[0]?.nodeId, "dev:60", `${status}/${macs[0]}: per vms.ts la VM è il firewall (per IP o per MAC)`);
    const r = collega(ingresso(t1, { vicini: [lldp] }));
    assert.equal(fra(r.collegamenti, "dev:3", "dev:60").length, dentro ? 0 : 1, `${status}/${macs[0]}`);
    assert.equal(fra(r.collegamenti, "dev:3", "dev:41").length, dentro ? 1 : 0, `${status}/${macs[0]}: il cavo dell'hypervisor solo per la VM vera`);
  }
});

// Importante 2: la VM confermata come testa veniva scartata in silenzio (senza collegamenti non è visibile), mentre la scelta del
// §13.16 punto 3 è di Riccardo: resta fuori dalla regola del §13.7.8, come oggi.
test("§13.16 punto 3 (revisione del Task 4): una VM confermata come testa resta fuori dalla regola delle VM dentro l'hypervisor, e la testa è lei", () => {
  const t1 = conHypervisor();
  const m = costruisciModelloCavi(ingresso(t1), buildTopologyModel(t1), { testaScelta: "dev:51" });
  assert.equal(m.albero.testa, "dev:51");
  assert.ok(m.collegamenti.some((c) => c.a.nodo === "dev:51" || c.b.nodo === "dev:51"), "la testa tiene i suoi collegamenti di oggi");
  assert.ok(m.nonCalcolato.some((x) => x.includes("una VM confermata come testa resta fuori dalla regola")), m.nonCalcolato.join(" | "));
  const senza = costruisciModelloCavi(ingresso(t1), buildTopologyModel(t1), { testaScelta: null });
  assert.equal(senza.collegamenti.filter((c) => c.a.nodo === "dev:51" || c.b.nodo === "dev:51").length, 0, "non scelta, sta dentro l'hypervisor");
});

// Importante 3: «oltre» vale solo con il salto «non letto né dichiarato» (§13.7.6 punto 5), e la radio lontana non è un apparato
// «oltre» (niente voce falsa «oltre ‹N› ci sono 2 apparati»).
test("§13.7.6 punto 5 (revisione del Task 4): niente «oltre» se il salto è letto (ponte sulla porta, radio capo di un salto) o dichiarato a mano; la radio lontana non conta", () => {
  const S2 = sentitoSu3("RTR-SEDE2", "02:00:e1:00:05:01");
  const nessunOltre = (m: ReturnType<typeof ombra>, caso: string) => {
    assert.deepEqual(m.collegamenti.filter((c) => c.oltre !== undefined).map((c) => c.id), [], caso);
    assert.deepEqual(m.oltre, [], caso);
  };
  // (a) Le due radio del ponte sentite sulla porta del router: il salto è letto.
  const vicinaRadio = vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_mac: "02:00:e1:00:07:01", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" });
  const lontanaSu = (d: number, porta: string) => vic({ device_id: d, local_port: porta, remote_device_name: "RADIO-LONTANA", remote_mac: "02:00:e1:00:08:01", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" });
  // Le righe con le capacità stanno fra le righe dei lettori di T2 (`vicini`): quelle del modello di oggi non le hanno.
  const conPonte = ombra(ingresso(sedeOltre([S2]), { vicini: [vicinaRadio, lontanaSu(1, "ether3")] }));
  assert.ok(conPonte.collegamenti.some((c) => c.genere === "radio"), "il salto è letto sulla porta");
  nessunOltre(conPonte, "ponte sulla porta");
  // (b) La radio vicina è capo di un salto letto altrove (le due radio sentite su una porta di SW-SEDE2).
  const vicinaSu9 = vic({ device_id: 9, local_port: "ether5", remote_device_name: "RADIO-VICINA", remote_mac: "02:00:e1:00:07:01", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" });
  const b = ombra(ingresso(sedeOltre([S2]), { vicini: [vicinaSu9, lontanaSu(9, "ether5")] }));
  assert.ok(b.collegamenti.some((c) => c.genere === "radio"), "il salto è letto");
  nessunOltre(b, "radio capo di un salto");
  // (c) Il salto dichiarato a mano (tipo wireless).
  const add: LinkOverrideRow = { id: 1, action: "add", a_node: "dev:7", a_port: "", b_node: "dev:8", b_port: "", medium: "wireless" };
  nessunOltre(ombra(ingresso(sedeOltre([S2], { overrides: [add] }))), "salto dichiarato");
  // (d) La radio lontana di un altro ponte sentita oltre la radio vicina non è un secondo apparato di rete.
  const altra = vic({ device_id: 9, local_port: "ether5", remote_device_name: "RADIO-ALTRA", remote_mac: "02:00:e1:00:10:01", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" });
  const d = ombra(ingresso(sedeOltre([S2, sentitoSu3("RADIO-LONTANA", "02:00:e1:00:08:01")]), { vicini: [altra, lontanaSu(9, "ether5")] }));
  assert.deepEqual(d.oltre, [], "la radio lontana non è «oltre»");
  assert.deepEqual(fra(d.collegamenti, "dev:7", "dev:5").map((c) => [c.fiducia, c.oltre]), [["dedotto", "dev:7"]]);
});

// Importante 4: la linea a mano del modello di oggi si saltava per intero, e con lei la prova «dalle VM» che vm-ports le aggiunge:
// T1 diceva «✎ ✓», la mappa nuova «a mano, non visto».
test("§13.9 (revisione del Task 4): le prove di bordo di una linea a mano restano; sulla stessa porta confermano, su un'altra porta sono un cavo loro", () => {
  const add = (bPort: string): LinkOverrideRow => ({ id: 1, action: "add", a_node: "dev:41", a_port: "", b_node: "dev:3", b_port: bPort, medium: null });
  const stessa = conVm();
  stessa.overrides = [add("Port 9")];
  assert.equal(buildTopologyModel(stessa).links.find((l) => l.sources.includes("manual"))?.manual?.confirmed, true, "T1: ✎ ✓");
  assert.deepEqual(fra(collega(ingresso(stessa)).collegamenti, "dev:3", "dev:41").map((c) => [capoDi(c, "dev:3").chiave, c.fiducia]), [["i:9", "a_mano_confermato"]]);
  const altra = conVm();
  altra.overrides = [add("Port 1")];
  const linee = fra(collega(ingresso(altra)).collegamenti, "dev:3", "dev:41").map((c) => [capoDi(c, "dev:3").chiave, c.fiducia, c.aManoDiverse ?? false]).sort();
  assert.deepEqual(linee, [["i:1", "a_mano", true], ["i:9", "dedotto", false]], "le VM sulla porta 9 (altri cavi della linea di oggi) sono un cavo loro");
});

// Importante 5: due correzioni uguali, o una senza e una con le porte, davano due linee dove T1 ne mostra una; lo stesso con un
// collegamento visto «senza fili» e la correzione senza tipo.
test("§13.9 (revisione del Task 4): correzioni senza porte sulla stessa coppia sono una linea; senza tipo si uniscono anche a un collegamento senza fili visto", () => {
  const add = (id: number, aPort: string, bPort: string): LinkOverrideRow => ({ id, action: "add", a_node: "dev:2", a_port: aPort, b_node: "dev:3", b_port: bPort, medium: null });
  assert.equal(fra(collega(ingresso(due({ overrides: [add(1, "", ""), add(2, "", "")] }))).collegamenti, "dev:2", "dev:3").length, 1, "due uguali senza porte");
  assert.equal(fra(collega(ingresso(due({ overrides: [add(1, "Port 1", "Port 2"), add(2, "", "")] }))).collegamenti, "dev:2", "dev:3").length, 1, "una con e una senza porte");
  assert.equal(fra(collega(ingresso(due({ overrides: [add(1, "", ""), add(2, "Port 1", "Port 2")] }))).collegamenti, "dev:2", "dev:3").length, 1, "una senza e una con le porte");
  const mesh = baseInput({
    devices: [dev(5, { name: "AP-5", device_type: "access_point", controller_mac: "02:00:e8:00:05:00", uplink_mac: "02:00:e8:00:06:00", uplink_type: "wireless", uplink_seen_at: "2026-10-13 03:00:00" }),
      dev(6, { name: "AP-6", device_type: "access_point", controller_mac: "02:00:e8:00:06:00" })],
    overrides: [{ id: 1, action: "add", a_node: "dev:5", a_port: "", b_node: "dev:6", b_port: "", medium: null }],
  });
  const c = fra(collega(ingresso(mesh)).collegamenti, "dev:5", "dev:6");
  assert.deepEqual(c.map((x) => [x.genere, x.fiducia]), [["senza_fili", "a_mano_confermato"]]);
});

// Importante 6: l'albero si calcola prima del filtro «dalle VM», e un hypervisor non è sempre una foglia (ipervisori prende ogni
// hypervisor di una VM, di qualunque classe): un collegamento «dalle VM» che è il padre di qualcuno non sparisce.
test("§13.15 punto 4 (revisione del Task 4): un collegamento «dalle VM» che fa da padre resta; nessun id dei dettagli è un padre, e `scelto` nomina solo collegamenti noti", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(3, { name: "SW-3", controller_mac: "02:00:e9:00:03:00" }),
      dev(4, { name: "SW-4", controller_mac: "02:00:e9:00:04:00" }),
      // un hypervisor registrato come switch e gestito dal controller: classe «infra», non una foglia
      dev(41, { name: "HV-SW", device_type: "switch", controller_mac: "02:00:e9:00:41:00", host: "10.0.0.41", proxmox_scan: 1 })],
    ports: [...porte(3, [[1, "Port 1", "10000 Mbps"], [2, "Port 2", "10000 Mbps"]]), ...porte(4, [[5, "Port 5", "1000 Mbps"]])],
    knownMacs: [{ device_id: 1, mac: "02:00:e9:00:01:00" }, { device_id: 3, mac: "02:00:e9:00:03:00" }, { device_id: 41, mac: "02:00:e9:00:41:00" }],
    neighbors: [
      vic({ device_id: 1, local_port: "ether1", remote_device_name: "SW-3", remote_mac: "02:00:e9:00:03:00", remote_port: "Port 2", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 3, local_port: "Port 1", remote_device_name: "HV-SW", remote_mac: "02:00:e9:00:41:00", remote_port: "eno1" }),
    ],
    macPorts: [{ device_id: 4, mac: "02:00:e9:01:41:01", port_name: "Port 5", timestamp: ORA_T2, source: "unifi" }],
    vms: [vmRow(41, 101, "srv-a", "HV-SW", ["02:00:e9:01:41:01"])],
    scanHosts: [{ scannedDeviceId: 41, hostname: "HV-SW", ips: ["10.0.0.41"], macs: ["02:00:e9:00:41:00"], scannedAt: "2026-10-13T06:00:00.000Z" }],
  });
  const spenta = ombra(ingresso(t1), { dalleVmSoloDettagli: false });
  const accesa = ombra(ingresso(t1), { dalleVmSoloDettagli: true });
  const vm = fra(spenta.collegamenti, "dev:4", "dev:41");
  assert.equal(vm.length, 1);
  assert.equal(spenta.albero.via.get("dev:4")?.id, vm[0].id, "il collegamento «dalle VM» è il padre di SW-4");
  assert.equal(fra(accesa.collegamenti, "dev:4", "dev:41").length, 1, "fa da padre: resta disegnato");
  const padri = new Set([...accesa.albero.via.values()].map((c) => c.id));
  assert.deepEqual(accesa.soloDettagli.filter((d) => padri.has(d.collegamento.id)), []);
  const noti = new Set([...accesa.collegamenti, ...accesa.soloDettagli.map((d) => d.collegamento)].map((c) => c.id));
  assert.deepEqual([...accesa.albero.scelto.values()].filter((id) => !noti.has(id)), []);
  assert.deepEqual(accesa.albero.padri, spenta.albero.padri);
});

// Minore 9: un cavo ignorato non è un capo per il bordo: la sua porta resta occupata solo verso quell'oggetto (§13.9).
test("§13.9 (revisione del Task 4): la porta di un cavo ignorato è occupata solo verso quell'oggetto; un altro oggetto della tabella MAC vi si attacca", () => {
  const t1 = bordo("Port 8");
  t1.macPorts = t1.macPorts.map((m) => (m.mac === "02:00:e3:00:12:01" ? { ...m, port_name: "Port 7" } : m));
  const r = collega(ingresso(t1, { vicini: lldpSnmp }));
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:12").map((c) => capoDi(c, "dev:2").chiave), ["i:7"]);
});
