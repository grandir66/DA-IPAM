// Spec topologia §13.4.6 e §13.15 punto 6: «Perché questo collegamento» in forma corta, una frase per fonte di oggi e il
// motivo delle righe scartate sulla coppia. Il 14/10 «perché quella porta e non il 10G?» aveva la risposta solo nel codice.
// Dati inventati con la forma vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frasiPerche, type ParoleFrasi } from "@/lib/topology/cavi/frasi";
import { dettoInFrase } from "@/lib/topology/edge-look";
import { buildTopologyModel } from "@/lib/topology/model";
import type { ModelNeighborRow, ModelVmRow, PassoPerche, TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";
import { soloMikrotik } from "./support/reti-campione";

const ORA = "2026-10-13 11:00:00", ORA_C = "2026-10-13 03:00:00";
const NOMI: Readonly<Record<string, string>> = { "dev:1": "RTR-1", "dev:2": "SW-2", "dev:9": "PVE-9" };
const P: ParoleFrasi = { nome: (id) => NOMI[id] ?? id, detto: dettoInFrase, ora: (s) => s.slice(11, 16), giorno: (s) => s.slice(0, 10) };
const frasi = (perche: PassoPerche[], confermato = false) => frasiPerche({ perche, manual: confermato ? { confirmed: true } : null }, P);

test("LLDP, righe dello stesso apparato, due capi", () => {
  assert.deepEqual(frasi([
    { tipo: "vicino", da: "dev:1", porta: "ether3", altro: "dev:2", portaRemota: "Port 3", fonte: "lldp", visto: ORA, altreRighe: 2 },
    { tipo: "vicino", da: "dev:2", porta: "Port 3", altro: "dev:1", portaRemota: "ether3", fonte: "lldp", visto: ORA, altreRighe: 0 },
  ]), [
    "RTR-1 vede SW-2 via LLDP sulla porta ether3 (porta remota Port 3), letto alle 11:00, e altre 2 righe di SW-2 dalle sue VLAN o VRRP: contate una volta sola.",
    "SW-2 vede RTR-1 sulla porta Port 3: il cavo è confermato dai due capi.",
  ]);
});

test("un annuncio di rete come sola prova: la parola del lettore; la porta remota non nota si dice", () => {
  assert.deepEqual(frasi([{ tipo: "vicino", da: "dev:1", porta: "ether3", altro: "dev:2", portaRemota: "", fonte: "mndp", visto: null, altreRighe: 0 }]),
    ["RTR-1 vede SW-2 via un annuncio di rete (MNDP o CDP) sulla porta ether3 (porta remota non nota)."]);
});

test("uplink del controller: la stessa osservazione dell'LLDP, e la porta del padre dalla stessa prova", () => {
  assert.deepEqual(frasi([{ tipo: "uplink", figlio: "dev:2", porta: "Port 10", padre: "dev:1", dallaRiga: true, stessaOsservazione: true }]), [
    "Il controller dice che SW-2 esce dalla porta Port 10 verso RTR-1; lo calcola dall'LLDP di SW-2: è la stessa osservazione, non una seconda prova.",
    "La porta di RTR-1 viene dalla stessa prova LLDP sulla porta Port 10.",
  ]);
  assert.deepEqual(frasi([{ tipo: "uplink", figlio: "dev:2", porta: "", padre: "dev:1", dallaRiga: false, stessaOsservazione: false }]),
    ["Il controller dice che SW-2 esce verso RTR-1."]);
});

test("a mano, tabella MAC, ripiego del router, VM", () => {
  assert.deepEqual(frasi([{ tipo: "a_mano", utente: "admin", quando: "2026-10-14 08:07:00" }], true), ["Collegato a mano da admin il 2026-10-14; confermato dai dati."]);
  assert.deepEqual(frasi([{ tipo: "a_mano", utente: null, quando: null }]), ["Collegato a mano; non visto dai dati."]);
  assert.deepEqual(frasi([
    { tipo: "tabella_mac", da: "dev:2", porta: "Port 8", altro: "dev:9", visto: ORA, router: false },
    { tipo: "tabella_mac", da: "dev:1", porta: "ether7", altro: "dev:9", visto: ORA, router: true },
    { tipo: "vm", da: "dev:2", porta: "Port 5", hypervisor: "dev:9", vm: 3, visto: ORA },
    { tipo: "vm", da: "dev:2", porta: "Port 6", hypervisor: "dev:9", vm: 1, visto: null },
  ]), [
    "Dedotto: il MAC di PVE-9 è visto sulla porta Port 8 di SW-2 (tabella MAC, letta alle 11:00).",
    "Dedotto: il MAC di PVE-9 è visto sulla porta ether7 del router RTR-1 (tabella MAC, letta alle 11:00): nessuno switch lo vede su una porta di bordo.",
    "Dedotto: 3 VM accese di PVE-9 sono viste sulla porta Port 5 di SW-2 (tabella MAC, letta alle 11:00).",
    "Dedotto: 1 VM accesa di PVE-9 è vista sulla porta Port 6 di SW-2 (tabella MAC).",
  ]);
});

test("§13.15 punto 6 — il motivo delle righe scartate: segmento e stessa rete", () => {
  assert.deepEqual(frasi([
    { tipo: "scartata", motivo: "segmento", da: "dev:1", porta: "ether8", sentiti: [{ nodo: "dev:2", nome: "SW-2" }, { nodo: null, nome: "modem-fibra" }] },
    { tipo: "scartata", motivo: "stessa_rete", da: "dev:1", porta: "vlan10-uffici", altro: "dev:2", fonte: "mndp" },
  ]), [
    "Sulla porta ether8 RTR-1 sente 2 apparati (SW-2, modem-fibra): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).",
    "RTR-1 sente SW-2 con un annuncio di rete (MNDP o CDP) sulla porta vlan10-uffici: sono nella stessa rete, ma questo non prova un cavo.",
  ]);
});

test("l'ordine è fisso — a mano, vicini, uplink, dedotti, scartate — e non quello in cui arrivano le prove", () => {
  const f = frasi([
    { tipo: "scartata", motivo: "stessa_rete", da: "dev:1", porta: "bridge", altro: "dev:2", fonte: "lldp" },
    { tipo: "uplink", figlio: "dev:2", porta: "Port 1", padre: "dev:1", dallaRiga: false, stessaOsservazione: false },
    { tipo: "vicino", da: "dev:2", porta: "Port 1", altro: "dev:1", portaRemota: "ether2", fonte: "lldp", visto: ORA, altreRighe: 0 },
  ]);
  assert.deepEqual(f.map((x) => x.split(" ")[0]), ["SW-2", "Il", "RTR-1"]);
});

// ─── Sul modello: la sede 1 del cliente A in piccolo (forma vera; nomi e MAC inventati) ───
// Router 1 sente core 1 e il router di riserva sulla stessa porta (il segmento della WAN); core 1 sente i due router sulla
// sua porta 15 e sale al router con l'uplink del controller, che non sa la porta del router.
const RTR = "02:00:00:00:00:01", CORE = "02:00:00:00:01:14", RIS = "02:00:00:00:00:07";
const riga = (device_id: number, local_port: string, remote_device_name: string, remote_port: string, remote_mac: string, extra: Partial<ModelNeighborRow> = {}): ModelNeighborRow =>
  ({ device_id, local_port, remote_device_name, remote_port, protocol: "lldp", remote_ip: null, remote_mac, timestamp: ORA, source: "device", ...extra });
const porta = (device_id: number, port_index: number, port_name: string) => ({ device_id, port_index, port_name, speed: null, status: "up", stp_state: null });

function sedeInPiccolo(): TopologyModelInput {
  const c = { source: "unifi", timestamp: ORA_C };
  return baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }),
      dev(114, { name: "CORE-1", controller_mac: CORE, uplink_mac: RTR, uplink_seen_at: ORA_C, via: "api" }),
    ],
    hosts: [host(7, { ip: "10.0.9.2", mac: RIS, hostname: "RTR-RISERVA", classification: "router" })],
    knownMacs: [{ device_id: 1, mac: RTR }],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Uplink verso il router" }],
    ports: [porta(1, 8, "ether8"), porta(1, 9, "sfp-sfpplus1"), porta(1, 10, "bridge"), porta(114, 10, "Uplink verso il router"), porta(114, 15, "Port 15 - WAN")],
    neighbors: [
      riga(1, "sfp-sfpplus1,bridge", "CORE-1", "Uplink verso il router", CORE),
      riga(1, "ether8", "CORE-1", "Port 15 - WAN", CORE),
      riga(1, "ether8", "RTR-RISERVA", "bridge/ether8", RIS, { remote_platform: "MikroTik" }),
      riga(114, "Uplink verso il router", "RTR-1", "sfp-sfpplus1", RTR, c),
      riga(114, "Port 15 - WAN", "RTR-1", "ether8", RTR, c),
      riga(114, "Port 15 - WAN", "RTR-RISERVA", "ether8", RIS, c),
    ],
  });
}
const paroleDi = (m: TopologyModel): ParoleFrasi => ({ ...P, nome: (id) => m.nodes.find((n) => n.id === id)?.name ?? id });

