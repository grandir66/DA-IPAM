// La traccia (spec topologia §13.11.3): il confronto fra l'albero della mappa di oggi e quello del modello per cavo, oggetto
// per oggetto, con il perché in parole; un limite di righe e «+ altri N»; le VM e i segmenti non sono «oggetti che entrano».
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { calcolaTraccia, confrontaAlberi, nomiTraccia } from "@/lib/topology/cavi/traccia";
import { baseInput, dev, host } from "./support/righe";
import type { Porta } from "@/lib/topology/cavi/porte";
import { fb, fp, ingresso, ORA_T2, vic } from "./support/cavi";
import { candidatiPerPorta, modelloMappaCavi, nomiDellaMappa } from "@/lib/topology/cavi/mappa";
import { porte, riga } from "./support/reti-campione";

test("confrontaAlberi: padre diverso, entra, esce; VM e segmenti non contano come oggetti", () => {
  const d = confrontaAlberi(
    { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:1", "host:9": "dev:2", "vm:4:100": "dev:3" },
    { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:5": "seg:1:8", "seg:1:8": "dev:1" },
  );
  assert.deepEqual(d, [
    { id: "dev:3", prima: "dev:1", dopo: "dev:2" },
    { id: "dev:5", prima: undefined, dopo: "seg:1:8" },
    { id: "host:9", prima: "dev:2", dopo: undefined },
  ]);
});

const mk = { vendor: "mikrotik", via: "ssh" } as const;
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string) => [
  vic({ device_id: a, local_port: `${pa},bridge`, remote_device_name: nomeB, remote_port: `bridge/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},bridge`, remote_device_name: nomeA, remote_port: `bridge/${pa}`, source: "device", remote_platform: "MikroTik" }),
];

test("letture accese su una rete piccola: la porta radice cambia un padre, e la riga dice perché", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")],
    networks: [{ id: 1, cidr: "10.1.0.0/24", name: "lan", gateway: "10.1.0.1", location_id: null }],
  });
  const ing = ingresso(t1, { fattiBridge: [fb(3, { bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: "ether2" })] });
  const modello = buildTopologyModel(t1);
  const vista = computeMapView(modello, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation: "lr" });
  const tr = calcolaTraccia(padriDi(vista.tree), costruisciModelloCavi(ing, modello, { testaScelta: "dev:1" }));
  assert.equal(tr.padriDiversi, 1);
  assert.deepEqual(tr.righe.map((r) => [r.id, r.prima, r.dopo]), [["dev:3", "dev:1", "dev:2"]]);
  assert.match(tr.righe[0].perche, /porta radice/);
  assert.equal(tr.perGenere.cavo, 3);
  const nomi = nomiTraccia(modello, costruisciModelloCavi(ing, modello, { testaScelta: "dev:1" }), tr);
  assert.deepEqual([nomi["dev:3"], nomi["dev:2"]], ["SW-3", "SW-2"]);
});

test("il limite: al più `limite` righe, le altre contate in «+ altri N»", () => {
  const oggi: Record<string, string | null> = { "dev:1": null };
  const nuovo: Record<string, string | null> = { "dev:1": null };
  for (let i = 2; i < 80; i++) { oggi[`dev:${i}`] = "dev:1"; nuovo[`dev:${i}`] = `dev:${i - 1}`; }
  const m = costruisciModelloCavi(ingresso(baseInput()), buildTopologyModel(baseInput()), { testaScelta: null });
  const tr = calcolaTraccia(oggi, { ...m, albero: { ...m.albero, padri: nuovo } }, 50);
  assert.deepEqual([tr.righe.length, tr.altri, tr.padriDiversi], [50, 27, 77]);
});

// ── Casi in più rispetto al piano (Task 12): le parole del «perché», chi entra o esce, lo schema assente ────────────────────

const rete3 = () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")],
    networks: [{ id: 1, cidr: "10.1.0.0/24", name: "lan", gateway: "10.1.0.1", location_id: null }],
  });
  const modello = buildTopologyModel(t1);
  const oggi = padriDi(computeMapView(modello, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation: "lr" }).tree);
  return { t1, modello, oggi };
};

