// Il modello sulle fixture anonime di Domarc e di un cliente (estratte il 2026-10-13 dalle
// copie dei DB, Task 9): il modello nuovo non perde niente rispetto alla mappa
// vecchia, ed è stabile. I numeri fissati sotto sono quelli misurati alla prima
// estrazione: se cambiano, si legge il perché prima di riscriverli.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildTopologyGraph } from "@/lib/topology/graph";
import { autoVisible, buildTree, proposeHead } from "@/lib/topology/tree";
import { computeMapView } from "@/lib/topology/map-compute";
import { CHAR_W, fitLabel, layoutTree } from "@/lib/topology/tree-layout";
import { nodeClass } from "@/lib/topology/identity";
import { lineeCucite } from "@/lib/topology/misura";
import type { TopologyModelInput } from "@/lib/topology/model-types";

function carica(nome: string): TopologyModelInput {
  return { macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) } as TopologyModelInput;
}

function vecchiaMappa(i: TopologyModelInput) {
  const g = buildTopologyGraph({
    devices: i.devices.map((d) => ({ id: d.id, name: d.name, device_type: d.device_type, model: d.model, host: d.host, enabled: d.enabled })),
    hosts: i.hosts.map((h) => ({ id: h.id, ip: h.ip, hostname: h.hostname, custom_name: h.custom_name, classification: h.classification ?? "unknown", status: h.status, last_response_time_ms: null, last_seen: null, model: null, network_id: h.network_id })),
    neighbors: i.neighbors.map((n) => ({ device_id: n.device_id, local_port: n.local_port, remote_device_name: n.remote_device_name, remote_port: n.remote_port, protocol: n.protocol, remote_ip: n.remote_ip })),
    statusByNode: new Map(),
  });
  return {
    deviceLinks: g.edges.filter((e) => e.source.startsWith("dev:") && e.target.startsWith("dev:")).length,
    external: g.nodes.filter((n) => n.kind === "external").length,
  };
}

for (const nome of ["topologia-domarc.json", "topologia-cliente-a.json"]) {
  test(`${nome}: il modello nuovo non perde collegamenti fra apparati`, () => {
    const i = carica(nome);
    const m = buildTopologyModel(i);
    const v = vecchiaMappa(i);
    // Se fallisce, non si abbassa: un collegamento perso viene quasi sempre da una
    // chiave che il modello nuovo giudica contesa (MAC o nome) e la mappa vecchia
    // assegnava all'ultimo arrivato. Si legge quale, e lo si scrive.
    assert.ok(m.counts.deviceLinks >= v.deviceLinks, `nuovo ${m.counts.deviceLinks} < vecchio ${v.deviceLinks}`);
  });

  test(`${nome}: stessi dati, stesso modello`, () => {
    const i = carica(nome);
    assert.equal(JSON.stringify(buildTopologyModel(i)), JSON.stringify(buildTopologyModel(carica(nome))));
  });
}

test("Domarc: i doppi apparato/host si fondono (spec §2: almeno i 5 Proxmox)", () => {
  assert.ok(buildTopologyModel(carica("topologia-domarc.json")).counts.fusedHosts >= 5);
});

