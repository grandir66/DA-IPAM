/**
 * Le esche (`scripts/esche/da-ipam-esche.mjs`) e i comandi dell'esecutore che le accendono e che bloccano un
 * indirizzo. Qui si lancia il servizio vero su una cartella usa e getta e gli si parla come farebbe un intruso.
 * Il punto che non deve rompersi mai: la password provata NON finisce su disco.
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const SERVIZIO = path.join(process.cwd(), "scripts/esche/da-ipam-esche.mjs");
const SCRIPT = path.join(process.cwd(), "scripts/accessi/da-ipam-accessi.sh");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daipam-esche-"));
const PASSWORD = "S3greta-Che-Non-Deve-Restare!";
let processo: ChildProcess | null = null;

before(async () => {
  fs.writeFileSync(path.join(DIR, "esche.conf"), "ESCHE=telnet,ftp,web,ssh,smb,inventata\n");
  processo = spawn(process.execPath, [SERVIZIO], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ESCHE_CONF: path.join(DIR, "esche.conf"), ESCHE_STATO: path.join(DIR, "stato") }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    let visti = 0;
    const t = setTimeout(() => reject(new Error("le esche non sono partite in 8 secondi")), 8000);
    processo?.stdout?.on("data", (d: Buffer) => {
      visti += (d.toString().match(/in ascolto/g) ?? []).length;
      if (visti >= 5) { clearTimeout(t); resolve(); }
    });
  });
});
after(() => {
  processo?.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
});

/** Parla con un'esca: manda le righe una dopo l'altra, ognuna quando arriva qualcosa; ritorna tutto ciò che ha letto. */
function parla(porta: number, righe: string[], primaParlo = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(porta, "127.0.0.1");
    let letto = "";
    const coda = [...righe];
    const prossima = () => { const r = coda.shift(); if (r !== undefined) s.write(r); };
    s.setTimeout(6000, () => { s.destroy(); resolve(letto); });
    s.on("connect", () => { if (primaParlo) prossima(); });
    s.on("data", (d) => { letto += d.toString("latin1"); prossima(); });
    s.on("close", () => resolve(letto));
    s.on("error", reject);
  });
}

function eventi(): Array<Record<string, unknown>> {
  const dir = path.join(DIR, "stato");
  return fs.readdirSync(dir).filter((f) => f.startsWith("eventi-")).flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r) as Record<string, unknown>));
}
const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("telnet e ftp chiedono nome e password, rifiutano e chiudono; il web mostra una pagina di login", async () => {
  const telnet = await parla(20023, ["admin\r\n", `${PASSWORD}\r\n`]);
  assert.match(telnet, /login: /);
  assert.match(telnet, /Password: /);
  assert.match(telnet, /Login incorrect/);
  const ftp = await parla(20021, ["USER backup\r\n", `PASS ${PASSWORD}\r\n`]);
  assert.match(ftp, /^220 /);
  assert.match(ftp, /331 /);
  assert.match(ftp, /530 Login incorrect/);
  const pagina = await parla(28081, ["GET / HTTP/1.1\r\nHost: x\r\n\r\n"], true);
  assert.match(pagina, /^HTTP\/1\.1 200 OK/);
  assert.match(pagina, /type="password"/);
  const corpo = `username=root&password=${encodeURIComponent(PASSWORD)}`;
  const post = await parla(28081, [`POST /login HTTP/1.1\r\nHost: x\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${corpo.length}\r\n\r\n${corpo}`], true);
  assert.match(post, /^HTTP\/1\.1 401/);
  assert.match(await parla(22222, ["SSH-2.0-intruso\r\n"]), /^SSH-2\.0-OpenSSH/);
  await parla(20445, ["\x00\x00\x00\x2fqualcosa"], true);
});

test("ogni contatto è una riga con indirizzo, esca e nome provato; la password non sta su disco, in nessuna forma leggibile", async () => {
  await attendi(300);
  const e = eventi();
  const di = (esca: string) => e.filter((x) => x.esca === esca);
  assert.equal(di("telnet")[0]?.utente, "admin");
  assert.equal(di("telnet")[0]?.indirizzo, "127.0.0.1");
  assert.equal(di("telnet")[0]?.porta, 23);
  assert.equal(di("ftp")[0]?.utente, "backup");
  assert.ok(di("web").some((x) => x.utente === "root"));
  assert.equal(di("ssh")[0]?.nota, "SSH-2.0-intruso");
  assert.equal(di("smb").length, 1);
  // Della password restano lunghezza e impronta, uguali per la stessa password su esche diverse.
  const p = di("telnet")[0]?.password as { lunga: number; impronta: string };
  assert.equal(p.lunga, PASSWORD.length);
  assert.match(p.impronta, /^[0-9a-f]{16}$/);
  assert.deepEqual(di("ftp")[0]?.password, p);
  // Il punto: in tutta la cartella dello stato il testo della password non c'è, nemmeno codificato per l'URL o in base64.
  const tutto = fs.readdirSync(path.join(DIR, "stato")).map((f) => fs.readFileSync(path.join(DIR, "stato", f)).toString("latin1")).join("\n");
  for (const forma of [PASSWORD, encodeURIComponent(PASSWORD), Buffer.from(PASSWORD).toString("base64"), Buffer.from(PASSWORD).toString("hex")]) assert.equal(tutto.includes(forma), false, `la password è su disco come ${forma.slice(0, 6)}…`);
});