test("letture spente: nessun fatto nuovo, nessuna differenza, e la traccia lo dice in numeri", () => {
  const { t1, modello, oggi } = rete3();
  const tr = calcolaTraccia(oggi, costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" }));
  assert.deepEqual([tr.padriDiversi, tr.entrano, tr.escono, tr.righe, tr.altri], [0, [], [], [], 0]);
  assert.deepEqual([tr.perGenere.cavo, tr.nuovi.bloccati, tr.segmenti, tr.anomalie, tr.schema], [3, 0, 0, 0, true]);
});

test("il perché dice anche che il cavo di oggi è bloccato dallo spanning tree, e il numero dei bloccati lo conta", () => {
  const { t1, modello, oggi } = rete3();
  const ing = ingresso(t1, {
    fattiBridge: [fb(3, { bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: "ether2" })],
    fattiPorta: [
      fp(3, "n:ether3", "ether3", { source: "device", stp_role: "alternate", stp_state: "discarding", in_bridge: 1 }),
      fp(3, "n:ether2", "ether2", { source: "device", stp_role: "root", stp_state: "forwarding", in_bridge: 1 }),
    ],
  });
  const tr = calcolaTraccia(oggi, costruisciModelloCavi(ing, modello, { testaScelta: "dev:1" }));
  assert.equal(tr.nuovi.bloccati, 1);
  assert.match(tr.righe[0].perche, /porta radice nello spanning tree; il collegamento di oggi è bloccato dallo spanning tree/);
});

test("chi entra e chi esce dall'albero: elencati, e non contati fra i padri diversi", () => {
  const { t1, modello } = rete3();
  const m = costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" });
  const oggi: Record<string, string | null> = { "dev:1": null, "dev:2": "dev:1", "host:9": "dev:2", "vm:4:100": "dev:2" };
  const nuovo: Record<string, string | null> = { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2" };
  const tr = calcolaTraccia(oggi, { ...m, albero: { ...m.albero, padri: nuovo } });
  assert.deepEqual([tr.padriDiversi, tr.entrano, tr.escono], [0, ["dev:3"], ["host:9"]]);
  assert.deepEqual(tr.righe.map((r) => [r.id, r.prima, r.dopo]), [["dev:3", undefined, "dev:2"], ["host:9", "dev:2", undefined]]);
  assert.match(tr.righe[1].perche, /non ha un collegamento verso l'albero/);
  // Nel JSON della rotta «fuori dall'albero» è una chiave che manca: la pagina la legge come `undefined`, non come una partenza (`null`).
  const json = JSON.parse(JSON.stringify(tr.righe)) as Array<Record<string, unknown>>;
  assert.deepEqual([json[0].prima, json[0].dopo, "dopo" in json[1]], [undefined, "dev:2", false]);
});

test("una partenza dell'albero e un segmento si dicono in parole, con il nome del segmento", () => {
  const { t1, modello, oggi } = rete3();
  const m = costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" });
  const porta: Porta = { nodo: "dev:1", chiave: "n:porta-a", nome: "porta-a", certa: true, fisica: true, senzaFili: false, nelBridge: true };
  const seg = { id: "seg:dev:1|n:porta-a", membri: [porta], altriApparati: 0, frase: "" };
  const nuovo: Record<string, string | null> = { "dev:1": null, "dev:2": "seg:dev:1|n:porta-a", "dev:3": null };
  const mm = { ...m, segmenti: [seg], albero: { ...m.albero, padri: nuovo, via: new Map(), scelto: new Map() } };
  const tr = calcolaTraccia(oggi, mm);
  assert.deepEqual(tr.righe.map((r) => [r.id, r.dopo, r.perche]), [
    ["dev:2", "seg:dev:1|n:porta-a", "la sua porta sente più apparati: sta su un segmento"],
    ["dev:3", null, "nella mappa nuova è una partenza dell'albero"],
  ]);
  assert.equal(nomiTraccia(modello, mm, tr)["seg:dev:1|n:porta-a"], "segmento su RTR-1 porta-a");
});

test("senza lo schema delle letture in più la traccia lo dice; e dice sempre ciò che il modello in ombra non calcola ancora", () => {
  const { t1, modello, oggi } = rete3();
  const tr = calcolaTraccia(oggi, costruisciModelloCavi(ingresso(t1, { schema: false }), modello, { testaScelta: "dev:1" }));
  assert.equal(tr.schema, false);
  assert.ok(tr.nonCalcolato.length > 0 && tr.nonCalcolato.every((x) => x.trim() !== ""), "l'elenco di ciò che non si calcola non è mai vuoto");
});

test("un server attaccato dalla tabella MAC resta nell'albero per cavo: a letture spente non «esce»", () => {
  // Misura del Task 14 di T2 sulle copie (15/10): 13 host sul cliente A e 9 sulla rete B «uscivano» dalla mappa nuova con «non ha
  // un collegamento verso l'albero», pur avendo il cavo dedotto verso il loro switch. Il modello di oggi crea il nodo di un host
  // al bisogno (nodeFor) e la prova di bordo lo nomina con quell'id; l'indice del modello per cavo non l'aveva, e l'host restava
  // fuori dagli oggetti visibili.
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk })],
    hosts: [host(9, { mac: "02:00:00:00:00:09", hostname: "srv-9", classification: "server" })],
    neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1")],
    macPorts: [{ device_id: 2, mac: "02:00:00:00:00:09", port_name: "ether5", timestamp: "2026-10-13 11:00:00", source: "device" }],
    networks: [{ id: 1, cidr: "10.0.1.0/24", name: "lan", gateway: "10.0.1.1", location_id: null }],
  });
  const modello = buildTopologyModel(t1);
  const oggi = padriDi(computeMapView(modello, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation: "lr" }).tree);
  assert.equal(oggi["host:9"], "dev:2", "premessa: nella mappa di oggi il server sta sotto il suo switch");
  const m = costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" });
  assert.equal(m.albero.padri["host:9"], "dev:2");
  const tr = calcolaTraccia(oggi, m);
  assert.deepEqual([tr.escono, tr.entrano, tr.righe], [[], [], []]);
});

