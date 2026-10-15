// I collegamenti per cavo (spec topologia §13.7.2-13.7.6, §13.6.3), in ombra: una linea per cavo, la fiducia in parole, lo
// stato dai due capi, i segmenti come oggetti, i fasci, i tunnel solo se accesi, il salto radio. Reti piccole inventate
// (righe come le scrivono i lettori), l'incidente o l'origine nel titolo di ogni prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciCollegamenti, type Collegamento } from "@/lib/topology/cavi/collegamenti";
import { preparaCavi } from "@/lib/topology/cavi/modello";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";
import { porte } from "./support/reti-campione";
import { fp, ingresso, vic } from "./support/cavi";

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
  const daSw = vic({ device_id: 1, local_port: "SFP+ 1", remote_device_name: "AGG", remote_port: "SFP28 25" });
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