// Numeri misurati (Task 9, poi riestratti nel Task 13): si riscrivono solo sapendo perché cambiano.
// Task 6 (regola dell'identità, spec §10.4): gli host che sono interfacce dello stesso oggetto (nome annunciato,
// MAC vero, IP VRRP) ora sono un nodo solo. I collegamenti verso più host dello stesso oggetto si riducono a uno
// (attachedLinks), i vicini che prima non trovavano casa ora la trovano (unmatchedNeighbors), e meno host
// separati restano da promuovere (promoteProposals). deviceLinks e isolatedDevices non cambiano: nessun collegamento perso.
// domarc: attached 19->18, unmatched 12->9, promote 14->12.
// cliente-a: attached 59->36, unmatched 16->13, fusedHosts 78->87, promote 14->3.
// Riestratte il 2026-10-13 dalle copie con la lettura dei client: stessi numeri del modello sul dato vero.
// Cambiati rispetto a prima perché i dati sono nuovi e ci sono gli uplink UniFi (domarc: fusedHosts 58->59;
// cliente-a: deviceLinks 78->83, attached 36->62, unmatched 13, fused 87->93, promote 3->5, suspicious 7->2, isolated 10->5).
// Task 1 fase 2b (spec §11.1, 14/10): ciò che un router vede sul bridge non è un cavo, e un suo vicino conta solo se diretto:
// attached domarc 18->11, cliente-a 62->50 (links 38->31 e 145->133), promote 12->9 e 5->3. Gli apparati collegati agli switch non cambiano.
// Task 1b fase 2b (14/10): «ti vedo e mi vedi» via MNDP non conferma più un collegamento di un router (MNDP attraversa
// gli switch). Cliente A: cade il collegamento MNDP fra i router 2 e 3, confermato solo da MNDP (deviceLinks 83->82,
// links 133->132). Le porte della fixture sono anonime («porta-N»): le regole sul nome della porta qui non si vedono.
// Task 7 di T1 (spec §13.7.1), fixture riestratte il 15/10 dalle copie del 15/10 (ingresso del Task 5, senza le VM; fra
// parentesi il valore del codice di prima sulle stesse copie, poi l'effetto del Task 7):
// domarc: deviceLinks 20->29, isolatedDevices 22->17, suspiciousTypes 17->13 perché dati nuovi delle copie del 15/10;
// attachedLinks 11->33 (11->36, poi -3) e promoteProposals 9->10 (9->13, poi -3) perché porta di segmento: la porta 5
// dello switch 48 PoE sente tre switch di laboratorio (solo host), che restano senza linee e vanno in «Da sistemare» (H5);
// unmatchedNeighbors 9->7 perché righe raggruppate per apparato (due righe dello stesso telaio sulla stessa porta
// dell'aggregazione) e righe di RouterOS dello stesso apparato unite per nome (un vicino non abbinato in meno).
// cliente-a: deviceLinks 82->84, fusedHosts 93->92, promoteProposals 3->5 perché dati nuovi delle copie del 15/10;
// attachedLinks 50->49 (50->51, poi -2) perché porta di segmento (la porta 15 di core 1 sente router 1 e il router di
// riserva: cade la linea verso il router di riserva) e una riga da una VRRP che non si abbina più per IP (I15).
// Task 9 di T1: l'«Ignora» del 14/10 non toglie più la coppia (I36). cliente-a: deviceLinks 84->85, perché la correzione
// (porta 10 di core 1 ↔ ether8 di router 1) non corrisponde a nessun cavo visto e torna la linea core 1 ↔ router 1 sul
// cavo sfp-sfpplus1 a 10G; la correzione resta, orfana (C5). Gli altri conteggi non cambiano; domarc non ha correzioni.
const MISURATI: Record<string, Partial<Record<string, number>>> = {
  "topologia-domarc.json": { deviceLinks: 29, attachedLinks: 33, unmatchedNeighbors: 7, isolatedDevices: 17, fusedHosts: 59, promoteProposals: 10, suspiciousTypes: 13 },
  "topologia-cliente-a.json": { deviceLinks: 85, attachedLinks: 49, unmatchedNeighbors: 13, isolatedDevices: 5, fusedHosts: 92, promoteProposals: 5, suspiciousTypes: 2 },
};
for (const [nome, attesi] of Object.entries(MISURATI)) {
  test(`${nome}: conteggi misurati`, () => {
    const c = buildTopologyModel(carica(nome)).counts as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(attesi)) assert.equal(c[k], v, k);
  });
}

