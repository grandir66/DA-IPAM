/**
 * L'esecutore del filtro degli accessi (`scripts/accessi/da-ipam-accessi.sh`) e la politica che DA-IPAM gli scrive.
 * Qui si prova il ruleset generato (la prova a vuoto, `anteprima`) e che lo script rifiuti ciò che non è un
 * indirizzo. Il comportamento sui pacchetti si prova su Linux, in spazi di rete usa e getta.
 *
 * Incidenti da cui nascono le prove (25/11/2026, visti fallire): `nft -c` ha rifiutato la catena delle «altre
 * porte» che usava un set mai dichiarato; un messaggio d'errore con `$s»` moriva per «variabile non assegnata»
 * (bash legge il byte di «»» nel nome): il valore veniva rifiutato lo stesso, ma per caso.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GRUPPI, PORTE_GRUPPO, POLITICA_VUOTA, erroriPolitica, leggiPolitica, scriviPolitica, tipoIndirizzo, type Politica } from "../politica";

const SCRIPT = path.join(process.cwd(), "scripts/accessi/da-ipam-accessi.sh");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daipam-accessi-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function lancia(conf: string | null, args: string[] = ["anteprima"]) {
  const p = path.join(DIR, `c-${Math.random().toString(36).slice(2)}.conf`);
  if (conf !== null) fs.writeFileSync(p, conf);
  const r = spawnSync("bash", [SCRIPT, ...args], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "/usr/bin:/bin", DAIPAM_ACCESSI_CONF: p }, encoding: "utf8" });
  return { codice: r.status, out: r.stdout, err: r.stderr };
}

const POLITICA: Politica = {
  sempre: ["198.51.100.0/27"],
  gruppi: {
    web: { aperto: false, indirizzi: ["192.0.2.0/24", "2001:db8:12::/64"] },
    ssh: { aperto: false, indirizzi: [] },
    console: { aperto: false, indirizzi: ["192.0.2.10"] },
    dati: { aperto: true, indirizzi: [] },
  },
};

function catena(ruleset: string, nome: string): string {
  const m = new RegExp(`\\tchain ${nome} \\{\\n([\\s\\S]*?)\\n\\t\\}`).exec(ruleset);
  assert.ok(m, `catena ${nome} assente`);
  return m[1];
}

test("il file scritto da DA-IPAM si rilegge uguale e lo script lo accetta", () => {
  const testo = scriviPolitica(POLITICA);
  assert.deepEqual(leggiPolitica(testo), POLITICA);
  const r = lancia(testo);
  assert.equal(r.codice, 0, r.err);
  assert.match(r.out, /set web4 \{[^}]*elements = \{ 192\.0\.2\.0\/24 \}/);
  assert.match(r.out, /set web6 \{[^}]*elements = \{ 2001:db8:12::\/64 \}/);
  assert.match(r.out, /set sempre4 \{[^}]*elements = \{ 198\.51\.100\.0\/27 \}/);
});

test("ogni set usato in una regola è dichiarato (la catena delle altre porte non ha un elenco)", () => {
  for (const args of [["anteprima"], ["anteprima", "osserva"], ["minima"]]) {
    const { out, codice } = lancia(scriviPolitica(POLITICA), args);
    assert.equal(codice, 0);
    const dichiarati = new Set([...out.matchAll(/\tset (\w+) \{/g)].map((m) => m[1]));
    for (const m of out.matchAll(/@(\w+)/g)) assert.ok(dichiarati.has(m[1]), `${args.join(" ")}: set ${m[1]} usato ma non dichiarato`);
    assert.doesNotMatch(catena(out, "g_altre"), /@altre/);
  }
});

test("la catena sta sul prerouting prima del DNAT di Docker e prima di inet dalink, e non tocca ciò che non è per la macchina", () => {
  const { out } = lancia(scriviPolitica(POLITICA));
  const c = catena(out, "ingresso");
  assert.match(c, /type filter hook prerouting priority mangle \+ 5; policy accept;/);
  const righe = c.split("\n").map((x) => x.trim());
  const prima = (a: string, b: string) => assert.ok(righe.findIndex((x) => x.startsWith(a)) < righe.findIndex((x) => x.startsWith(b)) && righe.some((x) => x.startsWith(a)), `«${a}» deve stare prima di «${b}»`);
  // I salvagente stanno PRIMA di ogni gruppo: NetBird, Docker, le connessioni aperte, i sempre ammessi.
  for (const salva of ['iifname "lo"', 'iifname "wt0"', 'iifname "docker*"', 'iifname "br-*"', "fib daddr type != local accept", "ct state established,related accept", "ip saddr @sempre4 accept", "ip6 saddr @sempre6 accept"]) prima(salva, "tcp dport { 80, 443 } jump g_web");
  assert.doesNotMatch(out, /notrack|hook (input|forward|output)/);
});

test("acceso scarta chi è fuori dall'elenco; osserva non scarta mai niente; minima lascia solo i sempre ammessi", () => {
  const acceso = lancia(scriviPolitica(POLITICA)).out;
  assert.match(catena(acceso, "g_web"), /ip saddr @web4 accept[\s\S]*update @fuori4[\s\S]*counter drop$/);
  assert.match(catena(acceso, "g_dati"), /^\s*counter accept comment "aperto a tutti"$/);
  assert.match(catena(acceso, "g_altre"), /counter drop$/);
  const osserva = lancia(scriviPolitica(POLITICA), ["anteprima", "osserva"]).out;
  assert.doesNotMatch(osserva, /\bdrop\b|\breject\b/);
  assert.match(osserva, /modo=osserva/);
  assert.match(catena(osserva, "g_web"), /update @fuori4/);
  const minima = lancia(scriviPolitica(POLITICA), ["minima"]).out;
  assert.match(minima, /set sempre4 \{[^}]*elements = \{ 198\.51\.100\.0\/27 \}/);
  assert.doesNotMatch(minima, /set web4 \{[^}]*elements/);
  assert.match(catena(minima, "g_dati"), /counter drop$/);
});

test("senza file di politica il filtro è chiuso a tutti tranne NetBird: chiuso di serie", () => {
  const r = lancia(null);
  assert.equal(r.codice, 0);
  assert.doesNotMatch(r.out, /elements =/);
  for (const g of ["g_web", "g_ssh", "g_console", "g_dati", "g_altre"]) assert.match(catena(r.out, g), /counter drop$/);
});

test("le porte dei gruppi sono le stesse nello script e nell'app, e le porte interne non stanno in nessun gruppo", () => {
  const { out } = lancia(scriviPolitica(POLITICA_VUOTA));
  const porte = (proto: string, gruppo: string): number[] => [...out.matchAll(new RegExp(`${proto} dport \\{ ([0-9, ]+) \\} jump g_${gruppo}`, "g"))].flatMap((m) => m[1].split(",").map((x) => Number(x.trim())));
  for (const g of GRUPPI) {
    assert.deepEqual(porte("tcp", g), [...PORTE_GRUPPO[g].tcp], `tcp ${g}`);
    assert.deepEqual(porte("udp", g), [...PORTE_GRUPPO[g].udp], `udp ${g}`);
  }
  assert.doesNotMatch(out, /dport \{[^}]*\b(3001|8080)\b/);
});

test("ciò che non è un indirizzo si rifiuta, con un messaggio che lo nomina; script e app decidono uguale", () => {
  const casi: Array<[string, boolean]> = [
    ["192.0.2.1", true], ["192.0.2.0/24", true], ["10.0.0.0/8", true], ["2001:db8::1", true], ["2001:db8:12::/64", true],
    ["0.0.0.0/0", false], ["10.0.0.0/7", false], ["::/0", false], ["300.1.1.1", false], ["1.2.3", false], ["1.2.3.4/33", false],
    ["$(id)", false], ["1.2.3.4;reboot", false], ["192.0.2.1}", false], ["esempio.it", false], ["2001:db8:::1", false],
  ];
  for (const [voce, buono] of casi) {
    assert.equal(tipoIndirizzo(voce) !== null, buono, `app: ${voce}`);
    const r = lancia(`ACCESSI_WEB=${voce}\n`);
    assert.equal(r.codice === 0, buono, `script: ${voce} → ${r.err}`);
    if (!buono) assert.match(r.err, /da-ipam-accessi: ACCESSI_WEB: «.*» non è un indirizzo né una rete ammessa/, voce);
  }
  assert.match(lancia("ACCESSI_SEMPRE=tutti\n").err, /ACCESSI_SEMPRE non può valere «tutti»/);
  assert.deepEqual(erroriPolitica({ ...POLITICA_VUOTA, sempre: ["0.0.0.0/0", "192.0.2.1", "192.0.2.1"] }).length, 2);
  assert.throws(() => scriviPolitica({ ...POLITICA_VUOTA, sempre: ["tutti"] }), /non valida/);
});

test("i comandi che scrivono non partono senza root, e la prova vuole una durata fra 30 e 600 secondi", () => {
  if (process.getuid?.() === 0) return;
  for (const c of [["osserva"], ["prova", "120"], ["conferma"], ["annulla"], ["spegni"], ["avvio"]]) {
    const r = lancia(scriviPolitica(POLITICA), c);
    assert.equal(r.codice, 1, c.join(" "));
    assert.match(r.err, /vuole root/);
  }
  assert.equal(lancia("", ["boh"]).codice, 1);
});