test("la linea router 1 – core 1: i due capi, l'uplink, e perché ether8 e la porta 15 non sono un cavo", () => {
  const m = buildTopologyModel(sedeInPiccolo());
  const l = m.links.find((x) => x.id === "link:dev:1|dev:114")!;
  assert.deepEqual(frasiPerche(l, paroleDi(m)), [
    "RTR-1 vede CORE-1 via LLDP sulla porta sfp-sfpplus1 (porta remota Uplink verso il router), letto alle 11:00.",
    "CORE-1 vede RTR-1 sulla porta Uplink verso il router: il cavo è confermato dai due capi.",
    "Il controller dice che CORE-1 esce dalla porta Uplink verso il router verso RTR-1; lo calcola dall'LLDP di CORE-1: è la stessa osservazione, non una seconda prova.",
    "La porta di RTR-1 viene dalla stessa prova LLDP sulla porta Uplink verso il router.",
    "Sulla porta ether8 RTR-1 sente 2 apparati (CORE-1, RTR-RISERVA): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).",
    "Sulla porta Port 15 - WAN CORE-1 sente 2 apparati (RTR-1, RTR-RISERVA): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).",
  ]);
});

test("la tabella MAC e le VM lasciano la loro frase sulla linea che creano", () => {
  const SRV = "02:00:00:00:06:01";
  const vm = (vmid: number, mac: string): ModelVmRow => ({
    scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node: "px-h", status: "running", type: "qemu", macs: [mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z",
  });
  const vms = [vm(501, "02:00:00:aa:00:01"), vm(502, "02:00:00:aa:00:02")];
  const m = buildTopologyModel(baseInput({
    devices: [
      dev(2, { name: "SW-2", controller_mac: "02:00:00:00:02:02" }),
      dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 }),
      dev(6, { name: "SRV-6", device_type: "server", host: "192.0.2.16", port_count: 0 }),
    ],
    knownMacs: [{ device_id: 6, mac: SRV }],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
    vms,
    macPorts: [
      ...vms.map((v) => ({ device_id: 2, mac: v.macs[0], port_name: "Port 1", timestamp: ORA, source: "device" })),
      { device_id: 2, mac: SRV, port_name: "Port 8", timestamp: ORA, source: "device" },
    ],
  }));
  const di = (id: string) => frasiPerche(m.links.find((l) => l.a === id || l.b === id)!, paroleDi(m));
  assert.deepEqual(di("dev:6"), ["Dedotto: il MAC di SRV-6 è visto sulla porta Port 8 di SW-2 (tabella MAC, letta alle 11:00)."]);
  assert.deepEqual(di("dev:5"), ["Dedotto: 2 VM accese di px-h sono viste sulla porta Port 1 di SW-2 (tabella MAC, letta alle 11:00)."]);
});

