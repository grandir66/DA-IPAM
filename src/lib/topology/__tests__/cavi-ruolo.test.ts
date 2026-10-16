// Le prove di ruolo che vede solo il modello per cavo (spec topologia §13.8.2, «Una prova che in T1b non c'è ancora»; §13.7.6
// punto 4; prove I28, I65): le capacità annunciate col nome di sistema, lo spanning tree dai fatti per porta e i BPDU che un
// apparato letto riceve da chi sta sull'altro capo, il capo di un ponte radio. `ruolo.test.ts` resta per T1b (il modello di
// oggi). Reti inventate con la forma vera: MAC 02:00:…, nomi inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeClass } from "@/lib/topology/identity";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi, preparaCavi } from "@/lib/topology/cavi/modello";
import { classiCavi, proveDiRuoloCavi } from "@/lib/topology/cavi/ruolo";
import type { IngressoCavi, ViciniCaviRow } from "@/lib/topology/cavi/prove";
import { eReteDalleCapacita } from "@/lib/topology/lettori/fonti";
import { baseInput, dev, host } from "./support/righe";
import { fp, ingresso, vic } from "./support/cavi";

const cavi = (ing: IngressoCavi, testa: string | null = null) => costruisciModelloCavi(ing, buildTopologyModel(ing.t1), { testaScelta: testa });
const mk = { vendor: "mikrotik", via: "ssh" } as const;
/** Le prove di ruolo del modello per cavo, senza i ponti radio. */
const proveCavi = (ing: IngressoCavi) => {
  const p = preparaCavi(ing, buildTopologyModel(ing.t1));
  return proveDiRuoloCavi(ing, p.prove, p.fatti, new Set(), (id) => { const n = p.idx.nodes.get(id); return n ? nodeClass(n) : null; });
};

// L'hub (§13.8.2): lo switch di storage non legge vicini, nessun controller lo gestisce, e dopo il lettore di T1 le sue righe
// sono solo LLDP. In T1b esce dall'albero; in T3 torna coi BPDU che manda al router (anche senza le capacità).
const S = "02:00:00:00:02:00";
const storage = () => baseInput({
  devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-STORAGE", vendor: "altro" })],
  knownMacs: [{ device_id: 2, mac: S }],
  neighbors: [vic({ device_id: 1, local_port: "ether5", remote_device_name: "sw-storage", remote_mac: S, remote_port: "Port 1", source: "device" })],
});

test("§13.8.2: uno switch visto solo via LLDP che manda BPDU al router torna fra gli apparati di rete (il caso dell'hub)", () => {
  const t1 = storage();
  assert.equal(buildTopologyModel(t1).classiMappa?.["dev:2"], "da_sistemare", "in T1b era «da sistemare»");
  const m = cavi(ingresso(t1, { fattiPorta: [fp(1, "n:ether5", "ether5", { source: "device", bpdu_rx: 12 })] }));
  assert.equal(m.classi.get("dev:2"), "infra");
  assert.equal(m.albero.padri["dev:2"], "dev:1", "e sta nell'albero, sotto il router");
  const senza = cavi(ingresso(t1, { fattiPorta: [fp(1, "n:ether5", "ether5", { source: "device", bpdu_rx: 0 })] }));
  assert.equal(senza.classi.get("dev:2"), "da_sistemare", "nessun BPDU ricevuto: nessuna prova");
  const giu = cavi(ingresso(t1, { fattiPorta: [fp(1, "n:ether5", "ether5", { source: "device", bpdu_rx: 12, running: 0 })] }));
  assert.equal(giu.classi.get("dev:2"), "da_sistemare", "su una porta giù i BPDU contati non dicono niente di oggi");
});

// Decisione (Task 3 di T3): i BPDU sono «da lui» (§13.8.2) solo se la porta sente un apparato solo via LLDP (§13.7.6 punto 1:
// una porta, un cavo). Su una porta che ne sente due (un hub, uno switch non gestito) non si sa chi li manda: sull'hub un PC
// registrato switch che sta dietro la stessa porta di uno switch vero tornerebbe nell'albero senza prove sue.
test("i BPDU di una porta che sente due apparati via LLDP non dicono chi li manda: nessuna prova per nessuno dei due", () => {
  const PC = "02:00:00:00:31:00";
  const t1 = baseInput({
    devices: [...storage().devices, dev(31, { name: "PC-31", vendor: "windows" })],
    knownMacs: [{ device_id: 2, mac: S }, { device_id: 31, mac: PC }],
    neighbors: [
      ...storage().neighbors,
      vic({ device_id: 1, local_port: "ether5", remote_device_name: "pc-31", remote_mac: PC, remote_port: "eth0", source: "device" }),
    ],
  });
  const m = cavi(ingresso(t1, { fattiPorta: [fp(1, "n:ether5", "ether5", { source: "device", bpdu_rx: 12 })] }));
  assert.deepEqual([m.classi.get("dev:2"), m.classi.get("dev:31")], ["da_sistemare", "da_sistemare"]);
});

