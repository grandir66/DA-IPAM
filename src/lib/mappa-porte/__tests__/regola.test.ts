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
  hosts: [], macIp: [], vm: [], vlanPorte: [], pvid: [], nativa: [], vlanLetture: [], mkPorte: [], mkVlan: [], macNote: [], arp: [], lnmsArp: [], dhcp: [], mkVlanIf: [],
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
  // Dal 07/11 ha una riga sua (tutti gli apparati ce l'hanno): conta che la porta resti di bordo, non di passaggio.
  assert.equal(dov(i, `dev:${PC_COME_SWITCH}`).confidenza, "certa");
  assert.equal(dov(i, `dev:${PC_COME_SWITCH}`).tipoPorta, "terminale");
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

test("la VM accesa che nessuna tabella vede eredita la porta dell'hypervisor, dedotta; quella spenta c'è ma è vecchia", () => {
  const i = vuoto();
  i.porte = [porta(SW1, 9, "Port 9")];
  i.vicini = [{ device_id: HYP, local_port: "nic0", local_port_index: null, remote_device_name: "SW-UNO", remote_port: "Port 9", protocol: "lldp", remote_mac: null, source: "host" }];
  i.vm = [{ mac: mac(2), nome: "vm-due", acceso: true, nodo: "PX-UNO", apparatoScansione: HYP }, { mac: mac(3), nome: "vm-tre", acceso: false, nodo: "PX-UNO", apparatoScansione: HYP }];
  const o = dov(i, mac(2));
  assert.equal(o.dedotta, true);
  assert.equal(o.confidenza, "spiegata");
  assert.equal(o.portaChiave, "i:9");
  assert.equal(dov(i, mac(3)).vecchio, true);
  assert.equal(dov(i, mac(3)).deviceId, null);
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

test("MAC virtuale fuori; host online senza tabelle: non so; host offline senza tabelle: c'è, vecchio", () => {
  const i = vuoto();
  i.hosts = [
    { id: 1, ip: "192.0.2.10", mac: mac(1), hostname: "acceso", custom_name: null, vendor: null, classification: null, status: "online" },
    { id: 2, ip: "192.0.2.11", mac: mac(2), hostname: "spento", custom_name: null, vendor: null, classification: null, status: "offline" },
  ];
  i.macPorte = [riga(SW1, "00:00:5E:00:01:01", "Port 2")];
  const r = calcolaMappa(i);
  assert.ok(!r.oggetti.some((o) => o.chiave === "00:00:5E:00:01:01"));
  assert.equal(dov(i, mac(1)).ramo, "Nessuna tabella lo vede");
  assert.equal(dov(i, mac(2)).vecchio, true);
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
    chiave, categoria: "dispositivo", mac: chiave, macs: [chiave], ips: [], ip: null, nIp: 0, nome: null, tipo: null, hostId: null, apparatoId: null, confidenza, deviceId, apparato: `A${deviceId}`, portaChiave, porta: portaChiave, tipoPorta: null,
    vlan: null, ramo: null, perche: "", fonti: [], prove: [], conflitto: false, dedotta: false, vecchio: false, senzaHost: false, visto: null,
  });
  const s = trovaSpostamenti(
    [o("cavo", 1, "i:1"), o("ap", 3, "wifi"), o("ignoto", null, null, "non_so"), o("fermo", 1, "i:2"), o("ap2", 3, "wifi")],
    [o("cavo", 2, "i:5"), o("ap", 7, "wifi"), o("ignoto", 1, "i:9"), o("fermo", 1, "i:2"), o("ap2", 1, "i:7")],
  );
  assert.deepEqual(s.map((x) => x.chiave), ["cavo", "ap2"]);
});

// Riccardo, 07/11: «nella mappa mancano molti oggetti presenti anche in topologia».
const trova = (i: IngressoMappaPorte, c: string) => calcolaMappa(i).oggetti.find((x) => x.chiave === c);
const host = (id: number, ip: string, m: string | null, o: Record<string, unknown> = {}) => ({ id, ip, mac: m, hostname: null, custom_name: null, vendor: null, classification: null, status: "online", ...o });
const arp = (device_id: number, m: string, ip: string, o: Record<string, unknown> = {}) => ({ device_id, mac: m, ip, interface_name: "VL_5", timestamp: qui, status: "reachable", ...o });

