// SN2-SN9 (spec §13.5.4) su una lettura inventata con la forma delle MIB standard e della CISCO-CDP-MIB (famiglia 3 delle
// reti-campione, spec §13.12.2): DEDOTTA DALLE MIB, NON OSSERVATA su nessun apparato. Uno switch in Rapid-PVST con un
// fascio «Po1», una porta bloccata, un vicino LLDP con porta locale data come porta del bridge (SN5: secondo pezzo
// dell'indice), CDP fra due apparati della stessa marca e da un'altra marca (SN9), e una porta del bridge che non si
// traduce (SN4, I26). I valori del ruolo MSTP (root 1, alternate 2, designated 3, backup 4) sono quelli della MIB: da
// verificare sulla prima lettura vera.
//
// In più (livello completo): tre esiti per lettura; la regola dei null del piano di T2 («Scelte», punto 8); niente bridge
// inventato da una tabella vuota; solo le dieci tabelle, in sola lettura.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { leggiSnmpTopologia, TABELLE_SNMP } from "@/lib/devices/snmp-topologia";
import type { SnmpWalkFn } from "@/lib/devices/snmp-walk";

const IF = "1.3.6.1.2.1.2.2.1", XIF = "1.3.6.1.2.1.31.1.1.1.1", BASE = "1.3.6.1.2.1.17.1", STP = "1.3.6.1.2.1.17.2";
const LOC = "1.0.8802.1.1.2.1.3.7.1", REM = "1.0.8802.1.1.2.1.4.1.1", MAN = "1.0.8802.1.1.2.1.4.2.1", CDP = "1.3.6.1.4.1.9.9.23.1.2.1.1";
const LAG = "1.2.840.10006.300.43.1.2.1.1", MSTP = "1.3.111.2.802.1.1.6.1.3.1.14";
const mac = (...b: number[]) => Buffer.from(b);
type Voci = Array<[string, Buffer | number | string]>;
const VOCI: Voci = [
  [`${IF}.2.10101`, "GigabitEthernet1/0/1"], [`${IF}.2.10124`, "GigabitEthernet1/0/24"], [`${IF}.2.5001`, "Port-channel1"], [`${IF}.2.1`, "Vlan1"],
  [`${IF}.3.10101`, 6], [`${IF}.3.10124`, 6], [`${IF}.3.5001`, 161], [`${IF}.3.1`, 135],
  [`${IF}.6.10101`, mac(2, 0, 0xc, 0, 0, 1)], [`${IF}.6.10124`, mac(2, 0, 0xc, 0, 0, 0x18)], [`${IF}.6.5001`, mac(2, 0, 0xc, 0, 0, 0x30)], [`${IF}.6.1`, mac(2, 0, 0xc, 0, 0, 0x40)],
  [`${IF}.8.10101`, 1], [`${IF}.8.10124`, 1], [`${IF}.8.5001`, 1], [`${IF}.8.1`, 1],
  [`${XIF}.10101`, "Gi1/0/1"], [`${XIF}.10124`, "Gi1/0/24"], [`${XIF}.5001`, "Po1"], [`${XIF}.1`, "Vl1"],
  [`${BASE}.1.0`, mac(2, 0, 0xc, 0, 0, 0x40)],
  [`${BASE}.4.1.2.1`, 10101], [`${BASE}.4.1.2.24`, 10124], [`${BASE}.4.1.2.25`, 5001],
  [`${STP}.2.0`, 32768], [`${STP}.5.0`, mac(0x10, 0, 2, 0, 0xc, 0, 0, 0x99)], [`${STP}.6.0`, 4], [`${STP}.7.0`, 25], [`${STP}.16.0`, 2],
  [`${STP}.15.1.3.1`, 5], [`${STP}.15.1.3.24`, 2], [`${STP}.15.1.3.25`, 5], [`${STP}.15.1.3.30`, 5],
  [`${STP}.15.1.8.25`, mac(0x10, 0, 2, 0, 0xc, 0, 0, 0x99)], [`${STP}.15.1.9.25`, mac(0x80, 0x19)],
  [`${LOC}.3.24`, "Gi1/0/24"], [`${LOC}.4.24`, "GigabitEthernet1/0/24"],
  [`${REM}.4.0.24.1`, 4], [`${REM}.5.0.24.1`, mac(2, 0, 0xc, 0, 0, 0x99)], [`${REM}.6.0.24.1`, 5], [`${REM}.7.0.24.1`, "Gi1/0/48"],
  [`${REM}.9.0.24.1`, "SW-CENTRO"], [`${REM}.12.0.24.1`, mac(0x28)],
  [`${MAN}.3.0.24.1.1.4.10.0.0.9`, 2],
  [`${CDP}.6.10101.1`, "SW-B"], [`${CDP}.7.10101.1`, "GigabitEthernet1/0/2"], [`${CDP}.8.10101.1`, "cisco WS-C2960X-48TS-L"], [`${CDP}.4.10101.1`, mac(10, 0, 0, 7)],
  [`${CDP}.6.10124.2`, "AP-3"], [`${CDP}.7.10124.2`, "eth0"], [`${CDP}.8.10124.2`, "HPE J9772A"],
  [`${LAG}.13.10101`, 5001], [`${LAG}.9.10101`, mac(2, 0, 0xc, 0, 0, 0x99)], [`${LAG}.13.10124`, 0],
  [`${MSTP}.1.25`, 1], [`${MSTP}.1.24`, 2],
];
function walkFinto(fallisce: string[] = [], voci: Voci = VOCI, errori: Record<string, Error> = {}): { walk: SnmpWalkFn; letti: string[] } {
  const letti: string[] = [];
  const walk: SnmpWalkFn = async (oid) => {
    letti.push(oid);
    if (fallisce.includes(oid)) throw Object.assign(new Error("Request timed out"), { code: "TEMPO_SCADUTO" });
    if (errori[oid]) throw errori[oid];
    return voci.filter(([o]) => o.startsWith(`${oid}.`)).map(([o, v]) => ({ oid: o, value: v }));
  };
  return { walk, letti };
}
/** Le stesse voci, con quelle di un sotto-albero cambiate o tolte. */
const senza = (pre: string): Voci => VOCI.filter(([o]) => !o.startsWith(`${pre}.`));

