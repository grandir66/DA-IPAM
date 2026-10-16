// Spec topologia §13.5.2 (lettore di T1, prova I16). Incidente del 14/10: il lettore di prima leggeva ogni valore
// fino al primo spazio — nel «terse» RouterOS non mette le virgolette ai valori con gli spazi, e «Port 47» diventava
// «Port» — e scriveva sempre `mndp`, anche per le righe LLDP (sul cliente A 0 righe `lldp` su 52 del router 1).
// Fixture: la forma vera dell'uscita del router 1 del 14/10, con nomi, IP e MAC inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { campiTerse, mikrotikProtocol, parseMikrotikNeighbors, righeDiUscita } from "@/lib/devices/mikrotik-vicini";

const TERSE = fs.readFileSync(path.join(__dirname, "fixtures", "mikrotik-ip-neighbor-terse.txt"), "utf8");

test("valori interi: i valori con gli spazi senza virgolette finiscono alla chiave dopo", () => {
  const v = parseMikrotikNeighbors(TERSE);
  assert.equal(v.length, 9);
  assert.deepEqual(v[0], {
    localPort: "ether1-2.5", remoteDevice: "SW-ACC-A", remotePort: "Port 47", protocol: "lldp",
    remoteIp: undefined, remoteMac: "02:00:00:00:A1:01", remotePlatform: "UBNT", discoveredBy: "lldp", remoteCaps: "bridge,router",
  });
  assert.equal(v[4].remotePort, "Port 15 - WAN sede");
  assert.equal(v[6].remotePort, "Uplink verso il router");
  assert.equal(v[4].remotePlatform, "US-8-60W,");
  // Q-T1 in forma neutra (vale per ogni rete): nessuna porta remota senza spazio che sia la prima parola di un'altra con lo spazio.
  const conSpazio = v.map((x) => x.remotePort).filter((r) => r.includes(" "));
  assert.deepEqual(v.filter((x) => x.remotePort !== "" && !x.remotePort.includes(" ") && conSpazio.some((r) => r.startsWith(`${x.remotePort} `))), []);
});

test("campi vuoti: «identity= platform=» resta vuoto, non si mangia la chiave dopo", () => {
  const radio = parseMikrotikNeighbors(TERSE)[3];
  assert.deepEqual([radio.localPort, radio.remoteDevice, radio.remotePort, radio.remotePlatform, radio.protocol], ["ether3,bridge", "", "", undefined, "lldp"]);
});

test("I16 — il protocollo è quello letto: lldp se c'è, altrimenti mndp (anche con cdp); senza il campo mndp", () => {
  assert.equal(mikrotikProtocol("lldp"), "lldp");
  assert.equal(mikrotikProtocol("cdp,lldp,mndp"), "lldp");
  assert.equal(mikrotikProtocol("cdp,mndp"), "mndp"); // il CDP di un MikroTik attraversa gli switch: non conferma un cavo (M-5)
  assert.equal(mikrotikProtocol("cdp"), "mndp");
  assert.equal(mikrotikProtocol(undefined), "mndp"); // RouterOS prima della 7.7: come prima
  assert.equal(mikrotikProtocol(""), "mndp");
  assert.deepEqual(parseMikrotikNeighbors(TERSE).map((x) => x.protocol), ["lldp", "mndp", "mndp", "lldp", "lldp", "lldp", "lldp", "mndp", "lldp"]);
});

test("indirizzo: address4 prima di address; un IPv6 non è un IP del modello; il MAC in maiuscolo", () => {
  const v = parseMikrotikNeighbors(" 0 interface=ether2 address=fe80::1 mac-address=02:00:00:00:e1:01 identity=X discovered-by=lldp\n");
  assert.deepEqual([v[0].remoteIp, v[0].remoteMac], [undefined, "02:00:00:00:E1:01"]);
  assert.equal(parseMikrotikNeighbors(TERSE)[1].remoteIp, "10.0.9.254");
});

test("Review Focus 4 — «=» e virgolette dentro un valore del detail non fanno perdere i campi dopo", () => {
  const c = campiTerse(' 9  interface=ether2 identity="Radio 60 \\"lontana\\"" system-description="rack 2 a=b" interface-name="bridge/bond1/wlan60-1" discovered-by=lldp');
  assert.equal(c.get("identity"), 'Radio 60 "lontana"');
  assert.equal(c.get("system-description"), "rack 2 a=b");
  assert.equal(c.get("interface-name"), "bridge/bond1/wlan60-1");
  assert.equal(c.get("discovered-by"), "lldp");
  assert.equal(c.has("a"), false);
});

