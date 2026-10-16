// Lettori di MK2-MK8 (spec topologia §13.5.2) sulle forme vere della rete B (14/10 sera, RouterOS 7.24), rese anonime.
// Le tabelle di `monitor` si leggono per colonne dalle posizioni della prima riga: divise sugli spazi si spostano appena
// una cella è vuota, come per una porta inattiva. Il bridge-id ha due forme. Un errore va su stdout con ssh uscito con 0:
// si riconosce dal testo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  bridgeIdNormale, cella, erroreRouterOs, fattiMikrotik, parseBridge, parseFasci, parseInterfacce, parseMonitorBridge,
  parseMonitorFasci, parseMonitorMsti, parseMonitorPorte, parseMsti, parsePorteBridge, tabellaMonitor, tipoNeutro, type LetturaMk,
} from "@/lib/devices/mikrotik-stp";
import { modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import { fb, fp, ingresso, vic } from "@/lib/topology/__tests__/support/cavi";
import { porte } from "@/lib/topology/__tests__/support/reti-campione";
import { baseInput, dev } from "@/lib/topology/__tests__/support/righe";

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

test("le fixture hanno la forma vera: righe chiuse da \\r\\n, spazi in coda conservati", () => {
  assert.equal(F("mikrotik-mk6-testa.txt").split("\r\n").length - 1, 23);
  assert.ok(F("mikrotik-mk5-testa.txt").includes("enabled            \r\n"), "gli spazi in coda della colonna ci sono");
});

test("MK2: nome, tipo, MAC; acceso dal segno R", () => {
  const i = parseInterfacce(F("mikrotik-mk2-testa.txt"));
  assert.equal(i.length, 24);
  assert.deepEqual(i[0], { nome: "ether1", tipo: "ether", mac: "02:00:A0:10:07:01", accesa: false, spenta: false });
  assert.deepEqual(i[1], { nome: "sfp-sfpplus1", tipo: "ether", mac: "02:00:A0:10:0E:02", accesa: true, spenta: false });
  assert.equal(i[5].accesa, false, "« S» senza R: la porta è giù");
  assert.deepEqual(i.filter((x) => x.mac === null).map((x) => x.nome), ["lo"], "un MAC tutto zeri non è un MAC");
  assert.deepEqual([...new Set(i.map((x) => tipoNeutro(x.tipo)))].sort(), ["bridge", "lag", "other", "physical", "tunnel", "vlan"]);
});

test("MK3: priorità esadecimale, modo, regione assente senza MSTP; un router senza bridge non ha righe", () => {
  assert.deepEqual(parseBridge(F("mikrotik-mk3-testa.txt")), [
    { nome: "BR_RP", modo: "rstp", priorita: 0, regione: null, revisione: null, mac: "02:00:A0:10:0E:02", vlanFiltering: true, maxAge: "20s", forwardDelay: "15s" },
  ]);
  assert.deepEqual(parseBridge(F("mikrotik-mk3-frontiera.txt")).map((b) => [b.nome, b.priorita, b.vlanFiltering]),
    [["BR_RP", 32768, true], ["BR_ZQ_77K", 32768, false]]);
  assert.deepEqual(parseBridge(F("mikrotik-vuoto.txt")), []);
});

test("MK4: porta del bridge, PVID, segno I; i fasci come porte", () => {
  const p = parsePorteBridge(F("mikrotik-mk4-testa.txt"));
  assert.equal(p.length, 10);
  assert.deepEqual(p[4], { porta: "sfp-sfpplus5", bridge: "BR_RP", pvid: 214, inattiva: true });
  assert.deepEqual(p.filter((x) => x.porta.startsWith("bond")).map((x) => x.porta), ["bond1", "bond2", "bond3"]);
  assert.deepEqual(parsePorteBridge(F("mikrotik-mk4-frontiera.txt")).map((x) => [x.porta, x.bridge, x.inattiva]),
    [["sfp-sfpplus12", "BR_RP", false], ["bonding1", "BR_RP", true], ["sfp-sfpplus8", "BR_ZQ_77K", true]]);
});

test("tabelle di monitor per colonne: una colonna stretta e le celle vuote non spostano le altre", () => {
  const t = tabellaMonitor(F("mikrotik-mk6-testa.txt"));
  assert.equal(t.colonne, 10);
  assert.equal(cella(t, "interface", 5), "sfp-sfpplus6");
  assert.equal(cella(t, "port-id", 4), "", "la porta inattiva ha le celle vuote");
  assert.equal(cella(t, "port-id", 5), "0x80.6");
  assert.equal(cella(t, "last-topology-change", 7), "2h9m25s");
  assert.equal(cella(t, "root-path-cost", 0), null, "una riga che manca vale «non letto»");
});

test("Casi da non dimenticare 2: un nome con uno spazio resta una colonna", () => {
  const out = [
    "               interface: uplink core  ether2     \r",
    "                  status: in-bridge    in-bridge  \r",
    "                    role: root-port    designated-port\r",
    "",
  ].join("\n");
  const t = tabellaMonitor(out);
  assert.equal(t.colonne, 2);
  assert.equal(cella(t, "interface", 0), "uplink core");
  assert.equal(cella(t, "role", 1), "designated-port");
});

test("MK5: una colonna per bridge, nell'ordine di MK3; bridge-id nelle due forme; porta radice", () => {
  assert.deepEqual(parseMonitorBridge(F("mikrotik-mk5-testa.txt")), [
    { bridgeId: "0.02:00:a0:10:0e:02", radice: true, radiceId: "0.02:00:a0:10:0e:02", radiceRegionaleId: null, portaRadice: null, costo: 0, digest: null },
  ]);
  assert.deepEqual(parseMonitorBridge(F("mikrotik-mk5-frontiera.txt")).map((b) => [b.bridgeId, b.radice, b.radiceId, b.portaRadice, b.costo]), [
    ["32768.02:00:a0:10:93:15", false, "0.02:00:a0:10:0e:02", "sfp-sfpplus12", 2400],
    ["32768.02:00:a0:10:9a:16", true, "32768.02:00:a0:10:9a:16", null, 0],
  ]);
  assert.deepEqual(parseMonitorBridge(F("mikrotik-vuoto.txt")), []);
});

test("bridgeIdNormale: le due forme di RouterOS in una (priorità decimale, MAC minuscolo)", () => {
  assert.equal(bridgeIdNormale("0x8000.02:00:A0:10:93:15"), "32768.02:00:a0:10:93:15");
  assert.equal(bridgeIdNormale("0.02:00:A0:10:0E:02"), "0.02:00:a0:10:0e:02");
  assert.equal(bridgeIdNormale("none"), null);
  assert.equal(bridgeIdNormale(""), null);
});

test("MK6: ruoli e stati nelle parole dello standard, BPDU ricevuti, porta inattiva senza stato", () => {
  const p = parseMonitorPorte(F("mikrotik-mk6-testa.txt"));
  assert.equal(p.length, 10);
  assert.deepEqual(p[0], {
    porta: "sfp-sfpplus1", attiva: true, ruolo: "designated", stato: "forwarding", bridgeDesignato: "0.02:00:a0:10:0e:02",
    portaDesignata: "0x80.1", costo: 10, bordo: true, puntoPunto: true, rstp: true, bpduRicevuti: 0,
  });
  assert.deepEqual(p[4], {
    porta: "sfp-sfpplus5", attiva: false, ruolo: null, stato: null, bridgeDesignato: null, portaDesignata: null, costo: null,
    bordo: null, puntoPunto: null, rstp: null, bpduRicevuti: null,
  });
  assert.deepEqual([p[6].porta, p[6].bordo, p[6].bpduRicevuti], ["bond1", false, 237]);
  const f = parseMonitorPorte(F("mikrotik-mk6-frontiera.txt"));
  assert.deepEqual([f[0].porta, f[0].ruolo, f[0].stato, f[0].bridgeDesignato, f[0].bpduRicevuti],
    ["sfp-sfpplus12", "root", "forwarding", "32768.02:00:a0:10:7e:12", 302210]);
  assert.deepEqual(f.slice(1).map((x) => [x.porta, x.attiva]), [["bonding1", false], ["sfp-sfpplus8", false]]);
});

test("MK8: membri, partner LACP, active-ports su più righe; nessun partner se la riga manca", () => {
  assert.deepEqual(parseFasci(F("mikrotik-mk8a-testa.txt")).map((f) => [f.nome, f.membri]), [
    ["bond1", ["sfp28-2", "sfp28-1"]], ["bond2", ["sfp-sfpplus11", "sfp-sfpplus12"]], ["bond3", ["sfp-sfpplus9", "sfp-sfpplus10"]],
  ]);
  assert.deepEqual(parseMonitorFasci(F("mikrotik-mk8b-testa.txt"))[0], { attivi: ["sfp28-1", "sfp28-2"], inattivi: [], partner: "02:00:A0:10:7E:12" });
  assert.deepEqual(parseMonitorFasci(F("mikrotik-mk8b-frontiera.txt")), [{ attivi: [], inattivi: ["sfp28-1", "sfp28-2"], partner: null }]);
});

test("un errore si riconosce dal testo, non dal codice d'uscita; le uscite buone non sono errori", () => {
  assert.equal(erroreRouterOs(F("mikrotik-errore.txt")), "NO_SUCH_ITEM");
  assert.equal(erroreRouterOs("bad command name zz (line 1 column 20)\r\n"), "BAD_COMMAND");
  assert.equal(erroreRouterOs("syntax error (line 1 column 5)\r\n"), "SYNTAX_ERROR");
  assert.equal(erroreRouterOs("expected end of command (line 1 column 31)\r\n"), "EXPECTED_END");
  for (const f of ["mikrotik-mk2-testa.txt", "mikrotik-mk5-testa.txt", "mikrotik-mk6-testa.txt", "mikrotik-vuoto.txt"]) assert.equal(erroreRouterOs(F(f)), null, f);
});

// Revisione del Task 4 di T2 (rilievo 3): un messaggio di RouterOS fuori dall'elenco passava per un'uscita buona; quella di
// `monitor` ha la forma «etichetta: valore», e «failure: …» diventava una colonna di bridge vuota. Tre messaggi in più.
test("errori di RouterOS in più: failure, permessi, valore che non c'è", () => {
  assert.equal(erroreRouterOs("failure: not allowed for this bridge\r\n"), "FAILURE");
  assert.equal(erroreRouterOs("not enough permissions (9)\r\n"), "NOT_ENOUGH_PERMISSIONS");
  assert.equal(erroreRouterOs("input does not match any value of interface\r\n"), "INPUT_DOES_NOT_MATCH");
});

const lettura = () => ({
  interfacce: parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: parseBridge(F("mikrotik-mk3-testa.txt")),
  porteBridge: parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
  monitorPorte: parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: parseFasci(F("mikrotik-mk8a-testa.txt")),
  monitorFasci: parseMonitorFasci(F("mikrotik-mk8b-testa.txt")), istanze: null, monitorIstanze: null,
});

test("i fatti del router di testa: porta, fascio, bridge, spanning tree, MAC", () => {
  const f = fattiMikrotik(lettura());
  const p = (n: string) => f.porte.find((x) => x.port_name === n);
  assert.deepEqual(p("sfp-sfpplus1"), {
    port_key: "n:sfp-sfpplus1", port_name: "sfp-sfpplus1", port_index: null, if_kind: "physical", running: 1, in_bridge: 1,
    bridge: "BR_RP", lag_group: null, lag_partner: null, stp_role: "designated", stp_state: "forwarding",
    designated_bridge: "0.02:00:a0:10:0e:02", designated_port: "0x80.1", path_cost: 10, edge: 1, point_to_point: 1,
    sending_rstp: 1, bpdu_rx: 0,
  });
  assert.deepEqual([p("sfp28-1")?.lag_group, p("sfp28-1")?.lag_partner, p("sfp28-1")?.in_bridge, p("sfp28-1")?.stp_state], ["bond1", "02:00:A0:10:7E:12", 1, null]);
  assert.deepEqual([p("bond1")?.if_kind, p("bond1")?.lag_group, p("bond1")?.stp_state, p("bond1")?.bpdu_rx], ["lag", "bond1", "forwarding", 237]);
  assert.deepEqual([p("ether1")?.in_bridge, p("ether1")?.running], [0, 0]);
  assert.deepEqual([p("tunnel-qa")?.if_kind, p("VL_3_QWRTY")?.if_kind, p("sfp-sfpplus5")?.stp_state], ["tunnel", "vlan", null]);
  assert.deepEqual(f.bridge, [{
    bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, bridge_id: "0.02:00:a0:10:0e:02", root_id: "0.02:00:a0:10:0e:02",
    regional_root_id: null, region_name: null, region_revision: null, config_digest: null, vlans: null, root_port: null, root_path_cost: 0,
  }]);
  assert.equal(f.macs.length, 17, "un MAC una volta sola; il loopback no");
});

test("senza MK4 una porta non è «fuori dal bridge»: non nota; senza MK3 nessun bridge", () => {
  const f = fattiMikrotik({ ...lettura(), bridge: null, porteBridge: null, monitorBridge: null });
  assert.equal(f.porte.find((x) => x.port_name === "ether1")?.in_bridge, null);
  assert.deepEqual(f.bridge, []);
});

// ── MK7: le istanze MSTP (Task 3b di T2), sulle uscite vere T2-a ─────────────────────────────────────────────────────────────
// Due router del cliente A (RouterOS 7.24.4) nella stessa regione, incollati dal terminale e resi anonimi: righe chiuse da
// \n, mentre via ssh l'app le riceve con \r\n (si provano tutte e due). A è la radice dell'albero comune (priorità 0x2000) e
// nell'istanza 1 ha la porta radice sul tunnel EoIP verso B; B è la radice regionale dell'istanza 1 (priorità 0x1000).
// Mancano il `msti print` di A, il `bridge print` di B e lo stato di ogni porta in ogni istanza (nessuno dei comandi letti lo
// dà): la prova che ne ha bisogno lo dice, e lo deduce dalle uscite che ci sono.
const CRLF = (s: string): string => s.replace(/\r?\n/g, "\r\n");

test("MK3 in MSTP: modo, regione e revisione dall'uscita vera", () => {
  const b = parseBridge(F("mikrotik-mk3-mstp-a.txt"));
  assert.deepEqual(b, [{ nome: "bridge", modo: "mstp", priorita: 0x2000, regione: "RGX", revisione: 1, mac: "02:00:00:00:00:10", vlanFiltering: true, maxAge: "20s", forwardDelay: "15s" }]);
  assert.deepEqual(parseBridge(CRLF(F("mikrotik-mk3-mstp-a.txt"))), b);
});

test("MK5 in MSTP: radice regionale e digest; B ha la porta radice dell'albero comune su ether3", () => {
  assert.deepEqual(parseMonitorBridge(F("mikrotik-mk5-mstp-a.txt")), [{
    bridgeId: "8192.02:00:00:00:00:10", radice: true, radiceId: "8192.02:00:00:00:00:10", radiceRegionaleId: "8192.02:00:00:00:00:10",
    portaRadice: null, costo: 0, digest: "a4c123b1612dd272d1371c17149d4395",
  }]);
  assert.deepEqual(parseMonitorBridge(CRLF(F("mikrotik-mk5-mstp-b.txt"))), [{
    bridgeId: "32768.02:00:00:00:00:11", radice: false, radiceId: "8192.02:00:00:00:00:10", radiceRegionaleId: "8192.02:00:00:00:00:10",
    portaRadice: "ether3", costo: 0, digest: "36b3216fdaeeb975729fae923d5a4fd1",
  }]);
});

test("MK7 print: un'istanza per riga, identificatore intero, VLAN con gli intervalli; la riga col segno D (l'albero comune) si legge", () => {
  const atteso = [
    { bridge: "bridge", identificatore: 1, vlan: "77", priorita: 0x1000 },
    { bridge: "bridge", identificatore: 0, vlan: "1-76,78-4094", priorita: 0x8000 },
  ];
  assert.deepEqual(parseMsti(F("mikrotik-mk7-msti-b.txt")), atteso);
  assert.deepEqual(parseMsti(CRLF(F("mikrotik-mk7-msti-b.txt"))), atteso);
  assert.deepEqual(parseMsti(F("mikrotik-vuoto.txt")), [], "senza MSTP l'uscita è vuota, nessun errore (14/10)");
  // Una mappa che non è «n» o «n-m» separati da virgole non si legge a metà (il modello scarterebbe il pezzo strano e
  // direbbe attive solo le VLAN rimaste): vuota, cioè VLAN non lette.
  assert.equal(parseMsti(" 0   identifier=2 bridge=bridge priority=0x3000 vlan-mapping=10,20-x\r\n")[0]?.vlan, "");
});

test("MK7 monitor: una colonna per istanza con l'identificatore; porta radice per nome, `none` = nessuna; radice regionale nella forma di `bridge-id`", () => {
  // La radice regionale dell'istanza 1 è scritta 0x1001.MAC: RouterOS somma il numero dell'istanza alla priorità (0x1000),
  // `bridge-id` e `priority` no. Si porta alla forma di `bridge-id`: così «radice regionale = questo bridge» si confronta.
  const a = [
    { identificatore: 1, radiceRegionaleId: "4096.02:00:00:00:00:11", portaRadice: "eoip-tunnel-SEDA-SEDB" },
    { identificatore: 0, radiceRegionaleId: "8192.02:00:00:00:00:10", portaRadice: null },
  ];
  assert.deepEqual(parseMonitorMsti(F("mikrotik-mk7-monitor-a.txt")), a);
  assert.deepEqual(parseMonitorMsti(CRLF(F("mikrotik-mk7-monitor-a.txt"))), a);
  assert.deepEqual(parseMonitorMsti(F("mikrotik-mk7-monitor-b.txt")), [
    { identificatore: 1, radiceRegionaleId: "4096.02:00:00:00:00:11", portaRadice: null },
    { identificatore: 0, radiceRegionaleId: "8192.02:00:00:00:00:10", portaRadice: "ether3" },
  ]);
  // Le colonne per posizione: dove la prima cella riempie la sua larghezza la seconda comincia dopo UNO spazio solo.
  const t = tabellaMonitor(F("mikrotik-mk7-monitor-b.txt"));
  assert.deepEqual([t.colonne, cella(t, "bridge-id", 0), cella(t, "bridge-id", 1)], [2, "0x1000.02:00:00:00:00:11", "0x8000.02:00:00:00:00:11"]);
  assert.deepEqual(parseMonitorMsti(F("mikrotik-vuoto.txt")), []);
});

/**
 * Il `msti print` di A non c'è (T2-a). Nella stessa regione la mappa VLAN → istanza è la stessa per definizione (è ciò che
 * il digest riassume): è la riga di B con le priorità di A, lette dal monitor di A (`bridge-id` 0x2000 nelle due istanze).
 */
const mstiA = (): string => F("mikrotik-mk7-msti-b.txt").replace("priority=0x1000", "priority=0x2000").replace("priority=0x8000", "priority=0x2000");
const letturaA = (over: Partial<LetturaMk> = {}): LetturaMk => ({
  interfacce: null, bridge: parseBridge(F("mikrotik-mk3-mstp-a.txt")), porteBridge: null, monitorBridge: parseMonitorBridge(F("mikrotik-mk5-mstp-a.txt")),
  monitorPorte: null, fasci: null, monitorFasci: null, istanze: parseMsti(mstiA()), monitorIstanze: parseMonitorMsti(F("mikrotik-mk7-monitor-a.txt")), ...over,
});

test("i fatti con MSTP: una riga per istanza (instance, VLAN, porta radice, radice regionale); l'istanza 0 resta la riga dell'albero comune, con le sue VLAN", () => {
  assert.deepEqual(fattiMikrotik(letturaA()).bridge, [
    { bridge_name: "bridge", instance: 0, protocol: "mstp", priority: 8192, bridge_id: "8192.02:00:00:00:00:10", root_id: "8192.02:00:00:00:00:10",
      regional_root_id: "8192.02:00:00:00:00:10", region_name: "RGX", region_revision: 1, config_digest: "a4c123b1612dd272d1371c17149d4395",
      vlans: "1-76,78-4094", root_port: null, root_path_cost: 0 },
    { bridge_name: "bridge", instance: 1, protocol: "mstp", priority: 8192, regional_root_id: "4096.02:00:00:00:00:11", vlans: "77", root_port: "eoip-tunnel-SEDA-SEDB" },
  ]);
});

test("i fatti con MSTP: senza il monitor, o con le colonne in un altro ordine, nessuna riga d'istanza (non lette), mai la porta radice di un'altra istanza", () => {
  const righe = (l: LetturaMk) => fattiMikrotik(l).bridge.map((b) => [b.instance, b.vlans ?? null, b.root_port ?? null]);
  assert.deepEqual(righe(letturaA({ monitorIstanze: null })), [[0, "1-76,78-4094", null]], "monitor non letto: le VLAN dell'albero comune sì, le istanze no");
  assert.deepEqual(righe(letturaA({ istanze: null, monitorIstanze: null })), [[0, null, null]]);
  assert.deepEqual(righe(letturaA({ monitorIstanze: parseMonitorMsti(F("mikrotik-mk7-monitor-a.txt")).reverse() })), [[0, "1-76,78-4094", null]]);
  // Un bridge che non è in MSTP non ha istanze, anche se `msti print` ne elencasse.
  const rstp = parseBridge(F("mikrotik-mk3-mstp-a.txt")).map((b) => ({ ...b, modo: "rstp" as const }));
  assert.deepEqual(righe(letturaA({ bridge: rstp })), [[0, null, null]]);
});

// Il modello per cavo sui fatti di MK7 (piano di T3, «Quando arriva il Task 3b»): il tunnel fra A e B è bloccato nell'albero
// comune sul capo di B (A è la radice, la porta radice di B è ether3) ed è la porta radice dell'istanza 1 su A. Dalle uscite
// mancano lo stato per porta (MK6) dei due capi, il nome del tunnel su B e il `bridge print` di B: stato e nome si mettono qui,
// il bridge di B è quello di A con la priorità e il MAC del monitor di B (stessa regione: la radice regionale dell'albero
// comune vista da B è A, e A vede B radice regionale dell'istanza 1).
function tunnelInRegione(digestB: string | null): ReturnType<typeof modelloMappaDaIngresso>["m"] {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const lan = { id: 1, cidr: "10.30.0.0/24", name: "lan", gateway: "10.30.0.1", location_id: null };
  const tunA = "eoip-tunnel-SEDA-SEDB", tunB = "eoip-tunnel-SEDB-SEDA";
  const bridgeB = parseBridge(F("mikrotik-mk3-mstp-a.txt")).map((b) => ({ ...b, priorita: 0x8000, mac: "02:00:00:00:00:11" }));
  const monB = parseMonitorBridge(F("mikrotik-mk5-mstp-b.txt")).map((m) => ({ ...m, digest: digestB ?? m.digest }));
  const fattiA = fattiMikrotik(letturaA()).bridge;
  const fattiB = fattiMikrotik({ ...letturaA(), bridge: bridgeB, monitorBridge: monB, istanze: parseMsti(F("mikrotik-mk7-msti-b.txt")),
    monitorIstanze: parseMonitorMsti(F("mikrotik-mk7-monitor-b.txt")) }).bridge;
  const t1 = baseInput({
    devices: [dev(1, { name: "RT-A", device_type: "router", host: "10.30.0.1", ...mk }), dev(2, { name: "RT-B", device_type: "router", host: "10.30.0.2", ...mk })],
    networks: [lan], ports: [...porte(1, [[1, tunA, "1000 Mbps"]]), ...porte(2, [[1, tunB, "1000 Mbps"]])], neighbors: [],
  });
  const ing = ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: `${tunA},bridge`, remote_device_name: "RT-B", remote_port: `bridge/${tunB}`, protocol: "mndp", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 2, local_port: `${tunB},bridge`, remote_device_name: "RT-A", remote_port: `bridge/${tunA}`, protocol: "mndp", source: "device", remote_platform: "MikroTik" })],
    fattiPorta: [
      fp(1, "i:1", tunA, { source: "device", if_kind: "tunnel", running: 1, stp_role: "designated", stp_state: "forwarding" }),
      fp(2, "i:1", tunB, { source: "device", if_kind: "tunnel", running: 1, stp_role: "alternate", stp_state: "discarding" }),
    ],
    fattiBridge: [...fattiA.map((b) => fb(1, b)), ...fattiB.map((b) => fb(2, b))],
  });
  return modelloMappaDaIngresso(ing, { testaScelta: "dev:1" }).m;
}

test("il tunnel della regione sui fatti veri di MK7: bloccato nell'albero comune, attivo per la VLAN 77 dell'istanza 1", () => {
  const stato = (m: ReturnType<typeof tunnelInRegione>) => m.collegamenti.map((c) => [c.genere, c.stato, c.attivoPerVlan, c.istanzeNonLette]);
  assert.deepEqual(stato(tunnelInRegione("a4c123b1612dd272d1371c17149d4395")), [["tunnel", "bloccato_comune", [77], undefined]]);
  // Con i digest come li scrivono le uscite rese anonime (diversi) i due bridge non sono la stessa regione (§13.7.2 passo 8:
  // stesso nome, revisione e digest): il tunnel è «bloccato» e basta. Sulla rete vera i due digest sono per forza uguali (la
  // radice regionale dell'istanza 1 vista da A è B), ma l'uscita non anonima va guardata (resoconto del Task 3b).
  assert.deepEqual(stato(tunnelInRegione(null)), [["tunnel", "bloccato", undefined, undefined]]);
});
