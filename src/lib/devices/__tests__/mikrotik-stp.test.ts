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
  parseMonitorFasci, parseMonitorPorte, parsePorteBridge, tabellaMonitor, tipoNeutro,
} from "@/lib/devices/mikrotik-stp";

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

const lettura = () => ({
  interfacce: parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: parseBridge(F("mikrotik-mk3-testa.txt")),
  porteBridge: parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
  monitorPorte: parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: parseFasci(F("mikrotik-mk8a-testa.txt")),
  monitorFasci: parseMonitorFasci(F("mikrotik-mk8b-testa.txt")),
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
