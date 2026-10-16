/**
 * Reti-campione (spec topologia §13.12.2) e criteri generali G1-G17 (§13.3.0): una prova per criterio e per famiglia. Vincolo 9
 * di Riccardo (14/10 sera): «il piano deve essere universale» — le regole valgono per ogni rete e ogni marca. Le cinque famiglie
 * sono reti inventate; il cliente A e la rete dell'hub sono le due misure su reti vere, e le loro prove stanno con le altre misure
 * in `model-fixtures.test.ts` (C e H, non G). Una prova saltata dice perché il criterio non si applica in T1 (e in quale tappa
 * arriva); una prova «da fare» (todo) è un caso che le regole di oggi sbagliano, portato a Riccardo. Il resoconto di T1 riporta
 * le righe «G… · famiglie …» così come le stampa `node --test` (Task 12). Dove una regola del passaggio universale (§13.16)
 * decide il criterio, la prova la spegne e guarda l'errore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeClass } from "@/lib/topology/identity";
import { traduciPorta } from "@/lib/topology/lettori/traduci";
import { comeDi } from "@/lib/topology/links";
import { computeMapView } from "@/lib/topology/map-compute";
import { lineeCucite, padriDi } from "@/lib/topology/misura";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { REGOLE_T1, type RegolaUniversale } from "@/lib/topology/regole";
import { altreMarcheSnmp, conHypervisor, mista, soloMikrotik, soloUnifi } from "./support/reti-campione";

const modello = (i: TopologyModelInput, senza?: RegolaUniversale): TopologyModel =>
  buildTopologyModel(i, new Set([...REGOLE_T1].filter((r) => r !== senza)));
function albero(m: TopologyModel): { testa: string | null; padri: Record<string, string | null> } {
  const c = computeMapView(m, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  return { testa: c.head, padri: padriDi(c.tree) };
}
/** Le linee coi due capi, le fonti, il genere (se c'è) e gli altri cavi visti. */
const linee = (m: TopologyModel): string[] =>
  m.links.map((l) => `${l.a} ${l.aPort || "?"} ↔ ${l.b} ${l.bPort || "?"} · ${l.sources.join("+")}${l.medium ? ` · ${l.medium}` : ""}${l.altriCavi ? ` · altri ${l.altriCavi.map((c) => `${c.aPort}↔${c.bPort}`).join(",")}` : ""}`).sort();
const FAMIGLIE: Array<[string, () => TopologyModelInput]> = [["1", soloMikrotik], ["2", soloUnifi], ["3", altreMarcheSnmp], ["4", conHypervisor], ["5", mista]];

// ─── Le tabelle attese di T1, famiglia per famiglia: collegamenti coi due capi, «Da sistemare», testa, padri ───

test("famiglia 1 · solo MikroTik: la tabella attesa di T1", () => {
  const m = modello(soloMikrotik());
  assert.deepEqual(linee(m), [
    "dev:1 sfp-sfpplus1 ↔ dev:11 sfp-sfpplus10 · lldp",
    "dev:11 sfp-sfpplus2 ↔ dev:21 sfp-sfpplus1 · lldp",
    "dev:11 sfp-sfpplus5 ↔ dev:41 enp1s0f0 · lldp",
    "dev:3 bond2 ↔ host:61 ? · mac_table",
    "dev:3 sfp-sfpplus1 ↔ dev:1 sfp-sfpplus2 · lldp · altri sfp-sfpplus3↔sfp-sfpplus4",
    "dev:3 sfp-sfpplus5 ↔ host:71 eth0 · lldp",
    "dev:3 sfp-sfpplus6 ↔ host:72 eth0 · lldp",
    "dev:3 sfp28-1 ↔ dev:11 sfp28-1 · lldp · altri sfp28-2↔sfp28-2",
    "dev:51 ether1 ↔ dev:3 ? · mndp",
  ]);
  assert.deepEqual([m.segmenti, m.isolated], [{}, []]);
  assert.deepEqual(albero(m), {
    testa: "dev:3",
    padri: { "dev:1": "dev:11", "dev:11": "dev:3", "dev:21": "dev:11", "dev:3": null, "dev:41": "dev:11", "dev:51": "dev:3", "host:61": "dev:3", "host:71": "dev:3", "host:72": "dev:3" },
  });
});

