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
import { CHAR_W, fitLabel, layoutTree } from "@/lib/topology/tree-layout";
import { nodeClass } from "@/lib/topology/identity";
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
const MISURATI: Record<string, Partial<Record<string, number>>> = {
  "topologia-domarc.json": { deviceLinks: 20, attachedLinks: 11, unmatchedNeighbors: 9, isolatedDevices: 22, fusedHosts: 59, promoteProposals: 9, suspiciousTypes: 17 },
  "topologia-cliente-a.json": { deviceLinks: 82, attachedLinks: 50, unmatchedNeighbors: 13, isolatedDevices: 5, fusedHosts: 93, promoteProposals: 3, suspiciousTypes: 2 },
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
    const attesi = nome === "topologia-domarc.json" ? [1178, 1914] : [2512, 3348];
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
const MISURATI_DATO_VERO: Record<string, { nodes: number; links: number; isolatedDevices: number; clients: number }> = {
  "topologia-domarc.json": { nodes: 83, links: 31, isolatedDevices: 22, clients: 0 },
  "topologia-cliente-a.json": { nodes: 358, links: 132, isolatedDevices: 5, clients: 168 }, // 133->132: Task 1b, vedi MISURATI
};
for (const [nome, atteso] of Object.entries(MISURATI_DATO_VERO)) {
  test(`${nome}: conteggi principali uguali a quelli del dato vero (copie del 13/10)`, () => {
    const m = buildTopologyModel(carica(nome));
    assert.deepEqual(
      { nodes: m.counts.nodes, links: m.counts.links, isolatedDevices: m.counts.isolatedDevices, clients: sommaClient(m) },
      atteso,
    );
  });
}
