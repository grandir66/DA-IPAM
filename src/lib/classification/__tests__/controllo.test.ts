// Controllo della classificazione: i casi veri trovati su DTS il 12/11/2026 (telefoni scritti «VoIP», server
// scritti «VM», telefono Yealink con «Windows XP», MikroTik su dodici righe, righe senza classe).
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlla, type RigaControllo } from "../controllo";

const riga = (p: Partial<RigaControllo>): RigaControllo => ({
  id: 1, ip: "10.0.0.1", nome: null, mac: "AA:BB:CC:00:00:01", vendor: null, os: null, porte: [],
  classeAdesso: null, aMano: false, righeStessoNome: 1, macVeriStessoNome: 1, ...p,
});
const famiglie = (r: RigaControllo) => controlla(r).map((x) => x.famiglia);

test("un Galaxy scritto «VoIP» va a smartphone", () => {
  const r = controlla(riga({ nome: "Galaxy-S25", classeAdesso: "voip", classeRicalcolata: "voip" }));
  assert.equal(r[0].famiglia, "nome_contro_classe");
  assert.equal(r[0].proposta, "smartphone");
});

test("un telefono già smartphone non dà rilievi", () => {
  assert.deepEqual(famiglie(riga({ nome: "iPhone", classeAdesso: "smartphone", classeRicalcolata: "smartphone" })), []);
});

test("classe rimasta scritta che il motore non sostiene", () => {
  const r = controlla(riga({ nome: "pc-rossi", vendor: "Intel Corporate", classeAdesso: "voip", classeRicalcolata: null }));
  assert.equal(r[0].famiglia, "ricalcolo");
  assert.equal(r[0].proposta, null);
});

test("la scelta a mano non viene mai sostituita dal ricalcolo", () => {
  assert.ok(!famiglie(riga({ classeAdesso: "switch", aMano: true, classeRicalcolata: "router" })).includes("ricalcolo"));
});

test("SRV-PDM scritto «VM» è un server", () => {
  const r = controlla(riga({ nome: "SRV-PDM.dts.local", classeAdesso: "vm", classeRicalcolata: "vm" }));
  assert.equal(r[0].famiglia, "forma_non_funzione");
  assert.equal(r[0].proposta, "server");
});

test("una VM senza nome da server resta com'è", () => {
  assert.deepEqual(famiglie(riga({ nome: "dcarlo", classeAdesso: "vm", classeRicalcolata: "vm" })), []);
});

test("Yealink con Windows XP: sistema non credibile", () => {
  assert.ok(famiglie(riga({ vendor: "Yealink(Xiamen) Network Technology Co.,Ltd.", os: "Windows XP Professional", classeAdesso: "voip", classeRicalcolata: "voip" })).includes("sistema_non_credibile"));
});

test("«Windows 7» con SSH e senza 445 è con ogni probabilità Linux; con 445 no", () => {
  assert.ok(famiglie(riga({ os: "Windows 7 Professional N", porte: [22, 443], classeAdesso: "vm", classeRicalcolata: "vm" })).includes("sistema_non_credibile"));
  assert.ok(!famiglie(riga({ os: "Windows 7 Professional N", porte: [22, 135, 445], classeAdesso: "vm", classeRicalcolata: "vm" })).includes("sistema_non_credibile"));
});

test("senza classe: il produttore di automazione propone OT, un produttore ignoto dice cosa manca", () => {
  const ot = controlla(riga({ vendor: "Siemens AG", classeRicalcolata: null }));
  assert.equal(ot[0].proposta, "rete_ot");
  const buio = controlla(riga({ mac: null, classeRicalcolata: null }));
  assert.equal(buio[0].proposta, null);
  assert.match(buio[0].motivo, /nessun MAC.*produttore ignoto.*nessun nome.*nessuna porta letta/);
});

test("lo stesso nome su tante righe si segnala, un nome di serie no", () => {
  assert.ok(famiglie(riga({ nome: "MK-D1-RTR", classeAdesso: "router", classeRicalcolata: "router", righeStessoNome: 12 })).includes("stesso_apparato"));
  assert.ok(!famiglie(riga({ nome: "iPhone", classeAdesso: "smartphone", classeRicalcolata: "smartphone", righeStessoNome: 20 })).includes("stesso_apparato"));
});

test("diciotto telefoni dello stesso modello, con MAC veri diversi, non sono un apparato solo", () => {
  assert.ok(!famiglie(riga({ nome: "SIP-T23G", classeAdesso: "voip", classeRicalcolata: "voip", righeStessoNome: 18, macVeriStessoNome: 18 })).includes("stesso_apparato"));
});
