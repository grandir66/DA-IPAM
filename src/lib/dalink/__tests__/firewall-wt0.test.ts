/**
 * Tappa C1, Task 4: il firewall dell'interfaccia NetBird (`wt0`).
 *
 * Spec NetBird §12 «DA-IPAM» e rischio 10: su `wt0` solo 22 e 443, più 6443 se
 * l'istanza contiene l'edge. R5: nessuna porta Wazuh, mai. Decisione 22: il firewall
 * locale accetta solo i centrali (e `admins`) quando le sorgenti sono dichiarate.
 *
 * Qui si prova il ruleset che lo script genera (`--stampa`, la prova a vuoto
 * predefinita). Il comportamento vero sui pacchetti si prova su Linux con
 * `scripts/dalink/prova-firewall-netns.sh`, in spazi di rete usa e getta.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(process.cwd(), "scripts/dalink/firewall-wt0.sh");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dalink-fw-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const WAZUH = [1514, 1515, 55000, 9200, 5601];

function lancia(conf: string | null, args: string[] = [], envExtra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH ?? "/usr/bin:/bin", ...envExtra };
  if (conf !== null) {
    const p = path.join(DIR, `fw-${Math.random().toString(36).slice(2)}.env`);
    fs.writeFileSync(p, conf);
    env.DALINK_FW_CONF = p;
  } else {
    env.DALINK_FW_CONF = path.join(DIR, "non-esiste.env");
  }
  const r = spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" });
  return { codice: r.status, out: r.stdout, err: r.stderr };
}

/** Le porte accettate su wt0 nel ruleset stampato. */
function porteAccettate(ruleset: string): number[] {
  const porte: number[] = [];
  for (const riga of ruleset.split("\n")) {
    if (!/\baccept\b/.test(riga)) continue;
    const m = /tcp dport (?:\{([^}]*)\}|(\d+))/.exec(riga);
    if (!m) continue;
    const elenco = (m[1] ?? m[2]).split(",").map((x) => Number(x.trim()));
    porte.push(...elenco);
  }
  return porte.sort((a, b) => a - b);
}

test("senza edge: solo 22 e 443", () => {
  const r = lancia("DALINK_FW_EDGE=no\n");
  assert.equal(r.codice, 0, r.err);
  assert.deepEqual(porteAccettate(r.out), [22, 443]);
});

test("con l'edge: anche 6443", () => {
  const r = lancia("DALINK_FW_EDGE=si\n");
  assert.equal(r.codice, 0, r.err);
  assert.deepEqual(porteAccettate(r.out), [22, 443, 6443]);
});

test("nessuna porta Wazuh, nemmeno provando a passarla da file o ambiente", () => {
  const conf = "DALINK_FW_EDGE=si\nDALINK_FW_PORTE=1514 1515 55000\nPORTE=9200\n";
  const r = lancia(conf, ["--stampa"], { PORTE: "1514 55000", DALINK_FW_PORTE: "9200", PORTE_EDGE: "1515" });
  assert.equal(r.codice, 0, r.err);
  const porte = porteAccettate(r.out);
  for (const w of WAZUH) assert.ok(!porte.includes(w), `porta Wazuh ${w} aperta su wt0`);
  assert.deepEqual(porte, [22, 443, 6443]);
});

test("la catena lascia passare ciò che non viene da wt0 e scarta il resto di wt0", () => {
  const r = lancia("DALINK_FW_EDGE=no\n");
  assert.match(r.out, /table inet dalink/);
  assert.match(r.out, /iifname != "wt0" accept/);
  assert.match(r.out, /ct state established,related accept/);
  const righe = r.out.split("\n").map((x) => x.trim()).filter(Boolean);
  const ultimaRegola = righe.filter((x) => !/^[{}]$|^}|^table|^chain|^type|^delete/.test(x)).pop() ?? "";
  assert.match(ultimaRegola, /\bdrop\b/, "l'ultima regola della catena deve scartare");
  // Ricarica atomica: la tabella si crea, si cancella e si ricrea nello stesso file.
  assert.match(r.out, /^table inet dalink\s*$/m);
  assert.match(r.out, /^delete table inet dalink\s*$/m);
});

test("sorgenti dichiarate: ogni porta accetta solo da quelle", () => {
  const r = lancia("DALINK_FW_EDGE=si\nDALINK_FW_SORGENTI=100.101.2.3, 100.120.0.0/16\n");
  assert.equal(r.codice, 0, r.err);
  const accetti = r.out.split("\n").filter((x) => /tcp dport/.test(x) && /accept/.test(x));
  assert.ok(accetti.length > 0);
  for (const riga of accetti) assert.match(riga, /ip saddr \{ 100\.101\.2\.3, 100\.120\.0\.0\/16 \}/);
});

test("sorgente fuori dalla rete NetBird: si ferma e non stampa nessun ruleset", () => {
  for (const s of ["192.0.2.10", "100.63.0.1", "100.128.0.1", "100.64.0.0/8", "100.64.0.300", "pippo"]) {
    const r = lancia(`DALINK_FW_EDGE=no\nDALINK_FW_SORGENTI=${s}\n`);
    assert.notEqual(r.codice, 0, `accettata la sorgente ${s}`);
    assert.doesNotMatch(r.out, /table inet dalink/, `ruleset stampato con la sorgente ${s}`);
  }
});

test("senza DALINK_FW_EDGE, o col file assente, si ferma", () => {
  assert.notEqual(lancia("DALINK_FW_SORGENTI=100.101.2.3\n").codice, 0);
  assert.notEqual(lancia("DALINK_FW_EDGE=forse\n").codice, 0);
  assert.notEqual(lancia(null).codice, 0);
});

test("il file di configurazione non si esegue (niente source)", () => {
  const segno = path.join(DIR, "eseguito");
  const r = lancia(`DALINK_FW_EDGE=no\n$(touch ${segno})\nDALINK_FW_SORGENTI=$(touch ${segno})\n`);
  assert.ok(!fs.existsSync(segno), "il file di configurazione è stato eseguito");
  assert.notEqual(r.codice, 0, "una sorgente con $(…) va rifiutata");
});

test("un'opzione sconosciuta si rifiuta", () => {
  assert.notEqual(lancia("DALINK_FW_EDGE=no\n", ["--apri-tutto"]).codice, 0);
});
