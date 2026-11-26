// Piano del 26/11/2026 (docs/superpowers/plans/2026-11-26-ipam-precompilato.md): sull'appliance la build di IPAM
// arriva già pronta, ma solo con un tag `build-<commit>` firmato da chi può rilasciare e lo sha256 giusto. Ogni altro
// caso deve rispondere 1, così update.sh compila come prima. Si prova la funzione da sola su repo git veri, una chiave
// fatta qui e pacchetti serviti da file:// (curl li legge come un indirizzo).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RADICE = realpathSync(mkdtempSync(join(tmpdir(), "build-firmata-")));
after(() => rmSync(RADICE, { recursive: true, force: true }));
const SCRIPT = join(process.cwd(), "scripts", "lib", "build-firmata.sh");

const chiave = (nome: string): string => {
  const f = join(RADICE, nome);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", nome, "-f", f]);
  return f;
};
const BUONA = chiave("rilasci");
const ESTRANEA = chiave("estraneo");
const FIRMATARI = join(RADICE, "firmatari");
writeFileSync(FIRMATARI, `rilasci@example.invalid namespaces="git" ${readFileSync(`${BUONA}.pub`, "utf8")}`);

const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=prova", "-c", "user.email=prova@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...a], { stdio: "pipe" }).toString().trim();

const ORIGIN = join(RADICE, "origin");
const APP = join(RADICE, "app");
const RILASCI = join(RADICE, "release");
execFileSync("git", ["init", "-q", "-b", "main", ORIGIN]);
writeFileSync(join(ORIGIN, "a.txt"), "uno\n");
git(ORIGIN, "add", ".");
git(ORIGIN, "commit", "-q", "-m", "primo");
execFileSync("git", ["clone", "-q", ORIGIN, APP]);

let n = 1;
/** Un commit nuovo su main di origin, con i due pacchetti; `firma` firma il tag (null = nessun tag). */
function rilascio(firma: string | null, opzioni: { shaFalso?: boolean; puntaA?: string } = {}): string {
  writeFileSync(join(ORIGIN, "a.txt"), `giro ${++n}\n`);
  git(ORIGIN, "add", "a.txt");
  git(ORIGIN, "commit", "-q", "-m", `giro ${n}`);
  const commit = git(ORIGIN, "rev-parse", "HEAD");
  const tag = `build-${commit}`;
  const cartella = join(RILASCI, `pacchetto-${commit}`);
  mkdirSync(cartella, { recursive: true });
  const righe: string[] = [];
  for (const c of [".next-a", ".next-b"]) {
    const lavoro = join(RADICE, `pacco-${n}`);
    mkdirSync(join(lavoro, c), { recursive: true });
    writeFileSync(join(lavoro, c, "BUILD_ID"), `id-${n}${c}\n`);
    const file = `ipam-build-${c.slice(1)}.tar.gz`;
    execFileSync("tar", ["-czf", join(cartella, file), "-C", lavoro, c]);
    const sha = opzioni.shaFalso ? "0".repeat(64) : execFileSync("sha256sum", [join(cartella, file)]).toString().split(" ")[0];
    righe.push(`sha256 ${sha} ${file}`);
  }
  if (firma) {
    git(ORIGIN, "-c", "gpg.format=ssh", "-c", `user.signingkey=${firma}.pub`, "tag", "-s", "-f", tag, "-m", `build appliance ${commit}\n\n${righe.join("\n")}`, opzioni.puntaA ?? commit);
  }
  git(APP, "fetch", "-q", "origin", "main");
  return commit;
}

function prova(commit: string, ambiente: Record<string, string> = {}, ramo = "main", cartella = ".next-b") {
  rmSync(join(APP, cartella), { recursive: true, force: true });
  const r = spawnSync("bash", ["-c", `source "${SCRIPT}" && build_firmata "$@"`, "prova", ramo, commit, cartella, FIRMATARI], {
    cwd: APP,
    encoding: "utf8",
    env: { ...process.env, DA_INVENT_BUILD_PERCORSO: APP, DA_INVENT_BUILD_URL: `file://${RILASCI}`, DA_INVENT_BUILD_FIRMATA: "", DA_INVENT_BUILD_RAMI: "", ...ambiente },
  });
  return { codice: r.status ?? -1, uscita: `${r.stdout}${r.stderr}`, buildId: existsSync(join(APP, cartella, "BUILD_ID")) };
}

test("tag firmato da chi può rilasciare e sha256 giusto: la cartella arriva scompattata", () => {
  const c = rilascio(BUONA);
  const r = prova(c);
  assert.equal(r.codice, 0, r.uscita);
  assert.match(r.uscita, /build-firmata: usata la build pronta/);
  assert.equal(readFileSync(join(APP, ".next-b", "BUILD_ID"), "utf8"), `id-${n}.next-b\n`);
  assert.equal(existsSync(join(APP, ".next-b.scarico")), false);
});

test("nessun tag per il commit: si compila", () => {
  const r = prova(rilascio(null));
  assert.deepEqual([r.codice, r.buildId], [1, false]);
  assert.match(r.uscita, /nessun tag/);
});

test("tag firmato da una chiave estranea: si compila", () => {
  const r = prova(rilascio(ESTRANEA));
  assert.deepEqual([r.codice, r.buildId], [1, false]);
  assert.match(r.uscita, /firma valida/);
});

test("sha256 nel tag diverso dal pacchetto: si compila e non resta niente", () => {
  const r = prova(rilascio(BUONA, { shaFalso: true }));
  assert.deepEqual([r.codice, r.buildId], [1, false]);
  assert.match(r.uscita, /sha256/);
  assert.equal(existsSync(join(APP, ".next-b.scarico")), false);
});

test("tag col nome del commit ma che punta a un altro commit: si compila", () => {
  const vecchio = git(ORIGIN, "rev-parse", "HEAD");
  const r = prova(rilascio(BUONA, { puntaA: vecchio }));
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /non punta/);
});

test("pacchetto assente dalla release: si compila", () => {
  const c = rilascio(BUONA);
  rmSync(join(RILASCI, `pacchetto-${c}`, "ipam-build-next-b.tar.gz"));
  const r = prova(c);
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /scaricamento/);
});

test("ramo dev, percorso diverso, cartella strana o spenta: si compila senza scaricare", () => {
  const c = rilascio(BUONA);
  assert.match(prova(c, {}, "dev").uscita, /ramo dev/);
  assert.match(prova(c, { DA_INVENT_BUILD_PERCORSO: "/opt/da-ipam" }).uscita, /fatta per \/opt\/da-ipam/);
  assert.match(prova(c, {}, "main", ".next").uscita, /non prevista/);
  assert.match(prova(c, { DA_INVENT_BUILD_FIRMATA: "spenta" }).uscita, /spenta/);
  assert.equal(prova(c, { DA_INVENT_BUILD_RAMI: "main dev" }, "dev").codice, 0);
});