/**
 * Criterio C della misura del 16/10 (§13.7.8, ultimo punto). Forma vera della rete B: un firewall virtuale censito come apparato
 * (tipo «switch», schede «vtnet»), VM accesa del suo hypervisor e abbinata per MAC. Nella mappa di oggi sta sotto il router: la sua
 * «tabella MAC» vede il MAC del router sulla scheda vtnet3. Nel modello per cavo i suoi annunci e la sua tabella MAC sono «stessa
 * rete» (giusto), ma la traccia lo dava «fuori dall'albero: nella mappa nuova non ha un collegamento verso l'albero».
 */
const firewallVirtuale = (tabellaSua = true) => {
  const M = { rtr: "02:00:c1:00:01:01", sw: "02:00:c1:00:02:01", hv: "02:00:c1:00:41:01", v0: "02:00:c1:00:52:00", v3: "02:00:c1:00:52:03" };
  return ingresso(baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }),
      dev(41, { name: "pve-1", device_type: "server", vendor: "proxmox", host: "10.1.0.41", proxmox_scan: 1, port_count: 0 }),
      dev(52, { name: "FW-V", device_type: "switch", vendor: "fw-x", via: "ssh", host: "10.1.0.52", port_count: 4 })],
    knownMacs: [{ device_id: 1, mac: M.rtr }, { device_id: 2, mac: M.sw }, { device_id: 52, mac: M.v0 }, { device_id: 52, mac: M.v3 }],
    networks: [{ id: 1, cidr: "10.1.0.0/24", name: "lan", gateway: "10.1.0.1", location_id: null }],
    ports: [...porte(1, [[1, "ether1", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [5, "ether5", "10000 Mbps"]])],
    neighbors: [
      riga({ device_id: 1, local_port: "ether1,bridge", remote_device_name: "SW-2", remote_mac: M.sw, remote_port: "bridge/ether1", remote_platform: "MikroTik" }),
      riga({ device_id: 2, local_port: "ether1,bridge", remote_device_name: "RTR-1", remote_mac: M.rtr, remote_port: "bridge/ether1", remote_platform: "MikroTik" }),
    ],
    macPorts: [
      { device_id: 2, mac: M.hv, port_name: "ether5", timestamp: ORA_T2, source: "device" },
      { device_id: 2, mac: M.v0, port_name: "ether5", timestamp: ORA_T2, source: "device" },
      ...(tabellaSua ? [{ device_id: 52, mac: M.rtr, port_name: "vtnet3", timestamp: ORA_T2, source: "device" }, { device_id: 52, mac: M.v3, port_name: "vtnet3", timestamp: ORA_T2, source: "device" }] : []),
    ],
    vms: [{ scannedDeviceId: 41, vmid: 120, name: "fw-v", node: "pve-1", status: "running", type: "qemu", macs: [M.v0], ips: [], scannedAt: "2026-10-13T06:00:00.000Z" }],
    scanHosts: [{ scannedDeviceId: 41, hostname: "pve-1", ips: ["10.1.0.41"], macs: [M.hv], scannedAt: "2026-10-13T06:00:00.000Z" }],
  }));
};
const vistaAuto = (model: Parameters<typeof computeMapView>[0]) =>
  computeMapView(model, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation: "lr" });