test("un hypervisor con due schede è una riga sola, con i due MAC e le due porte fra le prove", () => {
  const i = vuoto();
  i.macNote = [{ device_id: HYP, mac: mac(0x10) }, { device_id: HYP, mac: mac(0x11) }];
  i.macPorte = [riga(SW1, mac(0x10), "Port 3"), riga(SW2, mac(0x11), "Port 4")];
  const r = calcolaMappa(i).oggetti;
  const o = r.find((x) => x.chiave === `dev:${HYP}`)!;
  assert.ok([mac(0x10), mac(0x11)].every((m) => o.macs.includes(m)));
  assert.equal(o.categoria, "apparato");
  assert.ok(o.deviceId != null, "ha una posizione");
  assert.equal(o.prove.length, 2);
  assert.match(o.perche, /visto anche su/);
  assert.equal(r.filter((x) => x.mac === mac(0x10) && x.chiave !== `dev:${HYP}`).length, 0, "nessuna riga per scheda");
});

test("ogni apparato in inventario ha la sua riga, anche se nessuna tabella lo vede", () => {
  const i = vuoto();
  i.apparati.push({ id: 7, name: "SRV-SENZA-MAC", device_type: "server", protocol: "winrm" });
  i.macNote = [{ device_id: PC_COME_SWITCH, mac: mac(0x12) }];
  assert.match(trova(i, "dev:7")?.ramo ?? "", /Nessun MAC/);
  assert.equal(trova(i, `dev:${PC_COME_SWITCH}`)?.confidenza, "non_so");
});

test("l'host di uno switch si fonde nella riga dello switch: niente doppioni", () => {
  const i = vuoto();
  i.macNote = [{ device_id: SW1, mac: mac(0x13) }];
  i.hosts = [host(1, "192.0.2.5", mac(0x13), { classification: "switch" })];
  const r = calcolaMappa(i).oggetti;
  assert.equal(r.filter((x) => x.mac === mac(0x13)).length, 0);
  const o = r.find((x) => x.chiave === `dev:${SW1}`)!;
  assert.ok(o.macs.includes(mac(0x13)));
  assert.deepEqual(o.ips, ["192.0.2.5"]);
  assert.equal(o.hostId, 1);
});

test("un MAC che sta solo nell'ARP del router c'è, resta «non so» e dice dove è stato visto", () => {
  const i = vuoto();
  i.arp = [arp(RT, mac(0x14), "192.0.2.14")];
  i.mkVlanIf = [{ device_id: RT, name: "VL_5", vlan_id: 5 }];
  const o = trova(i, mac(0x14))!;
  assert.equal(o.confidenza, "non_so");
  assert.equal(o.deviceId, null, "la posizione non si inventa");
  assert.match(o.ramo ?? "", /RT-UNO · VL_5/);
  assert.equal(o.vlan, 5);
  assert.ok(o.fonti.includes("ARP"));
  assert.equal(o.prove[0].tipo, "vista");
});

test("ARP fallito, incompleto, multicast, tutti zeri e MAC virtuali non sono oggetti", () => {
  const i = vuoto();
  i.arp = [arp(RT, mac(0x15), "192.0.2.15", { status: "failed" }), arp(RT, mac(0x16), "192.0.2.16", { status: "incomplete" }), arp(RT, "01:00:5E:00:00:01", "224.0.0.1"), arp(RT, "00:00:00:00:00:00", "192.0.2.17"), arp(RT, "00:00:5E:00:01:01", "192.0.2.18")];
  assert.equal(calcolaMappa(i).oggetti.filter((o) => o.categoria === "dispositivo").length, 0);
});

test("lease DHCP e storico portano nome e IP; più IP sullo stesso MAC si tengono tutti", () => {
  const i = vuoto();
  i.dhcp = [{ source_device_id: RT, source_name: null, ip_address: "192.0.2.20", mac_address: mac(0x17), hostname: "stampante", scope_name: "LAN", last_seen: qui, last_synced: qui }];
  i.macIp = [{ mac_normalized: mac(0x17), ip: "192.0.2.21", hostname: null, vendor: null, last_seen: qui }];
  i.arp = [arp(RT, mac(0x17), "192.0.2.22")];
  const o = trova(i, mac(0x17))!;
  assert.deepEqual(o.ips, ["192.0.2.20", "192.0.2.21", "192.0.2.22"]);
  assert.equal(o.nIp, 3);
  assert.equal(o.nome, "stampante");
  assert.equal(o.senzaHost, true);
});

test("gli IP dell'ARP arrivano anche a chi ha già una posizione", () => {
  const i = vuoto();
  i.macPorte = [riga(SW1, mac(0x18), "Port 5")];
  i.arp = [arp(RT, mac(0x18), "192.0.2.30"), arp(RT, mac(0x18), "192.0.2.31")];
  const o = trova(i, mac(0x18))!;
  assert.ok(o.deviceId != null);
  assert.equal(o.nIp, 2);
});

