/**
 * Prova I37 (spec topologia §13.12.3; vincolo 4 di Riccardo, 14/10: la logica dei collegamenti vale «a prescindere dal
 * prodotto»). In src/lib/topology/cavi/ non c'è nessun nome di prodotto né forma di porta di un prodotto: stanno solo nei
 * traduttori (src/lib/topology/lettori/). Un elenco di parole ed espressioni in TypeScript, non un comando grep copiato
 * da una tabella (dove la barra verticale dell'espressione diventerebbe un carattere da cercare).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(__dirname, "..", "cavi");
const PAROLE = ["mikrotik", "routeros", "unifi", "ubiquiti", "cisco", "aruba", "proxmox", "mndp"];
// Una forma di porta può stare anche dentro un'espressione regolare, con la barra rovesciata («ether\d», «bridge\/»):
// la cifra o la barra possono essere scritte con l'escape (revisione del piano, 15/10: prima l'autoprova qui sotto era rossa).
// Revisione finale di T3 (M1): anche i nomi di porta di uno switch a pile («1/1/49»), di Linux («eth0», «bond3») e il
// programma LLDP di Linux stavano nei commenti di cavi/: nemmeno lì, le parole neutre bastano.
const FORME: RegExp[] = [/\bhp\b/i, /ether(?:\d|\\d)/i, /sfp-sfpplus/i, /sfpplus/i, /sfp28/i, /SFP_/, /,bridge/i, /bridge\\?\//i, /wlan/i, /eoip/i, /["'`][^"'`\n]*\blocal\s/i,
  /\b\d{1,2}\/\d{1,2}\/\d{1,3}\b/, /\beth\d/i, /\bbond\d/i, /lldpd/i];

function formeDiProdotto(testo: string): string[] {
  const out: string[] = [];
  testo.split("\n").forEach((riga, i) => {
    const r = riga.toLowerCase();
    for (const p of PAROLE) if (r.includes(p)) out.push(`riga ${i + 1}: «${p}»`);
    for (const re of FORME) if (re.test(riga)) out.push(`riga ${i + 1}: ${re.source}`);
  });
  return out;
}

test("la prova trova davvero le forme di un prodotto", () => {
  assert.equal(formeDiProdotto('const P = /^ether\\d+$/;').length > 0, true);
  assert.equal(formeDiProdotto("const B = /^bridge\\/ether/;").length > 0, true);
  assert.equal(formeDiProdotto("// lettura del router mndp").length > 0, true);
  assert.equal(formeDiProdotto('const l = "local Port 7";').length > 0, true);
  assert.deepEqual(formeDiProdotto('lato === "locale" ? "porta" : "remota"'), []);
  for (const t of ["// la porta «1/1/49» di uno switch", "// «eth0» da una parte", "// la porta `bond3`", "// con `lldpd` sull'host"]) {
    assert.equal(formeDiProdotto(t).length > 0, true, t);
  }
  assert.deepEqual(formeDiProdotto("// il fascio «bond» e la porta di un host, letta il 16/10"), []);
});

test("I37: nessun nome di prodotto né forma di porta di un prodotto in src/lib/topology/cavi/", () => {
  const file = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(file.length > 0, "la cartella cavi/ c'è");
  const trovate = file.flatMap((f) => formeDiProdotto(fs.readFileSync(path.join(DIR, f), "utf8")).map((x) => `${f} ${x}`));
  assert.deepEqual(trovate, []);
});

/**
 * I58 (spec §13.12.3; vincolo 9): nessuna regola conosce un nome scelto da un cliente. I prefissi dei nomi scelti visti sulle
 * reti misurate (le VLAN e il bridge della rete B) non stanno né nella logica né nei traduttori, nemmeno nei commenti: chi ha
 * fretta di riconoscerli riapre il problema della rete B (H7).
 */
const SCELTI_VISTI: RegExp[] = [/\bvl_/i, /\bbr_/i];
const LETTORI = path.join(__dirname, "..", "lettori");

function nomiScelti(testo: string): string[] {
  return testo.split("\n").flatMap((riga, i) => SCELTI_VISTI.filter((re) => re.test(riga)).map((re) => `riga ${i + 1}: ${re.source}`));
}

test("la prova dei nomi scelti trova davvero i prefissi", () => {
  assert.equal(nomiScelti("// un nome come «VL_…»").length, 1);
  assert.equal(nomiScelti('const B = /^br_/i;').length, 1);
  assert.deepEqual(nomiScelti("const vlan = /^vlan\\d+$/;"), []);
});

test("I58 — nessun prefisso di un nome scelto da un cliente in cavi/ e lettori/", () => {
  const trovate = [DIR, LETTORI].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".ts"))
    .flatMap((f) => nomiScelti(fs.readFileSync(path.join(d, f), "utf8")).map((x) => `${path.basename(d)}/${f} ${x}`)));
  assert.deepEqual(trovate, []);
});

/**
 * I37 anche per la logica dei collegamenti di T1 (spec §13.5.1: «links.ts in T1, cavi/ da T2, legge solo quei fatti»).
 * Verifica del 15/10: links.ts sceglieva il traduttore del lato remoto con un'espressione sulla marca, copia di quella di
 * traduci.ts. Nel CODICE di links.ts (i commenti possono dire da dove vengono i fatti) nessun nome di prodotto né forma di
 * porta; restano i valori delle colonne del DB che il modello legge così come sono scritti: la fonte «unifi», la fonte del
 * collegamento «unifi_uplink» e il protocollo «mndp».
 */
const LINKS = path.join(__dirname, "..", "links.ts");
const VALORI_DEL_DB = /["'`](?:mndp|unifi|unifi_uplink)["'`]/g;
function codiceDi(testo: string): string {
  return testo.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, "")).replace(/(^|[^:\\])\/\/.*$/gm, "$1").replace(VALORI_DEL_DB, '""');
}

test("la prova di links.ts lascia i commenti e i valori del DB, e trova una marca nel codice", () => {
  assert.deepEqual(formeDiProdotto(codiceDi('// un MikroTik letto via SSH\nconst f = "unifi";\nconst p = n.protocol === "mndp";')), []);
  assert.equal(formeDiProdotto(codiceDi("const m = /mikrotik/i.test(c.piattaforma);")).length > 0, true);
  assert.equal(formeDiProdotto(codiceDi('const b = porta.endsWith(",bridge");')).length > 0, true);
});

test("I37 — nel codice di links.ts nessun nome di prodotto né forma di porta", () => {
  assert.deepEqual(formeDiProdotto(codiceDi(fs.readFileSync(LINKS, "utf8"))), []);
});
