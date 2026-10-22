// Incidente del 22/10 (70151): l'installatore aveva messo il commit di `dev` (v0.9.813) chiamando «main» il ramo locale;
// il primo giro di `da-ipam-update` puntava a `origin/main`, fermo a v0.3.322, e stava RETROCEDENDO l'appliance (l'ha
// salvata una compilazione fallita). La guardia confronta le versioni prima del checkout e rifiuta di tornare indietro.
// Si prova la guardia da sola (scripts/lib/guardia-versione.sh), su repo git veri in una cartella temporanea: lo script
// intero vuole flock e systemctl.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RADICE = mkdtempSync(join(tmpdir(), "retrocessione-"));
after(() => rmSync(RADICE, { recursive: true, force: true }));
const GUARDIA = join(process.cwd(), "scripts", "lib", "guardia-versione.sh");

const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=prova", "-c", "user.email=prova@example.invalid", ...a], { stdio: "pipe" }).toString();

function versione(dir: string, v: string, msg: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "da-ipam", version: v }, null, 2) + "\n");
  git(dir, "add", "package.json");
  git(dir, "commit", "-q", "-m", msg);
}

// «origin» con main a 0.3.0 e dev a 0.9.0; il clone dell'appliance su dev (0.9.0).
const ORIGIN = join(RADICE, "origin");
const CLONE = join(RADICE, "appliance");
execFileSync("git", ["init", "-q", "-b", "main", ORIGIN]);
versione(ORIGIN, "0.3.0", "main vecchio");
git(ORIGIN, "checkout", "-q", "-b", "dev");
versione(ORIGIN, "0.9.0", "dev avanti");
execFileSync("git", ["clone", "-q", "-b", "dev", ORIGIN, CLONE]);
git(CLONE, "fetch", "-q", "origin", "main");

function guardia(ramo: string): { codice: number; uscita: string } {
  const r = spawnSync("bash", ["-c", `source "${GUARDIA}" && guardia_versione "$1"`, "prova", ramo], { cwd: CLONE, encoding: "utf8" });
  return { codice: r.status ?? -1, uscita: `${r.stdout}${r.stderr}` };
}

test("origin/main più vecchio dell'installata: rifiuta, dice le due versioni e cosa fare", () => {
  const r = guardia("main");
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /ERRORE: retrocessione rifiutata: installata v0\.9\.0, origin\/main v0\.3\.0 — scegli il canale giusto da Opzioni o allinea main/);
});

test("stesso ramo, stessa versione o più nuova: passa", () => {
  assert.equal(guardia("dev").codice, 0);
  git(ORIGIN, "checkout", "-q", "main");
  versione(ORIGIN, "0.9.1", "main promosso");
  git(CLONE, "fetch", "-q", "origin", "main");
  assert.equal(guardia("main").codice, 0, "0.9.1 > 0.9.0");
});

test("confronto numerico, non alfabetico: 0.10.0 è più nuova di 0.9.873", () => {
  const r = spawnSync("bash", ["-c", `source "${GUARDIA}"; confronta_versioni 0.10.0 0.9.873; confronta_versioni 0.9.873 0.9.873; confronta_versioni 0.3.322 0.9.813`], { encoding: "utf8" });
  assert.deepEqual(r.stdout.trim().split("\n"), ["1", "0", "-1"]);
});

test("versione illeggibile sul ramo: non si procede (mai un checkout al buio)", () => {
  const r = guardia("ramo-che-non-esiste");
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /ERRORE: versione di origin\/ramo-che-non-esiste illeggibile/);
});

test("auto-update.sh chiama la guardia dopo il fetch e prima del checkout del ramo", () => {
  const src = readFileSync(join(process.cwd(), "scripts", "auto-update.sh"), "utf8");
  const fetch = src.indexOf('git fetch --quiet origin "$BRANCH"');
  const g = src.indexOf('guardia_versione "$BRANCH"');
  const checkout = src.indexOf('git checkout -B "$BRANCH"');
  assert.ok(fetch > 0 && g > fetch && checkout > g, "ordine: fetch → guardia → checkout");
  assert.match(src, /retrocessione_rifiutata/);
});
