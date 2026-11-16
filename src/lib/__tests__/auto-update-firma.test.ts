// Analisi del 15/11/2026: ogni appliance scarica `main` e lo esegue da root; senza firma, chi scrive su `main` comanda
// tutte le appliance. La guardia controlla la firma SSH del commit in punta contro i firmatari della copia installata.
// Si prova la guardia da sola (scripts/lib/guardia-firma.sh) su repo git veri e una chiave fatta qui, senza passphrase:
// lo script intero vuole flock e systemctl.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RADICE = mkdtempSync(join(tmpdir(), "firma-rilasci-"));
after(() => rmSync(RADICE, { recursive: true, force: true }));
const GUARDIA = join(process.cwd(), "scripts", "lib", "guardia-firma.sh");

// Due chiavi: quella di chi può rilasciare e quella di un estraneo.
const chiave = (nome: string): string => {
  const f = join(RADICE, nome);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", nome, "-f", f]);
  return f;
};
const BUONA = chiave("rilasci");
const ESTRANEA = chiave("estraneo");

const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=prova", "-c", "user.email=prova@example.invalid", "-c", "commit.gpgsign=false", ...a], { stdio: "pipe" }).toString();

const ORIGIN = join(RADICE, "origin");
const CLONE = join(RADICE, "appliance");
execFileSync("git", ["init", "-q", "-b", "main", ORIGIN]);
mkdirSync(join(ORIGIN, "deploy"));
writeFileSync(join(ORIGIN, "deploy", "firmatari-rilasci"), `# firmatari\nrilasci@example.invalid namespaces="git" ${readFileSync(`${BUONA}.pub`, "utf8")}`);
writeFileSync(join(ORIGIN, "a.txt"), "uno\n");
git(ORIGIN, "add", ".");
git(ORIGIN, "commit", "-q", "-m", "primo, non firmato");
execFileSync("git", ["clone", "-q", ORIGIN, CLONE]);

let n = 1;
/** Un commit nuovo su un ramo di origin, firmato con la chiave data (o non firmato), poi il fetch dell'appliance. */
function commit(ramo: string, firmaCon: string | null): void {
  git(ORIGIN, "checkout", "-q", "-B", ramo);
  writeFileSync(join(ORIGIN, "a.txt"), `giro ${++n}\n`);
  git(ORIGIN, "add", "a.txt");
  const firma = firmaCon ? ["-c", "gpg.format=ssh", "-c", `user.signingkey=${firmaCon}.pub`, "commit", "-q", "-S", "-m", `giro ${n}`] : ["commit", "-q", "-m", `giro ${n}`];
  git(ORIGIN, ...firma);
  git(CLONE, "fetch", "-q", "origin", ramo);
}

const ESITO = join(RADICE, "esito.json");
function guardia(ramo: string, ambiente: Record<string, string> = {}): { codice: number; uscita: string } {
  const r = spawnSync("bash", ["-c", `source "${GUARDIA}" && guardia_firma "$1"`, "prova", ramo], {
    cwd: CLONE,
    encoding: "utf8",
    env: { ...process.env, DA_INVENT_FIRMA_ESITO: ESITO, DA_INVENT_FIRMA_RILASCI: "", DA_INVENT_FIRMA_RAMI: "", ...ambiente },
  });
  return { codice: r.status ?? -1, uscita: `${r.stdout}${r.stderr}` };
}
// Variabili vuote = di serie: la guardia usa `${VAR:-…}`.
const esito = () => JSON.parse(readFileSync(ESITO, "utf8")) as { esito: string; modo: string; ramo: string };

test("commit non firmato su main, modo di serie: fermo (dal 16/11 di serie è «blocca», ADR 0040)", () => {
  commit("main", null);
  const r = guardia("main");
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /firma: ERRORE: origin\/main .* aggiornamento fermo/);
  assert.deepEqual([esito().esito, esito().modo, esito().ramo], ["rifiutata", "blocca", "main"]);
});

test("commit non firmato su main, modo avvisa scritto nel file: si procede, ma lo dice e lo scrive", () => {
  const r = guardia("main", { DA_INVENT_FIRMA_RILASCI: "avvisa" });
  assert.equal(r.codice, 0);
  assert.match(r.uscita, /firma: AVVISO: origin\/main .* non ha una firma valida/);
  assert.deepEqual([esito().esito, esito().modo, esito().ramo], ["mancante", "avvisa", "main"]);
});

test("commit non firmato su main, modo blocca: fermo", () => {
  const r = guardia("main", { DA_INVENT_FIRMA_RILASCI: "blocca" });
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /firma: ERRORE: .* aggiornamento fermo/);
  assert.equal(esito().esito, "rifiutata");
});

test("commit firmato da chi può rilasciare: passa anche in modo blocca", () => {
  commit("main", BUONA);
  const r = guardia("main", { DA_INVENT_FIRMA_RILASCI: "blocca" });
  assert.equal(r.codice, 0, r.uscita);
  assert.match(r.uscita, /firma: buona su origin\/main/);
  assert.equal(esito().esito, "buona");
});

test("commit firmato da una chiave estranea: fermo in modo blocca", () => {
  commit("main", ESTRANEA);
  assert.equal(guardia("main", { DA_INVENT_FIRMA_RILASCI: "blocca" }).codice, 1);
});

test("il commit in arrivo aggiunge la propria chiave ai firmatari: non vale, si legge la copia installata", () => {
  git(ORIGIN, "checkout", "-q", "-B", "main");
  writeFileSync(join(ORIGIN, "deploy", "firmatari-rilasci"), `intruso@example.invalid namespaces="git" ${readFileSync(`${ESTRANEA}.pub`, "utf8")}`);
  git(ORIGIN, "add", ".");
  git(ORIGIN, "-c", "gpg.format=ssh", "-c", `user.signingkey=${ESTRANEA}.pub`, "commit", "-q", "-S", "-m", "mi aggiungo da solo");
  git(CLONE, "fetch", "-q", "origin", "main");
  assert.equal(guardia("main", { DA_INVENT_FIRMA_RILASCI: "blocca" }).codice, 1);
});

test("un ramo non controllato (dev) passa senza firma anche in modo blocca", () => {
  commit("dev", null);
  const r = guardia("dev", { DA_INVENT_FIRMA_RILASCI: "blocca" });
  assert.equal(r.codice, 0);
  assert.equal(r.uscita.trim(), "");
});

test("senza firmatari nella copia installata: avvisa procede, blocca ferma (mai al buio)", () => {
  const vuoto = join(RADICE, "vuoto");
  writeFileSync(vuoto, "# nessuna chiave\n");
  assert.equal(guardia("main", { DA_INVENT_FIRMATARI: vuoto, DA_INVENT_FIRMA_RILASCI: "avvisa" }).codice, 0);
  const r = guardia("main", { DA_INVENT_FIRMATARI: vuoto, DA_INVENT_FIRMA_RILASCI: "blocca" });
  assert.equal(r.codice, 1);
  assert.match(r.uscita, /nessun firmatario/);
});

test("modo spenta: nessun controllo; modo scritto male: fermo", () => {
  assert.equal(guardia("main", { DA_INVENT_FIRMA_RILASCI: "spenta" }).codice, 0);
  assert.equal(guardia("main", { DA_INVENT_FIRMA_RILASCI: "bloca" }).codice, 1);
});
