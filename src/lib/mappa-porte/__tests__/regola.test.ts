// La regola della Mappa porte: dati finti con la forma vera dell'hub (IP 192.0.2.x, MAC 02:00:00:…).
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcolaMappa, trovaSpostamenti } from "@/lib/mappa-porte/regola";
import type { IngressoMappaPorte, OggettoMappa, RigaMacPorta, RigaPorta } from "@/lib/mappa-porte/tipi";

const ORA = Date.parse("2026-11-07T12:00:00Z");
const qui = "2026-11-07 11:30:00";
const mac = (n: number) => `02:00:00:00:00:${n.toString(16).padStart(2, "0").toUpperCase()}`;
const SW1 = 1, SW2 = 2, AP = 3, RT = 4, PC_COME_SWITCH = 5, HYP = 6;

const vuoto = (): IngressoMappaPorte => ({
  nowMs: ORA, staleDays: 2,
  apparati: [
    { id: SW1, name: "SW-UNO", device_type: "switch", protocol: "snmp_v2" },
    { id: SW2, name: "SW-DUE", device_type: "switch", protocol: "snmp_v2" },
    { id: AP, name: "AP-UNO", device_type: "access_point", protocol: "api" },
    { id: RT, name: "RT-UNO", device_type: "router", protocol: "ssh" },
    { id: PC_COME_SWITCH, name: "PC-ZERO", device_type: "switch", protocol: "winrm" },
    { id: HYP, name: "PX-UNO.dominio.test", device_type: "hypervisor", protocol: "ssh" },
  ],
  macPorte: [], porte: [], vicini: [], fatti: [],
  macApparati: [{ device_id: SW1, mac: mac(0xa1) }, { device_id: SW2, mac: mac(0xa2) }, { device_id: AP, mac: mac(0xa3) }, { device_id: RT, mac: mac(0xa4) }, { device_id: HYP, mac: mac(0xa6) }],
  hosts: [], macIp: [], vm: [], vlanPorte: [], pvid: [], nativa: [], vlanLetture: [], mkPorte: [], mkVlan: [],
});
const riga = (device_id: number, m: string, port_name: string, o: Partial<RigaMacPorta> = {}): RigaMacPorta => ({ device_id, mac: m, port_name, vlan: null, timestamp: qui, source: "device", ...o });
const porta = (device_id: number, port_index: number, port_name: string, o: Partial<RigaPorta> = {}): RigaPorta => ({
  device_id, port_index, port_name, status: "up", speed: "1000", vlan: null, poe_status: null, poe_power_mw: null, stp_state: null, is_uplink: 0, ...o,
});
const lldp = (device_id: number, local_port: string, remote: string) => ({ device_id, local_port, local_port_index: null, remote_device_name: remote, remote_port: "Port 1", protocol: "lldp", remote_mac: null, source: "unifi" });
const dov = (i: IngressoMappaPorte, m: string): OggettoMappa => {
  const o = calcolaMappa(i).oggetti.find((x) => x.chiave === m);
  assert.ok(o, `oggetto ${m} assente`);
  return o;
};

test("un MAC da solo su una porta di bordo è certo, anche se lo vede tutta la catena", () => {
  const i = vuoto();
  i.vicini = [lldp(SW1, "Port 48", "SW-DUE"), lldp(SW2, "Port 1", "SW-UNO")];
  i.macPorte = [riga(SW1, mac(1), "Port 48"), riga(SW2, mac(1), "Port 7"), riga(RT, mac(1), "ether1")];
  const o = dov(i, mac(1));
  assert.equal(o.confidenza, "certa");
  assert.equal(o.apparato, "SW-DUE");
  assert.equal(o.portaChiave, "i:7");
});

test("fra porte di passaggio non si sceglie: «non so» col ramo, mai la porta con meno MAC", () => {
  const i = vuoto();
  i.vicini = [lldp(SW1, "Port 48", "SW-DUE")];
  i.macPorte = [riga(SW1, mac(1), "Port 48")];
  const o = dov(i, mac(1));
  assert.equal(o.confidenza, "non_so");
  assert.equal(o.deviceId, null);
  assert.match(o.ramo ?? "", /A valle di SW-UNO/);
});

test("una porta che vede il MAC di un altro apparato è di passaggio anche senza LLDP", () => {
  const i = vuoto();
  i.macPorte = [riga(SW1, mac(0xa2), "Port 3"), riga(SW1, mac(1), "Port 3")];
  assert.equal(dov(i, mac(1)).confidenza, "non_so");
  assert.equal(calcolaMappa(i).porte.find((p) => p.deviceId === SW1 && p.chiave === "i:3")?.tipo, "passaggio");
});