test("criterio C (misura del 16/10, §13.7.8): un firewall in una VM sta dentro il suo hypervisor nella mappa nuova e nella traccia, con «stessa rete» nei dettagli; mai fuori", () => {
  const ing = firewallVirtuale();
  const t1 = buildTopologyModel(ing.t1);
  const oggi = padriDi(vistaAuto(t1).tree);
  assert.equal(oggi["dev:52"], "dev:1", "premessa: nella mappa di oggi la VM, coi collegamenti suoi, è un oggetto sotto il router");
  const m = costruisciModelloCavi(ing, t1, { testaScelta: "dev:1" });
  assert.equal(m.dentro.get("dev:52"), "dev:41", "nel modello per cavo sta dentro il suo hypervisor");
  const tr = calcolaTraccia(oggi, m);
  assert.deepEqual(tr.escono, [], "mai fuori dall'albero");
  const r = tr.righe.find((x) => x.id === "dev:52");
  assert.deepEqual([r?.prima, r?.dopo], ["dev:1", "dev:41"]);
  assert.match(r?.perche ?? "", /dentro il suo hypervisor/);
  assert.match(r?.perche ?? "", /stessa rete/);
  // Schermo = traccia: nella mappa nuova la VM non è un oggetto a sé ma una VM del riquadro del suo hypervisor, che sta nell'albero
  // dove lo mette la traccia.
  const mappa = modelloMappaCavi(t1, m, ing);
  const v = vistaAuto(mappa);
  assert.equal(v.visible.has("dev:52"), false, "dentro il riquadro dell'hypervisor, non un riquadro suo");
  assert.ok(v.visible.has("dev:41") && padriDi(v.tree)["dev:41"] === m.albero.padri["dev:41"], JSON.stringify(padriDi(v.tree)));
  assert.ok(mappa.vms.some((x) => x.nodeId === "dev:52" && x.hypervisorNodeId === "dev:41"), "la VM sta fra quelle dell'hypervisor");
  assert.ok(candidatiPerPorta(m, "dev:52", nomiDellaMappa(mappa)).righe.some((x) => x.scartati.some((s) => /stessa rete/.test(s.motivo))), "«stessa rete» nei dettagli");
  // Una VM che anche oggi sta dentro il suo hypervisor (senza collegamenti suoi) non «entra» e non cambia padre.
  const senza = firewallVirtuale(false);
  const t1s = buildTopologyModel(senza.t1);
  const trs = calcolaTraccia(padriDi(vistaAuto(t1s).tree), costruisciModelloCavi(senza, t1s, { testaScelta: "dev:1" }));
  assert.deepEqual([trs.entrano, trs.escono, trs.righe.filter((x) => x.id === "dev:52")], [[], [], []]);
  // Eccezione già decisa (§13.16 punto 3): la VM confermata come testa resta fuori dalla regola.
  assert.equal(costruisciModelloCavi(ing, t1, { testaScelta: "dev:52" }).dentro.has("dev:52"), false);
});
