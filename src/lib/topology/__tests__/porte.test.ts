// Spec topologia §13.6.1, «La chiave»: la stessa porta ha una chiave sola. Accesso B del cliente A, 14/10: «SFP+ 1» è
// l'indice 49, «SFP 1» il 51, «Port 1» l'1, e «Port 1» e «SFP_ 1» hanno vicini LLDP diversi. Elenchi inventati con la
// forma vera di switch_ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiavePorta, elencoDa, elenchiPorte, indiciInElenco, normale, portaInElenco, stessaPorta } from "@/lib/topology/cavi/porte";
import { traduciUnifiLocale } from "@/lib/topology/lettori/unifi";
import { traduciGenerico } from "@/lib/topology/lettori/generico";

const ACCESSO = elencoDa([
  { port_index: 1, port_name: "Port 1" }, { port_index: 16, port_name: "Port 16" }, { port_index: 47, port_name: "Port 47" },
  { port_index: 49, port_name: "SFP+ 1" }, { port_index: 50, port_name: "SFP+ 2" }, { port_index: 51, port_name: "SFP 1" },
]);
const g = (nome: string) => traduciGenerico(nome);

test("I12: «SFP_ 1» è «SFP+ 1» (indice 49), mai «SFP 1» (51) né «Port 1» (1)", () => {
  assert.equal(chiavePorta("dev:2", traduciUnifiLocale("SFP_ 1"), "locale", ACCESSO).chiave, "i:49");
  assert.equal(chiavePorta("dev:2", traduciUnifiLocale("SFP 1"), "locale", ACCESSO).chiave, "i:51");
  assert.equal(chiavePorta("dev:2", traduciUnifiLocale("Port 1"), "locale", ACCESSO).chiave, "i:1");
});

test("nome uguale dopo la normalizzazione neutra (minuscole, senza spazi), mai togliendo «_» o «+»", () => {
  assert.equal(normale(" SFP+ 2 "), "sfp+2");
  assert.equal(chiavePorta("dev:2", g("sfp+2"), "remoto", ACCESSO).chiave, "i:50");
  assert.equal(chiavePorta("dev:2", g("SFP_2"), "remoto", ACCESSO).chiave, null);
});

test("I14: un nome doppio non si risolve per nome; I13: un nome che l'apparato non ha non è una porta", () => {
  const AGG = elencoDa([{ port_index: 15, port_name: "SFP+ 15" }, { port_index: 16, port_name: "SFP+ 15" }]);
  assert.deepEqual([chiavePorta("dev:9", g("SFP+ 15"), "remoto", AGG).chiave, chiavePorta("dev:9", g("SFP+ 15"), "remoto", AGG).certa], [null, false]);
  assert.deepEqual([chiavePorta("dev:2", g("eth0"), "locale", ACCESSO).chiave, chiavePorta("dev:2", g("eth0"), "locale", ACCESSO).certa], [null, false]);
});

test("solo per la porta remota: «Port N» o «N» (assegnato localmente) → l'indice N, se l'apparato non ha quel nome", () => {
  const CORE = elencoDa([{ port_index: 10, port_name: "Uplink verso il router" }, { port_index: 15, port_name: "Port 15 - WAN sede" }]);
  assert.equal(chiavePorta("dev:114", g("Port 10"), "remoto", CORE).chiave, "i:10");
  assert.equal(chiavePorta("dev:114", g("10"), "remoto", CORE).chiave, "i:10");
  assert.equal(chiavePorta("dev:114", g("Port 10"), "locale", CORE).chiave, null);
  // Una porta rinominata dal cliente: stesso nome nell'elenco e nell'LLDP.
  assert.equal(chiavePorta("dev:114", g("Uplink verso il router"), "remoto", CORE).chiave, "i:10");
  assert.equal(chiavePorta("dev:114", g("Port 99"), "remoto", CORE).chiave, null);
});

test("apparato senza elenco: il nome normalizzato; per il lato remoto solo se è l'unico visto verso di lui (I46)", () => {
  assert.equal(chiavePorta("dev:1", g("ether3"), "locale", undefined).chiave, "n:ether3");
  assert.equal(chiavePorta("host:7", g("eth0"), "remoto", undefined, null, new Set(["eth0"])).chiave, "n:eth0");
  const due = chiavePorta("host:7", g("eth0"), "remoto", undefined, null, new Set(["eth0", "f4e2"]));
  assert.deepEqual([due.chiave, due.certa], [null, false]);
});

test("l'indice dato dal lettore vince (nel modello di T1: l'indice della porta di uplink in switch_ports)", () => {
  assert.equal(chiavePorta("dev:2", g("qualunque"), "locale", ACCESSO, 47).chiave, "i:47");
});

test("stessaPorta: due chiavi uguali; una porta non nota non è uguale a niente", () => {
  assert.equal(stessaPorta({ chiave: "i:10" }, { chiave: "i:10" }), true);
  assert.equal(stessaPorta({ chiave: "i:10" }, { chiave: "i:9" }), false);
  assert.equal(stessaPorta({ chiave: null }, { chiave: null }), false);
});

test("elenchi per apparato e indice di una porta per nome (per la velocità)", () => {
  const e = elenchiPorte([{ device_id: 2, port_index: 49, port_name: "SFP+ 1" }, { device_id: 3, port_index: 1, port_name: "Port 1" }]);
  assert.deepEqual([...e.keys()], ["dev:2", "dev:3"]);
  assert.equal(portaInElenco(e.get("dev:2")!, "SFP+ 1"), 49);
  assert.equal(portaInElenco(e.get("dev:3")!, "Port 1"), 1);
  assert.equal(portaInElenco(e.get("dev:3")!, "eth0"), null);
});

// I70 (spec §13.6.1, «Un nome doppio con una velocità sola»): un nome che corrisponde a più porte non dice la porta (I14),
// ma le porte che lo portano sì: la velocità per chiave (Task 7) le guarda tutte. Rete B: il cavo dati di un hypervisor sta
// su un nome di due porte a 10G.
test("indiciInElenco: tutti gli indici di un nome (passi 2-4 di chiavePorta, senza scegliere)", () => {
  const AGG = elencoDa([{ port_index: 15, port_name: "SFP+ 15" }, { port_index: 16, port_name: "SFP+ 15" }, { port_index: 17, port_name: "SFP+ 17" }]);
  assert.deepEqual(indiciInElenco(AGG, "SFP+ 15"), [15, 16]);
  assert.deepEqual(indiciInElenco(AGG, "sfp+17"), [17]);
  assert.deepEqual(indiciInElenco(AGG, "Port 17"), [17]);
  assert.deepEqual(indiciInElenco(AGG, "eth0"), []);
  assert.deepEqual(indiciInElenco(AGG, " "), []);
  assert.equal(portaInElenco(AGG, "SFP+ 15"), null, "la porta resta non nota");
});