test("il proprio MAC sulla porta CPU non rende di passaggio una porta", () => {
  const i = vuoto();
  i.macPorte = [riga(SW1, mac(0xa1), "Port 3"), riga(SW1, mac(1), "Port 3")];
  assert.equal(dov(i, mac(1)).confidenza, "certa");
});

test("un PC registrato come switch non è un apparato di rete", () => {
  const i = vuoto();
  i.macApparati.push({ device_id: PC_COME_SWITCH, mac: mac(0xa5) });
  i.macPorte = [riga(SW1, mac(0xa5), "Port 3")];
  assert.equal(dov(i, mac(0xa5)).confidenza, "certa");
  assert.ok(!calcolaMappa(i).oggetti.some((o) => o.chiave === `dev:${PC_COME_SWITCH}`));
});

test("un vicino LLDP che non è un apparato di rete (telefono, hypervisor) non fa la porta di passaggio", () => {
  const i = vuoto();
  i.vicini = [lldp(SW1, "Port 4", "SIP-T46G")];
  i.macPorte = [riga(SW1, mac(1), "Port 4")];
  assert.equal(dov(i, mac(1)).confidenza, "certa");
});

test("il MAC di un hypervisor non fa la porta di passaggio: le VM stanno sulla sua porta, spiegate", () => {
  const i = vuoto();
  i.vm = [{ mac: mac(2), nome: "vm-due", acceso: true, nodo: "PX-UNO", apparatoScansione: HYP }];
  i.macPorte = [riga(SW1, mac(0xa6), "Port 9"), riga(SW1, mac(2), "Port 9"), riga(SW1, "BC:24:11:00:00:03", "Port 9")];
  const o = dov(i, mac(2));
  assert.equal(o.confidenza, "spiegata");
  assert.equal(o.tipoPorta, "hypervisor");
  assert.equal(o.nome, "vm-due");
});

test("la VM accesa che nessuna tabella vede eredita la porta dell'hypervisor, dedotta; quella spenta non c'è", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 9, "Port 9")];
  i.vicini = [{ device_id: HYP, local_port: "nic0", local_port_index: null, remote_device_name: "SW-UNO", remote_port: "Port 9", protocol: "lldp", remote_mac: null, source: "host" }];
  i.vm = [{ mac: mac(2), nome: "vm-due", acceso: true, nodo: "PX-UNO", apparatoScansione: HYP }, { mac: mac(3), nome: "vm-tre", acceso: false, nodo: "PX-UNO", apparatoScansione: HYP }];
  const o = dov(i, mac(2));
  assert.equal(o.dedotta, true);
  assert.equal(o.confidenza, "spiegata");
  assert.equal(o.portaChiave, "i:9");
  assert.ok(!calcolaMappa(i).oggetti.some((x) => x.chiave === mac(3)));
});

test("telefono + PC è spiegata, più MAC senza motivo è da capire", () => {
  const i = vuoto();
  i.hosts = [{ id: 1, ip: "192.0.2.10", mac: mac(1), hostname: "tel", custom_name: null, vendor: null, classification: "voip", status: "online" }];
  i.macPorte = [riga(SW1, mac(1), "Port 2"), riga(SW1, mac(2), "Port 2"), riga(SW1, mac(3), "Port 3"), riga(SW1, mac(4), "Port 3"), riga(SW1, mac(5), "Port 3")];
  assert.equal(dov(i, mac(2)).confidenza, "spiegata");
  assert.equal(dov(i, mac(2)).tipoPorta, "telefono_pc");
  assert.equal(dov(i, mac(3)).confidenza, "da_capire");
});

test("due porte di bordo nello stesso giro: da capire col segno, una lettura vecchia di ore perde", () => {
  const i = vuoto();
  i.macPorte = [riga(SW1, mac(1), "Port 2"), riga(SW2, mac(1), "Port 5"), riga(SW1, mac(2), "Port 3", { timestamp: "2026-11-07 01:00:00" }), riga(SW2, mac(2), "Port 6")];
  const a = dov(i, mac(1));
  assert.equal(a.confidenza, "da_capire");
  assert.equal(a.conflitto, true);
  const b = dov(i, mac(2));
  assert.equal(b.conflitto, false);
  assert.equal(b.apparato, "SW-DUE");
});

test("controller: vince su una porta di bordo, e sulla porta che SNMP confonde col LAG (ProMax, 07/11)", () => {
  const i = vuoto();
  // SNMP mette su Port1 i MAC del LAG: la porta vede un altro apparato; il controller vede un client solo.
  i.macPorte = [riga(SW1, mac(0xa2), "Port1"), riga(SW1, mac(7), "Port1"), riga(SW1, mac(1), "Port1"), riga(SW1, mac(1), "Port 1", { source: "unifi" })];
  const o = dov(i, mac(1));
  assert.equal(o.confidenza, "certa");
  assert.equal(o.portaChiave, "i:1");
  assert.equal(dov(i, mac(7)).confidenza, "non_so");
});