const sommaClient = (m: ReturnType<typeof buildTopologyModel>): number => Object.values(m.clientCount).reduce((a, b) => a + b, 0);
function alberoAuto(m: ReturnType<typeof buildTopologyModel>) {
  const visibili = autoVisible(m);
  const testa = proposeHead(m);
  return buildTree(m, visibili, testa ? [testa] : []);
}

for (const nome of ["topologia-domarc.json", "topologia-cliente-a.json"]) {
  test(`${nome}: fra l'infrastruttura nessun nome annunciato due volte`, () => {
    // Un nodo il cui nome è un indirizzo non ha un nome annunciato. Due APPARATI registrati a mano con lo stesso
    // nome e IP diversi (cliente A: una coppia, nel dato vero delle copie del 13/10) il modello non può fonderli:
    // si contano e basta. Un host che ripete il nome di un altro nodo, invece, è una fusione mancata.
    const visti = new Map<string, string>();
    let coppieDiApparati = 0;
    for (const n of buildTopologyModel(carica(nome)).nodes) {
      const k = n.name.trim().toLowerCase();
      if (n.hidden || nodeClass(n) !== "infra" || k === "" || /^[\d.]+$/.test(k)) continue;
      const prima = visti.get(k);
      if (prima !== undefined) {
        assert.ok(prima.startsWith("dev:") && n.id.startsWith("dev:"), `${n.id} ripete il nome di ${prima}`);
        coppieDiApparati++;
      }
      visti.set(k, n.id);
    }
    assert.equal(coppieDiApparati, nome === "topologia-cliente-a.json" ? 1 : 0);
  });

  for (const orientamento of ["lr", "tb"] as const) {
  test(`${nome} (${orientamento}): albero e disposizione sono stabili (stesse coordinate due volte)`, () => {
    const giro = () => {
      const m = buildTopologyModel(carica(nome));
      const r = layoutTree(m, alberoAuto(m), [], new Set(), orientamento);
      return JSON.stringify([...r.nodes.values()].map((n) => [n.id, n.x, n.y, n.w, n.h]));
    };
    assert.equal(giro(), giro());
  });

  test(`${nome} (${orientamento}): nessuna scritta esce dal nodo`, () => {
    const m = buildTopologyModel(carica(nome));
    const r = layoutTree(m, alberoAuto(m), [], new Set(), orientamento);
    const byId = new Map(m.nodes.map((n) => [n.id, n]));
    let boxes = 0;
    for (const n of r.nodes.values()) {
      if (n.role !== "box") continue;
      boxes++;
      const name = byId.get(n.id)!.name;
      assert.ok(fitLabel(name, n.w).length * CHAR_W + 44 <= n.w, n.id);
    }
    assert.ok(boxes > 0);
  });
}

  test(`${nome}: dimensioni della disposizione verticale (lr)`, () => {
    const m = buildTopologyModel(carica(nome));
    const r = layoutTree(m, alberoAuto(m), [], new Set(), "lr");
    // Numeri misurati con layoutTree(…, "lr") sulla fixture anonima, albero automatico (14/10/2026, Task 2 della
    // tappa H): se cambiano, si legge il perché (misure dei riquadri o regole della disposizione) prima di riscriverli.
    // Task 7 di T1 (spec §13.7.1), fixture riestratte il 15/10 dalle copie (fra parentesi il codice di prima sulle fixture
    // nuove): cliente-a 2512x3348->2514x3222 (2514x3222) perché dati nuovi delle copie del 15/10; domarc 1178x1914->1588x2420
    // (1588x2606) perché dati nuovi delle copie del 15/10, poi -186 in altezza perché porta di segmento (i tre switch di
    // laboratorio della porta 5 dello switch 48 PoE escono dall'albero e vanno in «Da sistemare», H5), niente ripiego del
    // router da un'interfaccia che il suo traduttore non riconosce (un hypervisor esce da sotto il router) e la velocità per
    // chiave, anche di un nome doppio (tre hypervisor passano sotto l'aggregazione a 10G, H9 e H13).
    const attesi = nome === "topologia-domarc.json" ? [1588, 2420] : [2514, 3222];
    assert.deepEqual([Math.round(r.width), Math.round(r.height)], attesi);
  });
}