// Spec §13.4.6, «Nome scelto (riga scartata, da T1b)»; I58, H7. Rete B: la linea fra il router e il router di frontiera passava
// da una VLAN dal nome scelto. Da T1 la riga non prova un cavo; da T1b la frase lo dice.
test("I58 — la riga del router su un nome scelto è scartata col suo motivo, alla lettera della spec", () => {
  assert.deepEqual(frasi([{ tipo: "scartata", motivo: "nome_scelto", da: "dev:1", porta: "VL_16_QWE", altro: "dev:2" }]), [
    "RTR-1 sente SW-2 su VL_16_QWE, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.",
  ]);
});

// Verifica del 15/10: sull'hub il router sente il router di frontiera su dieci VLAN dai nomi scelti, e la linea aveva dieci
// frasi quasi uguali. I nomi scelti fra gli stessi due oggetti fanno una frase sola; un'altra coppia ha la sua.
test("I58 — più nomi scelti fra gli stessi due oggetti: una frase sola, con le prime due interfacce e quante altre", () => {
  const s = (porta: string, altro = "dev:2"): PassoPerche => ({ tipo: "scartata", motivo: "nome_scelto", da: "dev:1", porta, altro });
  assert.deepEqual(frasi([s("VL_16_QWE"), s("VL_20_ABC"), s("VL_7_XYZ"), s("VL_9_K"), s("VL_3_W", "dev:9")]), [
    "RTR-1 sente SW-2 su VL_16_QWE, VL_20_ABC e altre 2 interfacce, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.",
    "RTR-1 sente PVE-9 su VL_3_W, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.",
  ]);
  assert.deepEqual(frasi([s("VL_16_QWE"), s("VL_20_ABC")]), [
    "RTR-1 sente SW-2 su VL_16_QWE e VL_20_ABC, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.",
  ]);
  assert.equal(frasi([s("A_1"), s("B_2"), s("C_3")])[0].includes("e un'altra interfaccia,"), true);
});

test("I58 — rete-campione della famiglia 1: la linea fra la testa e il secondo router dice in una frase sola perché le due VLAN dai nomi scelti non contano", () => {
  const m = buildTopologyModel(soloMikrotik());
  const l = m.links.find((x) => x.id === "link:dev:1|dev:3")!;
  assert.deepEqual(frasiPerche(l, paroleDi(m)).filter((f) => f.includes("scelt")), [
    "RTR-TESTA sente RTR-FRONTIERA su VL_16_QWE e VL_20_ABC, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.",
  ]);
});