test("dieci letture, una per tabella", async () => {
  const w = walkFinto();
  const l = await leggiSnmpTopologia(w.walk, { lettoreCisco: true });
  assert.deepEqual([l.letture, l.riuscite, l.codice, w.letti.length], [10, 10, null, 10]);
});

test("SN2 e SN3: versione vera, radice, porta radice tradotta dalla porta del bridge", async () => {
  const l = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  assert.deepEqual(l.bridge, [{
    bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, bridge_id: "32768.02:00:0c:00:00:40",
    root_id: "4096.02:00:0c:00:00:99", root_port: "Po1", root_path_cost: 4,
  }]);
});

test("SN3, SN4 (I26) e SN7: stato solo sulle porte tradotte; tipo dall'ifType, mai dal nome; fascio e partner", async () => {
  const l = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  const p = (k: string) => l.porte.find((x) => x.port_key === k);
  assert.deepEqual([p("i:10124")?.stp_state, p("i:10124")?.stp_role, p("i:10124")?.in_bridge], ["discarding", "alternate", 1]);
  assert.deepEqual([p("i:5001")?.if_kind, p("i:5001")?.stp_state, p("i:5001")?.stp_role, p("i:5001")?.designated_bridge, p("i:5001")?.designated_port],
    ["lag", "forwarding", "root", "4096.02:00:0c:00:00:99", "0x80.25"]);
  assert.deepEqual([p("i:10101")?.lag_group, p("i:10101")?.lag_partner], ["if:5001", "02:00:0C:00:00:99"]);
  assert.deepEqual([p("i:1")?.if_kind, p("i:1")?.stp_state, p("i:1")?.in_bridge], ["vlan", null, 0]);
  assert.equal(l.porte.some((x) => x.stp_state !== null && x.port_index === 30), false, "la porta 30 del bridge non si traduce: nessuno stato");
  assert.equal(new Set(l.macs.map((m) => m.mac)).size, 4, "il MAC del bridge è anche quello della VLAN: una volta sola");
});

test("SN5: il vicino LLDP sulla porta locale data dal secondo pezzo dell'indice, con telaio, capacità e indirizzo", async () => {
  const l = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  assert.deepEqual(l.vicini.filter((v) => v.protocol === "lldp"), [{
    localPort: "Gi1/0/24", localPortIndex: 10124, remoteDevice: "SW-CENTRO", remotePort: "Gi1/0/48", protocol: "lldp",
    remoteMac: "02:00:0C:00:00:99", remoteIp: "10.0.0.9", remoteCaps: "bridge,router",
  }]);
});

test("SN9: CDP come collegamento solo fra due apparati della stessa marca; altrimenti annuncio di segmento", async () => {
  const cisco = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  assert.deepEqual(cisco.vicini.filter((v) => v.protocol !== "lldp").map((v) => [v.remoteDevice, v.protocol]), [["SW-B", "cdp"], ["AP-3", "mndp"]]);
  const altra = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: false });
  assert.deepEqual(altra.vicini.filter((v) => v.protocol !== "lldp").map((v) => v.protocol), ["mndp", "mndp"]);
});

test("una tabella che non risponde non ferma le altre", async () => {
  const l = await leggiSnmpTopologia(walkFinto([REM]).walk, { lettoreCisco: true });
  assert.deepEqual([l.letture, l.riuscite, l.codice], [10, 9, "TEMPO_SCADUTO"]);
  assert.equal(l.vicini.filter((v) => v.protocol === "lldp").length, 0);
  assert.ok(l.porte.length > 0);
});