test("cliente A: uplink salvati e collegamenti unifi_uplink presenti", () => {
  const i = carica("topologia-cliente-a.json");
  assert.ok(i.devices.filter((d) => d.uplink_mac !== null).length > 0, "nessun uplink salvato");
  assert.ok(buildTopologyModel(i).counts.linksBySource.unifi_uplink > 0);
});

// Conteggi misurati sulle copie dei DB del 13/10/2026 (dopo la lettura dei client UniFi), e uguali a quelli
// del modello sul dato vero: nodi, collegamenti, apparati isolati, client freschi. Se cambiano si legge il perché.
// Task 7 di T1 (spec §13.7.1), fixture riestratte il 15/10 dalle copie del 15/10: uguali al modello sul dato vero SENZA
// le VM, la forma della fixture (`ingressoDellaFixture`). Fra parentesi il codice di prima sulle stesse copie, poi il Task 7.
// domarc: nodes 83->226, isolatedDevices 22->17, clients 0->102 perché dati nuovi delle copie del 15/10; links 31->62
// (31->65, poi -3) perché porta di segmento: la porta 5 dello switch 48 PoE non dà le linee verso i tre switch di
// laboratorio (H5). cliente-a: isolatedDevices 5 (non cambia); links 132->134 (132->136, poi -2) perché porta di segmento
// (la porta 15 di core 1) e una riga da una VRRP che non si abbina più per IP (I15); clients 168->430 (168->427, poi +3)
// perché porta di segmento: la porta 15 di core 1 non ha più la linea, e i tre MAC che la tabella vede lì sono suoi
// client; nodes 358->551 (358->553, poi -2) perché la riga da una VRRP che non si abbina più per IP (I15) non crea più il
// nodo dell'host dell'IP virtuale, e perché la porta del router sul cavo fra due router porta il nome tradotto ed è
// occupata per la tabella MAC (spec §13.7.1, terza trappola): un host che la tabella vede solo su quella porta non è più
// un nodo (era fra gli isolati, «Da sistemare»).
// Task 9 di T1: l'«Ignora» del 14/10 non toglie più la coppia (I36). cliente-a: links 134->135, la linea core 1 ↔ router 1
// sul cavo a 10G; la correzione è orfana (C5). Nodi, isolati e client non cambiano.
// Task 9 di T1, §13.7.8 (G9): domarc clients 102->99 perché i MAC propri di un apparato non sono suoi client: il firewall
// virtuale (registrato come switch) vedeva sulle sue porte i tre MAC delle sue schede e li contava come suoi client. Le
// fixture non hanno VM: collegamenti, nodi, padri e teste non cambiano con la regola «vm-e-mac-propri» accesa o spenta.
const MISURATI_DATO_VERO: Record<string, { nodes: number; links: number; isolatedDevices: number; clients: number }> = {
  "topologia-domarc.json": { nodes: 226, links: 62, isolatedDevices: 17, clients: 99 },
  "topologia-cliente-a.json": { nodes: 551, links: 135, isolatedDevices: 5, clients: 430 },
};
for (const [nome, atteso] of Object.entries(MISURATI_DATO_VERO)) {
  test(`${nome}: conteggi principali uguali a quelli del dato vero senza le VM (copie del 15/10)`, () => {
    const m = buildTopologyModel(carica(nome));
    assert.deepEqual(
      { nodes: m.counts.nodes, links: m.counts.links, isolatedDevices: m.counts.isolatedDevices, clients: sommaClient(m) },
      atteso,
    );
  });
}