// Il detail incollato da Riccardo (T1-a) dà le righe nuove del router per C18 e per la prova di ritorno R6.
test("il detail incollato: righe a capo, prompt e commenti", () => {
  const detail = [
    "# uscita incollata", "[admin@RTR-1] > /ip neighbor print detail without-paging",
    ' 0  interface=ether1-2.5 mac-address=02:00:00:00:A1:01 identity="SW-ACC-A" platform="UBNT" version="" interface-name="Port 47"',
    '    system-description="UBNT-USW8P60" system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp', "",
    ' 1  interface=sfp-sfpplus1,bridge identity="CORE-1" interface-name="Uplink verso il router" discovered-by=lldp',
  ].join("\n");
  assert.deepEqual(righeDiUscita(detail).length, 2);
  const v = parseMikrotikNeighbors(detail);
  assert.deepEqual(v.map((x) => [x.localPort, x.remotePort, x.protocol]), [["ether1-2.5", "Port 47", "lldp"], ["sfp-sfpplus1,bridge", "Uplink verso il router", "lldp"]]);
});

test("una riga senza interfaccia né identità non è un vicino; «Flags:» non è una riga", () => {
  assert.deepEqual(parseMikrotikNeighbors("Flags: X - disabled\n 0 age=3s discovered-by=lldp\n"), []);
});

// ─── Le forme vere di due reti (spec §13.5.2, «Le forme vere»; vincolo 9 di Riccardo: il lettore vale per ogni rete) ───
// Rete B (l'hub): il router di testa, RouterOS 7.24, letto via ssh senza terminale come lo legge l'app (14/10 sera): righe
// chiuse da «\r\n», indici a due cifre senza spazio davanti, un bridge e delle VLAN coi nomi scelti, i membri di due fasci
// nel bridge, lo stesso apparato sentito con più MAC, CDP inoltrato su un membro di un fascio, un carattere di controllo
// nella piattaforma. Cliente A: il detail del router 1 incollato dal terminale (T1-a). Valori inventati a pari lunghezza:
// gli a capo restano dove RouterOS li mette (79 colonne via ssh; la larghezza del terminale, fino a 158, se incollato).
const leggi = (nome: string): string => fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8");
const TERSE_SSH = leggi("mikrotik-ip-neighbor-terse-ssh.txt");
const DETAIL_SSH = leggi("mikrotik-ip-neighbor-detail-ssh.txt");
const DETAIL_INCOLLATO = leggi("mikrotik-ip-neighbor-detail-incollato.txt");

test("rete B via ssh: «\\r\\n» a fine riga, indici a due cifre, contenitori coi nomi scelti, valori con spazi interi", () => {
  assert.equal((TERSE_SSH.match(/\r\n/g) ?? []).length, 12, "la fixture tiene i \\r\\n dell'uscita vera");
  const v = parseMikrotikNeighbors(TERSE_SSH);
  assert.deepEqual(v.map((x) => x.localPort), [
    "sfp-sfpplus1,BR_RP", "sfp-sfpplus4,BR_RP", "sfp-sfpplus11,bond2,BR_RP", "sfp28-1,bond1,BR_RP", "sfp28-1,bond1,BR_RP",
    "sfp28-1,bond1,BR_RP", "sfp28-2,bond1,BR_RP", "sfp28-2,bond1,BR_RP", "VL_22_CGWR", "VL_22_CGWR", "VL_22_CGWR", "VL_214_BFPTPMF",
  ]);
  // lldp solo dove `discovered-by` lo dice; cdp e mndp sono annunci di segmento (M-5)
  assert.deepEqual(v.map((x) => x.protocol), ["lldp", "lldp", "lldp", "mndp", "lldp", "mndp", "mndp", "lldp", "mndp", "mndp", "mndp", "mndp"]);
  assert.deepEqual([v[2].remotePort, v[4].remotePort, v[7].remotePort, v[8].remotePort], ["10GigabitEthernet 1/2", "SFP28 32", "SFP28 31 - CA-NCR-XJUK", "LR-BX/sfp-sfpplus3"]);
  assert.deepEqual([v[1].remoteDevice, v[1].remotePort, v[1].remotePlatform], ["", "", undefined]);
  assert.equal(v.some((x) => /\r/.test(`${x.localPort}${x.remoteDevice}${x.remotePort}${x.remotePlatform ?? ""}`)), false);
});

test("rete B: lo stesso apparato con più MAC (nelle righe di RouterOS il MAC è dell'interfaccia che annuncia, spec §13.6.4)", () => {
  const v = parseMikrotikNeighbors(TERSE_SSH);
  const mac = (nome: string, porta?: string) =>
    [...new Set(v.filter((x) => x.remoteDevice === nome && (porta === undefined || x.localPort === porta)).map((x) => x.remoteMac))].length;
  assert.equal(mac("AV-SZ-TLP"), 2);
  assert.equal(mac("HR-NPQ-SNF628-UC", "VL_22_CGWR"), 2, "due MAC sulla stessa interfaccia locale");
  // su un membro del fascio: l'aggregazione via LLDP e due apparati dietro di lei via CDP, che il lettore scrive `mndp`
  assert.deepEqual(v.filter((x) => x.localPort === "sfp28-1,bond1,BR_RP").map((x) => x.protocol).sort(), ["lldp", "mndp", "mndp"]);
});