test("controller su una porta con LLDP verso un apparato: non cede, il client sta più a valle", () => {
  const i = vuoto();
  i.vicini = [lldp(SW1, "Port 1", "SW-DUE")];
  i.macPorte = [riga(SW1, mac(1), "Port 1", { source: "unifi" })];
  assert.equal(dov(i, mac(1)).confidenza, "non_so");
});

test("wifi: vale l'AP più recente, e la porta dell'AP non conta come posizione", () => {
  const i = vuoto();
  i.vicini = [lldp(SW1, "Port 4", "AP-UNO")];
  i.macPorte = [riga(AP, mac(1), "wifi", { source: "unifi" }), riga(SW1, mac(1), "Port 4")];
  const o = dov(i, mac(1));
  assert.equal(o.confidenza, "certa");
  assert.equal(o.apparato, "AP-UNO");
  assert.equal(o.tipoPorta, "wifi");
});

test("solo sul router: non so, col nome del router", () => {
  const i = vuoto();
  i.macPorte = [riga(RT, mac(1), "ether1")];
  const o = dov(i, mac(1));
  assert.equal(o.confidenza, "non_so");
  assert.match(o.ramo ?? "", /RT-UNO/);
});

test("MAC virtuale fuori; host online senza tabelle: non so; host offline senza tabelle: fuori", () => {
  const i = vuoto();
  i.hosts = [
    { id: 1, ip: "192.0.2.10", mac: mac(1), hostname: "acceso", custom_name: null, vendor: null, classification: null, status: "online" },
    { id: 2, ip: "192.0.2.11", mac: mac(2), hostname: "spento", custom_name: null, vendor: null, classification: null, status: "offline" },
  ];
  i.macPorte = [riga(SW1, "00:00:5E:00:01:01", "Port 2")];
  const r = calcolaMappa(i);
  assert.ok(!r.oggetti.some((o) => o.chiave === "00:00:5E:00:01:01"));
  assert.equal(dov(i, mac(1)).ramo, "Nessuna tabella lo vede");
  assert.ok(!r.oggetti.some((o) => o.chiave === mac(2)));
});

test("non visto oltre la soglia: resta nell'elenco, fuori dai conteggi e senza contare sulla porta", () => {
  const i = vuoto();
  i.macPorte = [riga(SW1, mac(1), "Port 2", { timestamp: "2026-10-20 10:00:00" })];
  const r = calcolaMappa(i);
  assert.equal(dov(i, mac(1)).vecchio, true);
  assert.equal(r.conteggi.certe, 0);
  assert.equal(r.porte.find((p) => p.chiave === "i:2")?.nMac, 0);
});

test("LAG: i membri non sono porte a sé, i MAC si contano sull'aggregato e la riga è una sola", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 19, "Port 19", { speed: "10000", poe_status: "delivering", poe_power_mw: 1000 }), porta(SW1, 20, "Port 20", { poe_status: "delivering", poe_power_mw: 2000 }), porta(SW1, 60, "Link Aggregate 4")];
  i.fatti = [19, 20].map((n) => ({ device_id: SW1, source: "controller", port_name: `Port ${n}`, port_index: n, lag_group: "lag:4" }));
  i.macPorte = [riga(SW1, mac(1), "Link Aggregate 4"), riga(SW1, mac(2), "Port 19", { source: "unifi" }), riga(SW1, mac(3), "Port 20", { source: "unifi" })];
  const r = calcolaMappa(i);
  const dello = r.porte.filter((p) => p.deviceId === SW1);
  assert.equal(dello.length, 1);
  assert.equal(dello[0].chiave, "lag:4");
  assert.equal(dello[0].nome, "LAG 4");
  assert.deepEqual(dello[0].membri, ["Port 19", "Port 20"]);
  assert.equal(dello[0].nMac, 3);
  assert.equal(dello[0].poeMw, 3000);
  assert.equal(dov(i, mac(1)).portaChiave, "lag:4");
  assert.equal(dov(i, mac(2)).portaChiave, "lag:4");
});