// ── Livello completo: le garanzie in più ─────────────────────────────────────

test("tre esiti per lettura: letta (anche vuota), non riuscita col suo codice, non so (tempo scaduto); il primo codice", async () => {
  const rifiutata = Object.assign(new Error("genErr"), { code: "SNMP_STATO_5" }); // l'agente risponde con un errore: «no» (snmp-walk.ts)
  const l = await leggiSnmpTopologia(walkFinto([CDP], senza(MSTP), { [LAG]: rifiutata }).walk, { lettoreCisco: true });
  assert.deepEqual([l.letture, l.riuscite, l.codice], [10, 8, "TEMPO_SCADUTO"], "CDP (non so) prima dei fasci (no) nell'ordine di lettura");
  assert.equal(l.vicini.some((v) => v.protocol !== "lldp"), false, "CDP non letto: nessun vicino inventato");
  assert.ok(l.porte.every((p) => p.lag_group === null && p.lag_partner === null), "fasci non letti: null, non il valore di prima");
  assert.ok(l.porte.every((p) => p.stp_role === null), "MSTP letto e vuoto: nessun ruolo");
  const soloFasci = await leggiSnmpTopologia(walkFinto([], VOCI, { [LAG]: rifiutata }).walk, { lettoreCisco: true });
  assert.deepEqual([soloFasci.riuscite, soloFasci.codice], [9, "SNMP_STATO_5"]);
});

test("regola dei null (piano di T2, «Scelte» 8): ogni riga porta le stesse colonne; una tabella non letta dà null in tutte", async () => {
  const CONOSCIUTE = ["port_key", "port_name", "port_index", "if_kind", "running", "in_bridge", "lag_group", "lag_partner",
    "stp_role", "stp_state", "designated_bridge", "designated_port"].sort();
  for (const w of [walkFinto(), walkFinto([STP]), walkFinto([BASE, LAG, MSTP])]) {
    const l = await leggiSnmpTopologia(w.walk, { lettoreCisco: true });
    assert.ok(l.porte.length > 0);
    for (const p of l.porte) assert.deepEqual(Object.keys(p).sort(), CONOSCIUTE, "le colonne che SNMP non legge mancano da tutte le righe");
    for (const b of l.bridge) assert.deepEqual(Object.keys(b).sort(),
      ["bridge_id", "bridge_name", "instance", "priority", "protocol", "root_id", "root_path_cost", "root_port"]);
  }
  const senzaStp = await leggiSnmpTopologia(walkFinto([STP]).walk, { lettoreCisco: true });
  assert.ok(senzaStp.porte.every((p) => p.stp_state === null && p.designated_bridge === null && p.designated_port === null));
  assert.deepEqual(senzaStp.bridge, [], "spanning tree non letto: nessuna riga del bridge");
  const senzaBase = await leggiSnmpTopologia(walkFinto([BASE]).walk, { lettoreCisco: true });
  assert.ok(senzaBase.porte.every((p) => p.in_bridge === null && p.stp_state === null), "porte del bridge non lette: non noto, mai «fuori»");
});

test("uno switch senza spanning tree (tabella letta e vuota): nessuna riga del bridge, mai una radice inventata", async () => {
  const l = await leggiSnmpTopologia(walkFinto([], senza(STP)).walk, { lettoreCisco: true });
  assert.deepEqual([l.riuscite, l.bridge], [10, []]);
  assert.ok(l.porte.length > 0);
});

test("la porta radice che non si traduce si scrive bridge-port:<n>, mai null (null vuol dire «radice»)", async () => {
  const voci: Voci = VOCI.map(([o, v]) => [o, o === `${STP}.7.0` ? 30 : v]);
  const l = await leggiSnmpTopologia(walkFinto([], voci).walk, { lettoreCisco: true });
  assert.equal(l.bridge[0]?.root_port, "bridge-port:30");
  const radice = await leggiSnmpTopologia(walkFinto([], VOCI.map(([o, v]) => [o, o === `${STP}.7.0` ? 0 : v])).walk, { lettoreCisco: true });
  assert.equal(radice.bridge[0]?.root_port, null, "porta radice 0: questo bridge è la radice");
});

test("sola lettura: le dieci tabelle, ognuna una volta; il lettore non ha una sessione, solo la funzione di walk", async () => {
  const w = walkFinto();
  await leggiSnmpTopologia(w.walk, { lettoreCisco: false });
  assert.deepEqual(w.letti, Object.values(TABELLE_SNMP));
  const testo = fs.readFileSync(path.join(__dirname, "..", "snmp-topologia.ts"), "utf8");
  assert.doesNotMatch(testo, /net-snmp|snmp-sessione|createSession|createV3Session/, "nessuna sessione qui: niente SET possibile");
});