test("rete B: terse e detail via ssh dello stesso router danno gli stessi vicini (il detail va a capo a 79 colonne)", () => {
  assert.equal((DETAIL_SSH.match(/\r\n/g) ?? []).length, 81);
  assert.equal(Math.max(...DETAIL_SSH.split("\r\n").map((r) => r.length)), 79);
  assert.equal(righeDiUscita(DETAIL_SSH).length, 12);
  const t = parseMikrotikNeighbors(TERSE_SSH), d = parseMikrotikNeighbors(DETAIL_SSH);
  // Il carattere di controllo nella piattaforma: la terse lo scrive come cifre, il detail con «\» (spec §13.5.2, MK1).
  assert.deepEqual([t[2].remotePlatform, d[2].remotePlatform], ["12.0.5.7760", "\\12.0.5.7760"]);
  const senza = (x: (typeof t)[number]) => ({ ...x, remotePlatform: x.remotePlatform === "\\12.0.5.7760" ? "12.0.5.7760" : x.remotePlatform });
  assert.deepEqual(d.map(senza), t);
  // Un valore fra virgolette spezzato a capo (riga rientrata di 7 spazi) si ricompone con uno spazio.
  assert.equal(campiTerse(righeDiUscita(DETAIL_SSH)[0]).get("system-description"), "MikroTik RouterOS 7.17.2 (stable) 2025-02-11 09:40:12 CRS520-4XS-16XQ-RM");
});

test("cliente A: il detail del router 1 incollato dal terminale (commenti, prompt, a capo fra un campo e l'altro)", () => {
  assert.equal(Math.max(...DETAIL_INCOLLATO.split("\n").map((r) => r.length)), 158);
  assert.equal(righeDiUscita(DETAIL_INCOLLATO).length, 12);
  const v = parseMikrotikNeighbors(DETAIL_INCOLLATO);
  assert.deepEqual(v.map((x) => [x.localPort, x.remotePort, x.protocol]), [
    ["ether1-2.5", "Port 47", "lldp"],
    ["ether1-2.5", "vrrp_rete_7", "mndp"],
    ["ether1-2.5", "bridge/sfp-sfpplus1", "mndp"],
    ["ether2", "bridge/bond1/wlan60-1", "mndp"],
    ["ether3,bridge", "", "lldp"],
    ["ether4,bridge", "bridge/ether4", "lldp"],
    ["ether8", "ether8", "lldp"],
    ["ether8", "Port 15 - XJS UZQ3 - Vkmeqvj", "lldp"],
    ["sfp-sfpplus1,bridge", "Muczxpxa WU9649 KDM6 1.17", "lldp"],
    ["vlan57-NJL79", "vlan57-NJL79", "mndp"],
    ["vrrp_rete_7", "ether1-2.5", "mndp"],
    ["vlan63-KKLDZVDFNJ", "vlan63_Lzemudfduc", "mndp"],
  ]);
  assert.equal(v[1].remoteMac, "00:00:5E:00:01:C6", "il MAC VRRP resta virtuale");
  assert.deepEqual([v[4].remoteDevice, v[4].remotePlatform], ["", undefined], "la radio: identità e piattaforma vuote");
});

// Un valore fra virgolette va a capo su uno spazio qualunque: la riga che lo continua può cominciare con «cifre spazio».
// Prima ogni riga che cominciava con un numero apriva un vicino, e il vicino vero perdeva i campi dopo (`discovered-by`:
// diventava `mndp`). Un indice ha al massimo due spazi davanti, una riga che continua almeno tre.
test("una riga che continua un valore e comincia con «cifre spazio» non apre un vicino nuovo", () => {
  const detail = [
    ' 0  interface=ether5 mac-address=02:00:00:00:E5:01 identity="SW-5" system-description="Switch gestito con ',
    '       24 porte e 4 SFP+" interface-name="Port 24" discovered-by=lldp',
    "",
    ' 1  interface=ether6 identity="SW-6" discovered-by=cdp,mndp',
  ].join("\r\n");
  assert.equal(righeDiUscita(detail).length, 2);
  assert.deepEqual(parseMikrotikNeighbors(detail).map((x) => [x.localPort, x.remotePort, x.protocol]), [["ether5", "Port 24", "lldp"], ["ether6", "", "mndp"]]);
});

test("le fixture sono anonime: solo MAC 02:… o virtuali, solo IP 10.x, IPv6 solo locali", () => {
  for (const testo of [TERSE, TERSE_SSH, DETAIL_SSH, DETAIL_INCOLLATO]) {
    for (const m of testo.match(/\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b/gi) ?? []) assert.match(m, /^(02:|00:00:5E:00:0[12]:)/i, m);
    for (const ip of testo.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) assert.match(ip, /^10\./, ip);
    for (const v6 of testo.match(/address6=\S+/g) ?? []) assert.match(v6, /^address6=fe80::/, v6);
  }
});

test("T2: discovered-by e capacità annunciate, in una forma sola; assenti se vuote", () => {
  const v = parseMikrotikNeighbors(TERSE);
  assert.deepEqual([v[0].discoveredBy, v[0].remoteCaps], ["lldp", "bridge,router"]);
  assert.deepEqual([v[5].discoveredBy, v[5].remoteCaps], ["cdp,lldp,mndp", "bridge,router"]);
  assert.equal("remoteCaps" in v[1], false, "system-caps-enabled= vuoto: niente campo");
});