test("modo: il trunk viene dalle VLAN tagged, mai da quanti MAC ci sono; accesso e non letto", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 1, "Port 1"), porta(SW1, 2, "Port 2"), porta(SW1, 3, "Port 3")];
  i.vlanPorte = [
    { device_id: SW1, vlan_id: 10, if_index: 1, egress: 1, untagged: 1 }, { device_id: SW1, vlan_id: 20, if_index: 1, egress: 1, untagged: 0 },
    { device_id: SW1, vlan_id: 10, if_index: 2, egress: 1, untagged: 1 },
  ];
  i.pvid = [{ device_id: SW1, if_index: 1, pvid: 10 }, { device_id: SW1, if_index: 2, pvid: 10 }];
  i.macPorte = [riga(SW1, mac(1), "Port 2"), riga(SW1, mac(2), "Port 2"), riga(SW1, mac(3), "Port 2")];
  const p = calcolaMappa(i).porte;
  const x = (k: string) => p.find((q) => q.deviceId === SW1 && q.chiave === k)!;
  assert.equal(x("i:1").modo, "trunk");
  assert.deepEqual(x("i:1").vlanTagged, [20]);
  assert.equal(x("i:2").modo, "accesso");
  assert.equal(x("i:2").pvid, 10);
  assert.equal(x("i:3").modo, "non_letto");
  assert.equal(x("i:3").datoVlan, "non_letto");
});

test("ProMax: senza untagged il modo è dedotto, e la nativa del controller vince sul PVID", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 1, "Port 1"), porta(SW1, 2, "Port 2")];
  i.vlanLetture = [{ device_id: SW1, ordine_bit: "inverso" }];
  i.vlanPorte = [
    { device_id: SW1, vlan_id: 10, if_index: 1, egress: 1, untagged: null }, { device_id: SW1, vlan_id: 20, if_index: 1, egress: 1, untagged: null },
    { device_id: SW1, vlan_id: 10, if_index: 2, egress: 1, untagged: null },
  ];
  i.pvid = [{ device_id: SW1, if_index: 2, pvid: 5 }];
  i.nativa = [{ device_id: SW1, if_index: 2, vlan_id: 10 }];
  const p = calcolaMappa(i).porte;
  assert.equal(p[0].modo, "trunk");
  assert.equal(p[0].datoVlan, "dedotto");
  assert.equal(p[1].modo, "accesso");
  assert.equal(p[1].pvid, 10);
});

test("PoE assente resta assente, mai 0; spanning tree bloccato si vede", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 1, "Port 1", { stp_state: "blocking" })];
  const p = calcolaMappa(i).porte[0];
  assert.equal(p.poeStato, null);
  assert.equal(p.poeMw, null);
  assert.equal(p.stp, "blocking");
});

test("aggregati e interfacce logiche mai usati non sono porte; quelli con un vicino o dei MAC restano", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 60, "Link Aggregate 2", { status: "down" }), porta(SW1, 70, "Port-Channel3", { status: "down" }), porta(SW1, 71, "tunnel1", { status: "down" }), porta(SW1, 1, "Port 1", { status: "down" }), porta(SW1, 72, "Port-Channel4", { status: "down" })];
  i.macPorte = [riga(SW1, mac(1), "Port-Channel4")];
  assert.deepEqual(calcolaMappa(i).porte.map((p) => p.nome).sort(), ["Port 1", "Port-Channel4"]);
});

test("gli apparati di rete hanno una riga, dal vicino che li annuncia", () => {
  const i = vuoto();
  i.vicini = [lldp(SW1, "Port 48", "SW-DUE")];
  const r = calcolaMappa(i);
  const o = r.oggetti.find((x) => x.chiave === `dev:${SW2}`)!;
  assert.equal(o.categoria, "apparato");
  assert.equal(o.apparato, "SW-UNO");
  assert.equal(r.oggetti.find((x) => x.chiave === `dev:${SW1}`)?.confidenza, "non_so");
});

test("spostamenti: fra posizioni fidate, non da AP ad AP, non da «non so»", () => {
  const o = (chiave: string, deviceId: number | null, portaChiave: string | null, confidenza: OggettoMappa["confidenza"] = "certa"): OggettoMappa => ({
    chiave, categoria: "dispositivo", mac: chiave, ip: null, nIp: 0, nome: null, tipo: null, hostId: null, apparatoId: null, confidenza, deviceId, apparato: `A${deviceId}`, portaChiave, porta: portaChiave, tipoPorta: null,
    vlan: null, ramo: null, perche: "", fonti: [], prove: [], conflitto: false, dedotta: false, vecchio: false, senzaHost: false, visto: null,
  });
  const s = trovaSpostamenti(
    [o("cavo", 1, "i:1"), o("ap", 3, "wifi"), o("ignoto", null, null, "non_so"), o("fermo", 1, "i:2"), o("ap2", 3, "wifi")],
    [o("cavo", 2, "i:5"), o("ap", 7, "wifi"), o("ignoto", 1, "i:9"), o("fermo", 1, "i:2"), o("ap2", 1, "i:7")],
  );
  assert.deepEqual(s.map((x) => x.chiave), ["cavo", "ap2"]);
});