test("famiglia 2 · solo UniFi: la tabella attesa di T1 (WAN e LAN del gateway verso lo stesso switch: la linea tiene un cavo, l'altro fra gli altri cavi visti; la WAN come uplink è «contro verso» fino a T3, G13)", () => {
  const m = modello(soloUnifi());
  assert.deepEqual(linee(m), [
    "dev:1 SFP+ 1 ↔ dev:2 SFP28 25 · unifi_uplink+lldp · altri eth10↔SFP+ 2",
    "dev:2 SFP+ 5 ↔ host:8 eno1 · lldp",
    "dev:2 SFP+ 9 - srv-b ↔ host:7 enp1s0 · lldp",
    "dev:3 SFP+ 1 ↔ dev:2 SFP+ 1 · unifi_uplink+lldp",
    "dev:4 Port 1 ↔ dev:3 Port 7 · unifi_uplink+lldp",
    "dev:5 Port 1 ↔ dev:3 Port 8 · unifi_uplink+lldp",
    "dev:6 ? ↔ dev:5 ? · unifi_uplink · wireless",
  ]);
  assert.deepEqual([m.segmenti, m.isolated], [{ "dev:3|port20": ["host:31", "host:32"] }, ["host:31", "host:32"]]);
  assert.deepEqual(albero(m), {
    testa: "dev:1",
    padri: { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:4": "dev:3", "dev:5": "dev:3", "dev:6": "dev:5", "host:7": "dev:2", "host:8": "dev:2" },
  });
});

test("famiglia 3 · altre marche via SNMP: la tabella attesa di T1", () => {
  const m = modello(altreMarcheSnmp());
  assert.deepEqual(linee(m), ["dev:1 Gi0/0/1 ↔ dev:2 Gi1/0/24 · lldp", "dev:2 Te1/1/1 ↔ dev:3 Te1/1/1 · cdp", "dev:3 Gi1/0/2 ↔ dev:4 1/1/24 · lldp"]);
  assert.deepEqual(albero(m), { testa: "dev:1", padri: { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:4": "dev:3" } });
});

test("famiglia 4 · con hypervisor: la tabella attesa di T1 (i dati a 10G sul core, la gestione a 1G come ridondanza; le VM dentro i loro hypervisor)", () => {
  const m = modello(conHypervisor());
  assert.deepEqual(linee(m), [
    "dev:2 SFP+ 1 ↔ dev:1 sfp-sfpplus1 · unifi_uplink+lldp",
    "dev:2 SFP+ 3 - pve-1 ↔ dev:41 02:00:f4:00:41:a1 · lldp+vm_mac",
    "dev:2 SFP+ 7 ↔ dev:42 ? · mac_table+vm_mac",
    "dev:3 Port 1 ↔ dev:41 ? · mac_table",
    "dev:3 Port 2 ↔ dev:42 02:00:f4:00:42:b2 · lldp",
    "dev:3 Port 3 ↔ host:49 ? · mac_table",
    "dev:3 SFP+ 1 ↔ dev:2 SFP+ 2 · unifi_uplink+lldp",
    "dev:51 ether1 ↔ dev:1 ? · mndp",
  ]);
  assert.deepEqual([m.segmenti, m.isolated], [{}, []]);
  assert.deepEqual(m.vms.map((v) => [v.id, v.nodeId, v.hypervisorNodeId]), [
    ["vm:41:101", "dev:51", "dev:41"], ["vm:41:102", "dev:52", "dev:41"], ["vm:41:103", null, "dev:41"], ["vm:42:201", null, "dev:42"], ["vm:42:202", null, "dev:42"],
  ]);
  assert.deepEqual(albero(m), { testa: "dev:1", padri: { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:41": "dev:2", "dev:42": "dev:2", "dev:51": "dev:1", "host:49": "dev:3" } });
});

test("famiglia 5 · mista: la tabella attesa di T1 (il segmento della WAN e il ponte radio non danno cavi: chi resta senza collegamenti è «Da sistemare», il salto radio arriva in T3)", () => {
  const m = modello(mista());
  assert.deepEqual(linee(m), [
    "dev:2 ether2 ↔ dev:3 Port 2 · lldp",
    "dev:3 Port 1 ↔ dev:1 ether2 · unifi_uplink+lldp",
    "dev:3 Port 24 ↔ dev:4 Gi1/0/48 · lldp",
    "dev:4 Gi1/0/5 ↔ host:81 Port 1 · cdp",
  ]);
  assert.deepEqual(m.segmenti, { "dev:1|ether1": ["dev:2", "host:61"], "dev:1|ether5": ["dev:5", "host:71"], "dev:2|ether1": ["dev:1", "host:61"], "dev:5|ether1": ["dev:1", "host:72"] });
  assert.deepEqual(m.isolated, ["dev:5", "host:61", "host:71", "host:72"]);
  assert.deepEqual(m.portClients.map((p) => [p.nodeId, p.port, p.clients.map((c) => c.nodeId)]), [["dev:4", "Gi1/0/10", ["host:91"]]]);
  assert.deepEqual(albero(m), { testa: "dev:1", padri: { "dev:1": null, "dev:2": "dev:3", "dev:3": "dev:1", "dev:4": "dev:3", "host:81": "dev:4" } });
});

// ─── G1-G10, G14 (la parte di T1) e G17, famiglia per famiglia ───

test("G1 · famiglie 1, 2, 3, 4, 5 · le due porte di una linea vengono da una prova sola: nessuna linea cucita", () => {
  for (const [f, crea] of FAMIGLIE) { const i = crea(); assert.deepEqual(lineeCucite(i, modello(i)).map((l) => l.id), [], `famiglia ${f}`); }
});

test("G2 · famiglie 1, 3, 5 · nessun cavo da un'interfaccia logica né da un nome scelto (per chi ha il traduttore del suo prodotto)", () => {
  const porteDi = (m: TopologyModel) => m.links.flatMap((l) => [l.aPort, l.bPort, ...(l.altriCavi ?? []).flatMap((c) => [c.aPort, c.bPort])]);
  // famiglia 1: la linea fra i due router e quella del router virtuale non passano da una VLAN dal nome scelto (H7, I58)
  assert.deepEqual(porteDi(modello(soloMikrotik())).filter((p) => /^(VL_|BR_|eoip|wg)/.test(p)), []);
  assert.equal(porteDi(modello(soloMikrotik(), "nome-scelto-non-fisico")).some((p) => p.startsWith("VL_")), true, "regola spenta: la VLAN torna");
  // famiglia 3: col traduttore generico «Vlan100» è logica e non dà cavi; «Gi0/0/1» del router di un'altra marca sì (come prima)
  assert.equal(porteDi(modello(altreMarcheSnmp())).includes("Vlan100"), false);
  assert.deepEqual(linee(modello(altreMarcheSnmp(), "nome-scelto-non-fisico")), linee(modello(altreMarcheSnmp())), "il generico non dipende dalla regola");
  // famiglia 5: coi nomi di fabbrica la regola non toglie niente
  assert.deepEqual(linee(modello(mista(), "nome-scelto-non-fisico")), linee(modello(mista())));
});

test("G3 · famiglie 1, 5 · «nel bridge» dalla forma della riga, con qualunque nome del bridge (il fatto in T1; l'effetto «instradato» in T3)", () => {
  const nelBridge = (i: TopologyModelInput, device_id: number, porta: string) => traduciPorta(porta, "locale", comeDi(i)(`dev:${device_id}`, "device", null)).nelBridge;
  const f1 = soloMikrotik();
  assert.deepEqual(f1.neighbors.filter((n) => n.device_id === 3 && n.local_port.includes(",")).map((n) => nelBridge(f1, 3, n.local_port)), Array(9).fill(true), "le 9 righe della testa con un contenitore, l'EoIP compreso");
  assert.deepEqual([nelBridge(f1, 1, "sfp-sfpplus2"), nelBridge(f1, 1, "sfp-sfpplus4"), nelBridge(f1, 1, "sfp-sfpplus1,BR_FX"), nelBridge(f1, 21, "sfp-sfpplus1,bridge")], [false, false, true, true]);
  const f5 = mista();
  assert.deepEqual([nelBridge(f5, 1, "ether2,bridge"), nelBridge(f5, 1, "ether5,bridge"), nelBridge(f5, 1, "ether1")], [true, true, false]);
});

test("G4 · famiglie 1, 2, 5 · gli apparati di una porta si contano per apparato: due o più fanno un segmento, uno è il cavo", () => {
  // famiglia 1: il secondo router sente la testa con due MAC sulla stessa porta (I60); sul fascio, il CDP inoltrato non conta
  assert.deepEqual(modello(soloMikrotik()).segmenti, {});
  assert.deepEqual(modello(soloMikrotik(), "conto-per-apparato").segmenti, { "dev:1|sfp-sfpplus4": [] }, "regola spenta: il segmento falso");
  // famiglia 2: due switch di laboratorio dietro uno switch muto sulla stessa porta
  assert.deepEqual(Object.keys(modello(soloUnifi()).segmenti ?? {}), ["dev:3|port20"]);
  // famiglia 5: il modem e i due router sulla WAN; la radio vicina e il router della sede oltre il ponte
  assert.deepEqual(Object.keys(modello(mista()).segmenti ?? {}).sort(), ["dev:1|ether1", "dev:1|ether5", "dev:2|ether1", "dev:5|ether1"]);
});

test("G5 · famiglia 1 · una VLAN su più porte d'accesso non è un segmento: un cavo per porta", () => {
  const m = modello(soloMikrotik());
  assert.deepEqual(m.links.filter((l) => l.b === "host:71" || l.b === "host:72").map((l) => [l.aPort, l.bPort]), [["sfp-sfpplus5", "eth0"], ["sfp-sfpplus6", "eth0"]]);
});

test("G6 · famiglie 1, 5 · gli annunci che attraversano gli apparati non fanno cavi; fra router solo come unico vicino, e la fonte lo dice («probabile» da T3)", () => {
  const m = modello(soloMikrotik());
  // SW-A si annuncia via CDP inoltrato sui membri del fascio della testa: nessun cavo fra la testa e SW-A
  assert.equal(m.links.some((l) => [l.a, l.b].sort().join("|") === "dev:21|dev:3"), false);
  // il router virtuale sente la testa via MNDP, unico vicino sulla sua ether1: un collegamento dall'annuncio, senza porta remota
  assert.deepEqual(m.links.filter((l) => l.a === "dev:51").map((l) => [l.aPort, l.bPort, l.source]), [["ether1", "", "mndp"]]);
  // famiglia 5: l'annuncio del router attraversa lo switch del controller fino al router di riserva: nessun cavo fra i due router
  assert.equal(modello(mista()).links.some((l) => [l.a, l.b].sort().join("|") === "dev:1|dev:2"), false);
});

test("G6 · famiglia 3 · CDP inoltrato da uno switch che non è Cisco", { skip: "T3: l'elenco chiuso di chi consuma il CDP sta nel lettore SNMP (§13.5.4); in T1 il lettore SNMP non cambia" }, () => {});

test("G7 · famiglie 2, 4 · la stessa porta scritta in modi diversi è una porta sola; un nome doppio non si risolve per nome; la velocità per chiave", () => {
  const m = modello(soloUnifi());
  const verso = (mm: TopologyModel, h: string) => mm.links.find((l) => l.b === h)!;
  assert.deepEqual([verso(m, "host:7").aPort, verso(m, "host:7").speedMbps], ["SFP+ 9 - srv-b", 10000], "«SFP_ 9 - etichetta» del controller è «SFP+ 9 - etichetta»");
  assert.deepEqual([verso(m, "host:8").aPort, verso(m, "host:8").speedMbps], ["SFP+ 5", 10000], "nome doppio: porta non nota, velocità sì (I70)");
  assert.equal(verso(modello(soloUnifi(), "velocita-nomi-doppi"), "host:8").speedMbps, null, "regola spenta");
  // famiglia 4: l'etichetta del core e il bond sulle due «SFP+ 7»; spenta la regola, pve-2 finisce sotto la sua gestione a 1G (H13)
  const h = modello(conHypervisor());
  assert.deepEqual(h.links.filter((l) => l.b === "dev:41" || l.b === "dev:42").map((l) => [l.a, l.aPort, l.b, l.speedMbps]).sort(), [
    ["dev:2", "SFP+ 3 - pve-1", "dev:41", 10000], ["dev:2", "SFP+ 7", "dev:42", 10000], ["dev:3", "Port 1", "dev:41", 1000], ["dev:3", "Port 2", "dev:42", 1000],
  ]);
  assert.equal(albero(modello(conHypervisor(), "velocita-nomi-doppi")).padri["dev:42"], "dev:3", "regola spenta: sotto la porta di gestione");
});

test("G8 · famiglie 1, 2, 3, 4, 5 · nessuna testa né padre per ordine di id prima delle prove", () => {
  assert.equal(albero(modello(soloMikrotik())).testa, "dev:3", "la testa è il gateway di più reti, non l'id più basso (I63)");
  assert.equal(albero(modello(soloMikrotik(), "testa-per-reti")).testa, "dev:1", "regola spenta: vince l'id");
  for (const [f, crea] of FAMIGLIE.slice(1)) assert.equal(albero(modello(crea())).testa, "dev:1", `famiglia ${f}`);
});

test("G9 · famiglia 4 · un apparato non è vicino né client di sé stesso; una VM non fa da padre al suo hypervisor", () => {
  // la VM firewall (registrata come switch) legge la sua tabella MAC: ci sono le sue schede e pve-1. Nessun collegamento fra i due.
  const tra = (m: TopologyModel, a: string, b: string) => m.links.some((l) => [l.a, l.b].sort().join("|") === [a, b].sort().join("|"));
  const m = modello(conHypervisor());
  assert.equal(tra(m, "dev:41", "dev:52"), false);
  assert.equal(Object.values(albero(m).padri).includes("dev:52"), false);
  const senza = modello(conHypervisor(), "vm-e-mac-propri");
  assert.equal(tra(senza, "dev:41", "dev:52"), true, "regola spenta: il collegamento falso");
  assert.equal(albero(senza).padri["dev:52"], null, "regola spenta: la VM diventa una radice sola");
});

test("G10 · famiglie 2, 5 · chi resta senza collegamenti su un segmento è «Da sistemare», non una radice sola (la parte di T1)", () => {
  const m = modello(soloUnifi());
  assert.deepEqual(m.isolated, ["host:31", "host:32"]);
  assert.equal(Object.values(albero(m).padri).filter((p) => p === null).length, 1, "una radice sola: il gateway");
  const x = modello(mista());
  for (const id of ["host:61", "host:71", "host:72"]) assert.equal(x.isolated.includes(id), true, id);
  assert.equal(Object.values(albero(x).padri).filter((p) => p === null).length, 1, "una radice sola: il router");
});

test("G14 · famiglia 2 · la parte di T1: un uplink senza fili (AP in mesh) è senza fili", () => {
  assert.deepEqual(modello(soloUnifi()).links.filter((l) => l.a === "dev:6").map((l) => [l.b, l.medium]), [["dev:5", "wireless"]]);
});

test("G17 · famiglie 1, 2, 4 · nessuna regola conosce un nome scelto: nomi inventati a caso danno gli stessi fatti", () => {
  // I nomi scelti (bridge, VLAN, tunnel della famiglia 1; le etichette delle porte delle famiglie 2 e 4) rinominati a caso,
  // tenendo la forma della riga: stesse linee, stessi padri.
  const SCELTI = ["BR_RP", "BR_AGG", "BR_FX", "VL_16_QWE", "VL_20_ABC", "VL_88_WAN", "VL_10_LAN", "srv-b", "pve-1"];
  const A_CASO = ["kq7-Zeta", "Xu_ponte", "mappa9", "Rete Nord", "Tr_00x", "uplink-2", "NODO-z", "armadio 3", "Qz_lab"];
  const pezzi = (s: string, da: string[], a: string[]) => s.split(/([,/]| - )/).map((p) => (da.includes(p) ? a[da.indexOf(p)] : p)).join("");
  const indietro = (s: string) => A_CASO.reduce((x, n, k) => x.split(n).join(SCELTI[k]), s);
  const rinomina = (i: TopologyModelInput): TopologyModelInput => ({
    ...i,
    neighbors: i.neighbors.map((n) => ({ ...n, local_port: pezzi(n.local_port, SCELTI, A_CASO), remote_port: pezzi(n.remote_port, SCELTI, A_CASO) })),
    ports: (i.ports ?? []).map((p) => ({ ...p, port_name: pezzi(p.port_name, SCELTI, A_CASO) })),
    macPorts: i.macPorts.map((r) => ({ ...r, port_name: pezzi(r.port_name, SCELTI, A_CASO) })),
  });
  for (const [f, crea] of [FAMIGLIE[0], FAMIGLIE[1], FAMIGLIE[3]]) {
    const i = crea(), j = rinomina(i);
    assert.notDeepEqual(j.neighbors, i.neighbors, `famiglia ${f}: la prova rinomina davvero`);
    assert.deepEqual(linee(modello(j)).map(indietro), linee(modello(i)), `famiglia ${f}`);
    assert.deepEqual(albero(modello(j)), albero(modello(i)), `famiglia ${f}`);
  }
});

// ─── T1b (spec §13.8.2): la parte di G10 che resta, e «hypervisor» solo con una prova ───
const radici = (m: TopologyModel): string[] => Object.entries(albero(m).padri).filter(([, p]) => p === null).map(([id]) => id).sort();

test("G10 · famiglie 1, 2, 3, 4, 5 · T1b: nessuna radice sola, nessun ruolo di rete senza una prova", () => {
  // famiglia 2: gli switch di laboratorio, che solo l'LLDP del controller vede, non hanno prove di ruolo
  assert.deepEqual(modello(soloUnifi()).daSistemare?.map((d) => d.id), ["host:31", "host:32"]);
  // famiglia 5: il modem e le due radio, che la classificazione dice router e access point, senza una prova loro
  assert.deepEqual(modello(mista()).daSistemare?.map((d) => d.id), ["host:61", "host:71", "host:72"]);
  for (const [f, crea] of FAMIGLIE) assert.equal(radici(modello(crea())).length, 1, `famiglia ${f}`);
});

test("G10 · famiglia 4 · T1b: «hypervisor» solo con una prova: i due nodi Proxmox restano hypervisor, l'host senza VM né scansione è un attaccato", () => {
  const m = modello(conHypervisor());
  const nodi = new Map(m.nodes.map((n) => [n.id, n]));
  assert.deepEqual([nodeClass(nodi.get("dev:41")!), nodeClass(nodi.get("dev:42")!), nodeClass(nodi.get("host:49")!)], ["hyper", "hyper", "hyper"]);
  assert.deepEqual(m.classiMappa ?? {}, { "host:49": "att" });
  assert.equal(m.vms.some((v) => v.hypervisorNodeId === "host:49"), false);
});

// Spec §13.8.2 e §13.16, scelta 8: la prova «si annuncia come apparato (MNDP o CDP)» è confermata da Riccardo il 14/10. Un
// telefono IP che la classificazione automatica dice router si annuncia via CDP, la passa e resta nell'albero come apparato di
// rete. La riga dice che cosa vorrebbe la rete; se Riccardo sceglie una guardia, la prova smette di essere «da fare».
test("G10 · famiglia 5 · T1b: un telefono che si annuncia via CDP non è un apparato di rete", { todo: "fatto da confermare a Riccardo (spec §13.16, scelta 8)" }, () => {
  assert.equal(modello(mista()).daSistemare?.some((d) => d.id === "host:81"), true);
});

// ─── Criteri che arrivano con T3 (§13.3.0) ───
// G11-G16: in cavi-reti-campione.test.ts (G11-G15, una prova per criterio e per famiglia, col modello per cavo) e in
// cavi-quattro-letture.test.ts (G16, la stessa rete in quattro letture). Erano saltati qui finché T3 non c'era.