// T1 (spec §13.3.1, §13.3.3) sulle fixture riestratte dal Task 7: chiave della porta, segmenti e conferma per porta girano
// sulla forma vera. Id (interi del DB, non identificano nessuno): cliente A router 1 = dev:1, accesso A = dev:112,
// core 1 = dev:114; hub router = dev:1, aggregazione = dev:11, access point = dev:191.
const alberoDa = (m: ReturnType<typeof buildTopologyModel>, testa: string) =>
  computeMapView(m, { auto: true, members: [], roots: [], head: testa, tweaks: [], expanded: new Set(), orientation: "lr" }).tree;
const padreDi = (t: ReturnType<typeof alberoDa>, id: string): string | null => {
  for (const [p, figli] of t.children) if (figli.includes(id)) return p;
  return null;
};

test("cliente A senza correzioni (S1): core 1 figlio di router 1 sul cavo sfp-sfpplus1 a 10G; accesso A sotto core 1 (C1)", () => {
  const m = buildTopologyModel({ ...carica("topologia-cliente-a.json"), overrides: [] });
  const t = alberoDa(m, "dev:1");
  assert.equal(padreDi(t, "dev:114"), "dev:1");
  assert.equal(padreDi(t, "dev:112"), "dev:114");
  const l = t.via.get("dev:114")!;
  assert.deepEqual([l.a === "dev:1" ? l.aPort : l.bPort, l.speedMbps], ["sfp-sfpplus1", 10000]);
});

test("cliente A, S3 (senza l'uplink di core 1): core 1 resta sotto router 1, 10G contro 2,5G (C3)", () => {
  const i = carica("topologia-cliente-a.json");
  const s3 = { ...i, overrides: [], devices: i.devices.map((d) => (d.id === 114 ? { ...d, uplink_mac: null, uplink_remote_port: null } : d)), uplinkPorts: i.uplinkPorts.filter((p) => p.device_id !== 114) };
  assert.equal(padreDi(alberoDa(buildTopologyModel(s3), "dev:1"), "dev:114"), "dev:1");
});

test("hub: router–aggregazione sulle porte di un cavo solo, porta 31 ↔ sfp28-2 (H2)", () => {
  const l = buildTopologyModel(carica("topologia-domarc.json")).links.find((x) => x.id === "link:dev:1|dev:11")!;
  const [agg, rtrPorta] = l.a === "dev:11" ? [l.aPort, l.bPort] : [l.bPort, l.aPort];
  assert.equal(rtrPorta, "sfp28-2");
  assert.match(agg, /^SFP28 31( - |$)/);
});

test("hub: il client dell'access point sulla sua interfaccia senza fili resta collegato, «≋ Wi-Fi» (H10)", () => {
  const l = buildTopologyModel(carica("topologia-domarc.json")).links.find((x) => (x.a === "dev:191" && x.aPort === "wifi2ap9") || (x.b === "dev:191" && x.bPort === "wifi2ap9"));
  assert.ok(l);
  assert.equal(l.medium, "wireless");
});

// I36 (D3): la correzione del 14/10 (porta 10 di core 1 ↔ ether8 di router 1) non si converte da sola: resta, orfana, e
// non nasconde più il cavo a 10G. Riccardo la toglie a mano dopo il rilascio («Togli la correzione»).
test("cliente A col dato vero (S0): la correzione del 14/10 è orfana e core 1 sta sotto router 1 (C1, C5)", () => {
  const m = buildTopologyModel(carica("topologia-cliente-a.json"));
  const ignora = carica("topologia-cliente-a.json").overrides.filter((o) => o.action === "ignore").map((o) => o.id);
  assert.deepEqual(m.correzioniOrfane, ignora);
  assert.equal(padreDi(alberoDa(m, "dev:1"), "dev:114"), "dev:1");
});

test("cliente A e hub: nessuna linea cucita (C4)", () => {
  for (const nome of ["topologia-cliente-a.json", "topologia-domarc.json"]) {
    const i = carica(nome);
    assert.deepEqual(lineeCucite(i, buildTopologyModel(i)).map((l) => l.id), [], nome);
  }
});