test("un avvistamento vecchio è vecchio, l'host offline c'è, l'host senza MAC c'è", () => {
  const i = vuoto();
  i.arp = [arp(RT, mac(0x19), "192.0.2.40", { timestamp: "2026-10-01 10:00:00" })];
  i.hosts = [host(2, "192.0.2.41", mac(0x1a), { status: "offline" }), host(3, "192.0.2.42", null)];
  assert.equal(trova(i, mac(0x19))?.vecchio, true);
  assert.equal(trova(i, mac(0x1a))?.vecchio, true);
  const m = trova(i, "ip:192.0.2.42")!;
  assert.equal(m.vecchio, false);
  assert.deepEqual(m.macs, []);
});

test("una VM con due schede è una riga sola; una VM spenta c'è ma è vecchia", () => {
  const i = vuoto();
  i.vm = [
    { mac: mac(0x1b), nome: "vm-due", acceso: true, nodo: "px", apparatoScansione: HYP }, { mac: mac(0x1c), nome: "vm-due", acceso: true, nodo: "px", apparatoScansione: HYP },
    { mac: mac(0x1d), nome: "vm-spenta", acceso: false, nodo: "px", apparatoScansione: HYP },
  ];
  i.macPorte = [riga(SW1, mac(0x1b), "Port 6")];
  const r = calcolaMappa(i).oggetti.filter((o) => o.nome?.startsWith("vm-"));
  assert.equal(r.length, 2);
  assert.deepEqual(r.find((o) => o.nome === "vm-due")?.macs, [mac(0x1b), mac(0x1c)]);
  assert.equal(r.find((o) => o.nome === "vm-spenta")?.vecchio, true);
});

test("le tabelle di LibreNMS danno posizioni come le altre", () => {
  const i = vuoto();
  i.macPorte = [riga(SW1, mac(0x1e), "Port 9", { source: "librenms" })];
  const o = trova(i, mac(0x1e))!;
  assert.equal(o.deviceId, SW1);
  assert.ok(o.fonti.includes("LibreNMS"));
});

// Hypervisor come gli switch per le porte (Riccardo, 08/11): la tabella MAC del bridge di Proxmox dice su quale porta sta la VM.
test("hypervisor: la VM sulla porta della sua scheda nel bridge è certa, e la porta dello switch verso il nodo resta «hypervisor»", () => {
  const i = vuoto();
  const vm1 = "BC:24:11:00:01:00", vm2 = "BC:24:11:00:01:01";
  i.vm = [{ mac: vm1, nome: "vm-uno", acceso: true, nodo: "PX-UNO", apparatoScansione: HYP }, { mac: vm2, nome: "vm-due", acceso: true, nodo: "PX-UNO", apparatoScansione: HYP }];
  i.macPorte = [
    riga(SW1, vm1, "Port 5"), riga(SW1, vm2, "Port 5"), riga(SW1, mac(0xa6), "Port 5"),
    riga(HYP, vm1, "tap100i0", { source: "parser" }), riga(HYP, vm2, "fwpr101p0", { source: "parser" }), riga(HYP, mac(9), "bond0", { source: "parser" }), riga(HYP, mac(10), "bond0", { source: "parser" }),
  ];
  const r = calcolaMappa(i);
  const uno = r.oggetti.find((o) => o.chiave === vm1)!;
  assert.equal(uno.confidenza, "certa");
  assert.equal(uno.apparato, "PX-UNO.dominio.test");
  assert.equal(uno.porta, "tap100i0");
  assert.equal(r.oggetti.find((o) => o.chiave === vm2)!.porta, "fwpr101p0");
  const p5 = r.porte.find((p) => p.deviceId === SW1 && p.chiave === "i:5");
  assert.equal(p5?.tipo, "hypervisor", "il MAC del nodo non fa della porta un passaggio");
  assert.ok(r.porte.some((p) => p.deviceId === HYP && p.nome === "bond0"), "le porte del nodo sono nella scheda Porte");
});

test("hypervisor: un MAC visto solo sull'uplink del nodo è «non so», detto come hypervisor e non come router", () => {
  const i = vuoto();
  i.macPorte = [riga(HYP, mac(9), "bond0", { source: "parser" }), riga(HYP, mac(10), "bond0", { source: "parser" })];
  const o = dov(i, mac(9));
  assert.equal(o.confidenza, "non_so");
  assert.match(o.ramo ?? "", /Solo sull'hypervisor PX-UNO/);
});

test("hypervisor: una porta non da VM con un solo MAC non ruba la posizione", () => {
  const i = vuoto();
  i.macPorte = [riga(HYP, mac(9), "bond0", { source: "parser" }), riga(SW1, mac(9), "Port 9")];
  const o = dov(i, mac(9));
  assert.equal(o.apparato, "SW-UNO");
});