test("un'esca non esegue e non conserva ciò che riceve: caratteri strani tolti, nome tagliato, troppi byte chiudono", async () => {
  await parla(20023, [`${"A".repeat(200)}\x1b[31m\x00\r\n`, "x\r\n"]);
  await attendi(200);
  const lungo = eventi().filter((x) => x.esca === "telnet").pop();
  assert.equal(String(lungo?.utente).length, 64);
  assert.match(String(lungo?.utente), /^A+$/);
  const prima = eventi().length;
  await parla(20021, ["X".repeat(6000)]);
  await attendi(200);
  assert.equal(eventi().length, prima + 1);
  // «inventata» non è nell'elenco chiuso: nessuna porta in più.
  assert.equal(eventi().some((x) => x.esca === "inventata"), false);
});

function esecutore(esche: string, args: string[]) {
  const e = path.join(DIR, `e-${Math.random().toString(36).slice(2)}.conf`);
  fs.writeFileSync(e, esche);
  const r = spawnSync("bash", [SCRIPT, ...args], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "/usr/bin:/bin", DAIPAM_ESCHE_CONF: e, DAIPAM_ACCESSI_CONF: path.join(DIR, "non-esiste.conf") }, encoding: "utf8" });
  return { codice: r.status, out: r.stdout, err: r.stderr };
}

test("esecutore: le esche accese diventano un redirect verso le porte alte, e il filtro le lascia aperte a tutti", async () => {
  const r = esecutore("ESCHE=telnet,web\n", ["esche-anteprima"]);
  assert.equal(r.codice, 0, r.err);
  assert.match(r.out, /type nat hook prerouting priority dstnat - 5;/);
  assert.match(r.out, /fib daddr type local tcp dport \{ 23, 8081 \} counter redirect to :tcp dport map \{ 23 : 20023, 8081 : 28081 \}/);
  // NetBird, Docker e la macchina stessa non vengono mai portati alle esche.
  for (const salva of ['iifname "lo" return', 'iifname "wt0" return', 'iifname "docker*" return', 'iifname "br-*" return']) assert.ok(r.out.indexOf(salva) > 0 && r.out.indexOf(salva) < r.out.indexOf("redirect"), salva);
  const filtro = esecutore("ESCHE=telnet,web\n", ["anteprima"]).out;
  assert.match(filtro, /tcp dport \{ 23, 8081 \} accept comment "esche"/);
  assert.ok(filtro.indexOf('comment "esche"') < filtro.indexOf("jump g_web"));
  // Senza esche: solo la cancellazione della tabella, e nessuna porta aperta in più nel filtro.
  assert.doesNotMatch(esecutore("ESCHE=\n", ["esche-anteprima"]).out, /chain/);
  assert.doesNotMatch(esecutore("ESCHE=\n", ["anteprima"]).out, /esche/);
  // La politica minima (guasto all'avvio) non apre nemmeno le esche.
  assert.doesNotMatch(esecutore("ESCHE=telnet\n", ["minima"]).out, /esche/);
  const no = esecutore("ESCHE=telnet,shell\n", ["esche-anteprima"]);
  assert.equal(no.codice, 1);
  assert.match(no.err, /esca sconosciuta: «shell»/);
});

test("l'elenco delle esche è lo stesso nel servizio e nell'esecutore, e nessuna usa una porta vera dei moduli", async () => {
  const { ESCHE } = (await import(SERVIZIO)) as { ESCHE: Record<string, { porta: number; ascolta: number }> };
  const nota = /^ESCHE_NOTE="([^"]+)"/m.exec(fs.readFileSync(SCRIPT, "utf8"))?.[1] ?? "";
  const daScript = Object.fromEntries(nota.split(" ").map((v) => { const [n, p, a] = v.split(":"); return [n, { porta: Number(p), ascolta: Number(a) }]; }));
  assert.deepEqual(daScript, ESCHE);
  const vere = [22, 53, 80, 443, 3001, 4443, 6443, 7443, 8000, 8080, 8443, 9443, 10050, 10051, 51820, 162, 514, 1514, 1515, 2055, 5601, 6343, 9200, 55000];
  for (const e of Object.values(ESCHE)) {
    assert.equal(vere.includes(e.porta), false, `porta finta ${e.porta}`);
    assert.equal(vere.includes(e.ascolta), false, `porta alta ${e.ascolta}`);
    assert.ok(e.ascolta >= 20000 && e.ascolta < 32768, "porta alta fuori dall'intervallo delle porte effimere");
  }
});

test("la tabella del blocco scarta chi è bloccato ma mai NetBird, Docker e la macchina; bloccare vuole root", () => {
  const r = esecutore("", ["blocco-anteprima"]);
  assert.match(r.out, /type filter hook prerouting priority mangle \+ 3;/);
  for (const salva of ['iifname "lo" accept', 'iifname "wt0" accept', 'iifname "docker*" accept', 'iifname "br-*" accept']) assert.ok(r.out.indexOf(salva) > 0 && r.out.indexOf(salva) < r.out.indexOf("@bloccati4"), salva);
  assert.match(r.out, /size 1024/);
  if (process.getuid?.() !== 0) for (const c of [["blocca", "192.0.2.5", "3600"], ["sblocca", "192.0.2.5"], ["esche"]]) assert.match(esecutore("", c).err, /vuole root/);
});
