/**
 * Tappa C1, Task 12: l'installatore che prepara l'istanza a entrare in NetBird.
 *
 * Zona rossa: la chiave d'ingresso è monouso ma, finché vale, fa entrare chiunque
 * nella rete Domarc. Regola del parco (lezione del 13/10): i segreti passano solo da
 * stdin, mai come argomento (`ps` li leggerebbe), mai a schermo. Qui ogni comando
 * esterno è finto e scrive i propri argomenti in un registro: la chiave non deve
 * comparire né lì né nell'uscita, e il suo file non deve esistere alla fine.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(process.cwd(), "scripts/dalink/prepara-netbird.sh");
const RADICE = fs.mkdtempSync(path.join(os.tmpdir(), "dalink-prepara-"));
after(() => fs.rmSync(RADICE, { recursive: true, force: true }));

const CHIAVE = "A1B2C3D4-E5F6-4789-9ABC-DEF012345678";
const FINTI = ["apt-get", "curl", "gpg", "netbird", "tailscale", "nft", "systemctl", "shred", "id", "ip"];

interface Ambiente {
  dir: string;
  dalink: string;
  systemd: string;
  registro: string;
}

function ambiente(opz: { tailscale?: boolean; netbird?: boolean; oggetto?: boolean } = {}): Ambiente {
  const dir = fs.mkdtempSync(path.join(RADICE, "a-"));
  const bin = path.join(dir, "bin");
  const dalink = path.join(dir, "etc-dalink");
  const systemd = path.join(dir, "systemd");
  const registro = path.join(dir, "comandi.log");
  fs.mkdirSync(bin);
  fs.mkdirSync(systemd);
  for (const c of FINTI) {
    if (c === "tailscale" && !opz.tailscale) continue;
    if (c === "netbird" && opz.netbird === false) continue;
    let corpo = `#!/bin/bash\necho "${c} $*" >> "${registro}"\n`;
    if (c === "id") corpo += 'echo 0\n';
    if (c === "shred") corpo += 'for a in "$@"; do case "$a" in -*) ;; *) rm -f "$a" ;; esac; done\n';
    if (c === "curl") corpo += 'echo chiave-pubblica-finta\n';
    if (c === "gpg") corpo += 'cat > /dev/null\n';
    fs.writeFileSync(path.join(bin, c), corpo, { mode: 0o755 });
  }
  if (opz.oggetto !== false) {
    fs.mkdirSync(dalink, { mode: 0o700 });
    fs.writeFileSync(path.join(dalink, "oggetto.env"), "DALINK_CODCLI=99999\nDALINK_NODO=99999-ipam\nDALINK_TOKEN=dlk_finto\n", { mode: 0o600 });
    fs.chmodSync(path.join(dalink, "oggetto.env"), 0o600);
  }
  return { dir, dalink, systemd, registro };
}

function lancia(a: Ambiente, args: string[], stdin = "") {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: `${path.join(a.dir, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
    DALINK_DIR: a.dalink,
    DALINK_SYSTEMD_DIR: a.systemd,
    DALINK_APP_DIR: process.cwd(),
    TMPDIR: a.dir,
  };
  const r = spawnSync("bash", [SCRIPT, ...args], { env, input: stdin, encoding: "utf8" });
  const comandi = fs.existsSync(a.registro) ? fs.readFileSync(a.registro, "utf8") : "";
  return { codice: r.status, out: r.stdout + r.stderr, comandi };
}

test("la chiave non compare in nessun argomento né nell'uscita, e il suo file sparisce", () => {
  const a = ambiente();
  const r = lancia(a, ["--applica", "--edge", "no", "--chiave-da-stdin"], `${CHIAVE}\n`);
  assert.equal(r.codice, 0, r.out);
  assert.match(r.comandi, /netbird up --management-url https:\/\/netbird\.domarc\.it --setup-key-file \S+netbird\.key --hostname 99999-ipam/);
  assert.ok(!r.comandi.includes(CHIAVE), "la chiave è passata come argomento");
  assert.ok(!r.out.includes(CHIAVE), "la chiave è comparsa a schermo");
  assert.ok(!fs.existsSync(path.join(a.dalink, "netbird.key")), "il file della chiave è rimasto");
  assert.match(r.comandi, /shred -u \S+netbird\.key/);
});

test("prova a vuoto: nessun comando che scrive, nessun file creato", () => {
  const a = ambiente({ tailscale: true });
  const r = lancia(a, ["--edge", "si", "--chiave-da-stdin"], `${CHIAVE}\n`);
  assert.equal(r.codice, 0, r.out);
  assert.doesNotMatch(r.comandi, /apt-get|netbird up|systemctl|tailscale set|nft -f|shred/);
  assert.match(r.out, /Prova a vuoto/);
  assert.match(r.out, /6443/);
  assert.ok(!r.out.includes(CHIAVE));
  assert.deepEqual(fs.readdirSync(a.dalink).sort(), ["oggetto.env"]);
  assert.deepEqual(fs.readdirSync(a.systemd), []);
});

test("senza --edge si ferma prima di tutto", () => {
  const a = ambiente();
  const r = lancia(a, ["--applica"]);
  assert.notEqual(r.codice, 0);
  assert.equal(r.comandi, "");
});

test("Tailscale presente: netfilter-mode=off prima di netbird up", () => {
  const a = ambiente({ tailscale: true });
  const r = lancia(a, ["--applica", "--edge", "no", "--chiave-da-stdin"], `${CHIAVE}\n`);
  assert.equal(r.codice, 0, r.out);
  const righe = r.comandi.split("\n");
  const ts = righe.findIndex((x) => x === "tailscale set --netfilter-mode=off");
  const up = righe.findIndex((x) => x.startsWith("netbird up"));
  assert.ok(ts >= 0 && up > ts, r.comandi);
});

test("senza oggetto.env e con la chiave: si ferma e non chiama netbird up", () => {
  const a = ambiente({ oggetto: false });
  const r = lancia(a, ["--applica", "--edge", "no", "--chiave-da-stdin"], `${CHIAVE}\n`);
  assert.notEqual(r.codice, 0);
  assert.doesNotMatch(r.comandi, /netbird up/);
  assert.ok(!r.out.includes(CHIAVE));
});

test("NetBird assente: si installa dal repository firmato", () => {
  const a = ambiente({ netbird: false });
  const r = lancia(a, ["--applica", "--edge", "no"]);
  assert.match(r.comandi, /curl -fsSL https:\/\/pkgs\.netbird\.io\/debian\/public\.key/);
  assert.match(r.comandi, /apt-get install -y netbird/);
});

test("firewall: file 600 con la scelta, unità col percorso dell'app, servizio avviato", () => {
  const a = ambiente();
  const r = lancia(a, ["--applica", "--edge", "si", "--sorgenti", "100.101.2.3"]);
  assert.equal(r.codice, 0, r.out);
  const fw = path.join(a.dalink, "firewall.env");
  assert.match(fs.readFileSync(fw, "utf8"), /DALINK_FW_EDGE=si\nDALINK_FW_SORGENTI=100\.101\.2\.3/);
  assert.equal(fs.statSync(fw).mode & 0o777, 0o600);
  const unita = fs.readFileSync(path.join(a.systemd, "dalink-firewall.service"), "utf8");
  assert.ok(unita.includes(`${process.cwd()}/scripts/dalink/firewall-wt0.sh --applica`));
  assert.ok(!unita.includes("@APP_DIR@"));
  assert.match(r.comandi, /systemctl enable dalink-firewall\.service/);
  assert.match(r.comandi, /systemctl restart dalink-firewall\.service/);
});

test("sorgente non valida: si ferma prima di toccare la macchina", () => {
  const a = ambiente();
  const r = lancia(a, ["--applica", "--edge", "no", "--sorgenti", "192.0.2.10"]);
  assert.notEqual(r.codice, 0);
  assert.equal(r.comandi, "");
});

test("una chiave con caratteri strani non si usa", () => {
  const a = ambiente();
  const r = lancia(a, ["--applica", "--edge", "no", "--chiave-da-stdin"], "abc; rm -rf /\n");
  assert.notEqual(r.codice, 0);
  assert.equal(r.comandi, "");
});

test("install.sh --netbird senza --edge si ferma subito, prima di installare", () => {
  const r = spawnSync("bash", [path.join(process.cwd(), "scripts/install.sh"), "--netbird"], {
    env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", DA_INVENT_DIR: RADICE },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--edge=si oppure --edge=no/);
  assert.doesNotMatch(r.stdout, /Installer/);
});

test("install.sh richiama la preparazione con --applica e senza chiave", () => {
  const src = fs
    .readFileSync(path.join(process.cwd(), "scripts/install.sh"), "utf8")
    .split("\n")
    .filter((r) => !r.trim().startsWith("#"))
    .join("\n");
  assert.match(src, /prepara-netbird\.sh" --applica --edge "\$NETBIRD_EDGE"/);
  assert.doesNotMatch(src, /--chiave-da-stdin|NETBIRD_SETUP_KEY|setup-key/);
});