test("§13.8.2: le capacità «bridge, router» con il nome di sistema sono una prova; senza nome no; per un server noto no", () => {
  const H = "02:00:00:00:00:40", SRV = "02:00:00:00:00:41";
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk })],
    hosts: [
      host(40, { ip: "10.0.1.40", mac: H, hostname: "SW-LAB-40", classification: "switch" }),
      host(41, { ip: "10.0.1.41", mac: SRV, hostname: "SRV-41", classification: "server" }),
    ],
  });
  const riga = (mac: string, nome: string, porta: string) =>
    vic({ device_id: 1, local_port: porta, remote_device_name: nome, remote_mac: mac, remote_port: "eth0", remote_caps: "bridge,router", source: "device" });
  // le stesse righe nel modello di oggi (che le capacità non le legge) e nel modello per cavo
  const ing = (righe: ViciniCaviRow[]): IngressoCavi => ({ ...ingresso({ ...t1, neighbors: righe }), vicini: righe });
  const con = ing([riga(H, "sw-lab-40", "ether6"), riga(SRV, "srv-41", "ether7")]);
  assert.equal(buildTopologyModel(con.t1).classiMappa?.["host:40"], "da_sistemare", "in T1b le capacità non ci sono");
  assert.equal(cavi(con).classi.get("host:40"), "infra");
  assert.deepEqual([proveCavi(con).get("host:40"), proveCavi(con).get("host:41")], [["capacita"], undefined], "un server noto annuncia «bridge, router» per il suo bridge");
  assert.equal(cavi(con).classi.get("host:41"), "att");
  // l'LLDP del firmware delle schede annuncia senza nome (sull'hub «bridge, telephone, docsis-cable-device»)
  assert.equal(cavi(ing([riga(H, "", "ether6")])).classi.get("host:40"), "da_sistemare");
  assert.equal(cavi(ing([riga(H, H, "ether6")])).classi.get("host:40"), "da_sistemare", "un MAC al posto del nome non è un nome di sistema");
});

test("eReteDalleCapacita: bridge, router, AP, nel formato dei lettori; non le altre", () => {
  assert.deepEqual(["bridge,router", "Bridge, Router", "router", "wlan-ap", "wlan", "bridge"].map(eReteDalleCapacita), [true, true, true, true, true, true]);
  assert.deepEqual(["station", "telephone", "docsis,other", "", null].map(eReteDalleCapacita), [false, false, false, false, false]);
});

// I65 nel modello per cavo: lo stato dello spanning tree dai fatti per porta vale solo se attivo, su una porta accesa.
test("I65: `disabled` non è spanning tree, né uno stato su una porta giù; uno stato attivo su una porta accesa sì", () => {
  const t1 = baseInput({ devices: [dev(2, { name: "SW-2", vendor: "altro" })] });
  const classe = (over: Parameters<typeof fp>[3]) => cavi(ingresso(t1, { fattiPorta: [fp(2, "i:1", "Port 1", { source: "snmp", ...over })] })).classi.get("dev:2");
  assert.equal(classe({ stp_state: "disabled" }), "da_sistemare", "`disabled` vuol dire spanning tree spento");
  assert.equal(classe({ stp_state: "broken" }), "da_sistemare");
  assert.equal(classe({ stp_state: "forwarding", running: 0 }), "da_sistemare", "su una porta giù ogni stato vale «giù»");
  assert.equal(classe({ stp_state: "forwarding" }), "infra");
  assert.equal(classe({ stp_state: "Discarding" }), "infra");
});

// §13.7.6 punto 3 e 4: il router sente sulla stessa porta le due radio di un ponte; la radio vicina è registrata server, la
// lontana è un host che la classificazione dice client.
test("§13.7.6 punto 4: il capo di un ponte radio sta sulla linea — un host «client» diventa «att», e sta in `ponti`", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(5, { name: "RADIO-V", device_type: "server", vendor: "mikrotik" })],
    hosts: [host(60, { ip: "10.0.1.60", hostname: "RADIO-L", classification: "workstation" })],
  });
  const m = cavi(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-V", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-L", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ] }));
  assert.deepEqual(m.collegamenti.filter((c) => c.genere === "radio").map((c) => [c.a.nodo, c.b.nodo].sort()), [["dev:5", "host:60"]]);
  assert.deepEqual([...m.ponti].sort(), ["dev:5", "host:60"]);
  assert.deepEqual([m.classi.get("host:60"), m.classi.get("dev:5")], ["att", "att"]);
});

test("classiCavi: un capo di un ponte radio non è mai «client» né «da sistemare»; gli altri come classeInMappa", () => {
  const nodi = [
    { id: "a", type: "workstation", vendor: null }, { id: "b", type: "switch", vendor: null }, { id: "c", type: "server", vendor: null },
    { id: "d", type: "workstation", vendor: null }, { id: "e", type: "switch", vendor: null }, { id: "f", type: "switch", vendor: null },
  ];
  const c = classiCavi(nodi, new Map([["f", ["capacita" as const]]]), (id) => (id === "e" ? "rete" : null), new Set(["a", "b", "c"]));
  assert.deepEqual(["a", "b", "c", "d", "e", "f"].map((id) => c.get(id)), ["att", "att", "att", "client", "infra", "infra"]);
});

// Decisione (Task 3 di T3): «legge vicini» (§13.8.2, `device_neighbors.device_id`) vale per ogni lettore che il modello per
// cavo legge e il modello di oggi no (SNMP, da T2): lo interroghiamo come apparato di rete. La lettura dal lato dell'host no:
// è un hypervisor letto come host, e un server registrato switch tornerebbe nell'albero.
test("§13.8.2: legge vicini anche con i lettori di T2 (SNMP); la lettura dal lato dell'host non è una prova", () => {
  const t1 = baseInput({ devices: [dev(2, { name: "SW-2", vendor: "altro", via: "snmp_v2" }), dev(9, { name: "HV-9", device_type: "switch", vendor: "altro" })] });
  const m = cavi(ingresso(t1, { vicini: [
    vic({ device_id: 2, local_port: "Gi1/0/1", local_port_index: 1, remote_device_name: "srv-a", remote_port: "eth0", source: "snmp" }),
    vic({ device_id: 9, local_port: "eno1", remote_device_name: "sw-b", remote_port: "Port 3", source: "host" }),
  ] }));
  assert.deepEqual([m.classi.get("dev:2"), m.classi.get("dev:9")], ["infra", "da_sistemare"]);
});
