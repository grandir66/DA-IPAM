/**
 * Tappa C1 (NetBird/DA-Link), Task 1: la configurazione DA-Link dell'istanza.
 *
 * Il contratto lo scrive DA-Link (`dalink/comando.py`): il comando d'installazione
 * crea `/etc/dalink/oggetto.env` con umask 077. File assente = funzione assente
 * (freno del parco: un DA-IPAM senza configurazione non chiama niente). Un file
 * con permessi larghi si rifiuta: il token dentro varrebbe per chiunque lo legga.
 * I motivi di rifiuto non contengono mai il token.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { leggiConfigDalink, normalizzaImpronta, percorsoOggettoEnv } from "../config";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dalink-config-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const B64 = Buffer.alloc(32, 7).toString("base64");
const TOKEN = "dlk_" + "A".repeat(43);

function scrivi(nome: string, righe: string[], modo = 0o600): string {
  const p = path.join(DIR, nome);
  fs.writeFileSync(p, righe.join("\n") + "\n");
  fs.chmodSync(p, modo);
  return p;
}

const BUONO = [
  "DALINK_URL=https://da-link.netbird.selfhosted:8443",
  `DALINK_IMPRONTA=sha256//${B64}`,
  "DALINK_CODCLI=99999",
  "DALINK_NODO=99999-ipam",
  `DALINK_TOKEN=${TOKEN}`,
];

test("file assente → assente", () => {
  assert.deepEqual(leggiConfigDalink(path.join(DIR, "non-esiste.env")), { stato: "assente" });
});

test("file valido con permessi 600 → pronta, impronta nella forma di DA-IPAM", () => {
  const c = leggiConfigDalink(scrivi("buono.env", BUONO));
  assert.equal(c.stato, "pronta");
  if (c.stato !== "pronta") return;
  assert.equal(c.url.href, "https://da-link.netbird.selfhosted:8443/");
  assert.equal(c.impronta, `sha256/${B64}`);
  assert.equal(c.codcli, "99999");
  assert.equal(c.nodo, "99999-ipam");
  assert.equal(c.token, TOKEN);
});

test("permessi larghi → non_valida, e il token non si usa", () => {
  const c = leggiConfigDalink(scrivi("largo.env", BUONO, 0o644));
  assert.equal(c.stato, "non_valida");
  if (c.stato === "non_valida") assert.match(c.motivo, /permessi/);
});

test("token senza prefisso dlk_ → non_valida, e il motivo non contiene il token", () => {
  const segreto = "xyz_SEGRETISSIMO_123";
  const c = leggiConfigDalink(scrivi("token.env", [...BUONO.slice(0, 4), `DALINK_TOKEN=${segreto}`]));
  assert.equal(c.stato, "non_valida");
  if (c.stato === "non_valida") {
    assert.match(c.motivo, /token/i);
    assert.ok(!c.motivo.includes(segreto));
  }
});

test("URL non https → non_valida", () => {
  const c = leggiConfigDalink(scrivi("http.env", ["DALINK_URL=http://da-link:8443", ...BUONO.slice(1)]));
  assert.equal(c.stato, "non_valida");
  if (c.stato === "non_valida") assert.match(c.motivo, /https/);
});

test("codice cliente con lo spazio davanti → pronta, spazio tolto al confine", () => {
  const righe = BUONO.map((r) => (r.startsWith("DALINK_CODCLI=") ? "DALINK_CODCLI= 99999" : r));
  const c = leggiConfigDalink(scrivi("spazio.env", righe));
  assert.equal(c.stato, "pronta");
  if (c.stato === "pronta") assert.equal(c.codcli, "99999");
});

test("codice cliente non numerico → non_valida", () => {
  const righe = BUONO.map((r) => (r.startsWith("DALINK_CODCLI=") ? "DALINK_CODCLI=12345a" : r));
  assert.equal(leggiConfigDalink(scrivi("codcli.env", righe)).stato, "non_valida");
});

test("nodo diverso da <codcli>-ipam → non_valida", () => {
  const righe = BUONO.map((r) => (r.startsWith("DALINK_NODO=") ? "DALINK_NODO=99999-edge" : r));
  const c = leggiConfigDalink(scrivi("nodo.env", righe));
  assert.equal(c.stato, "non_valida");
  if (c.stato === "non_valida") assert.match(c.motivo, /nodo/);
});

test("impronta mancante o malformata → non_valida", () => {
  const righe = BUONO.map((r) => (r.startsWith("DALINK_IMPRONTA=") ? "DALINK_IMPRONTA=md5//abc" : r));
  assert.equal(leggiConfigDalink(scrivi("impronta.env", righe)).stato, "non_valida");
  assert.equal(leggiConfigDalink(scrivi("senza-impronta.env", BUONO.filter((r) => !r.startsWith("DALINK_IMPRONTA=")))).stato, "non_valida");
});

test("commenti, righe vuote, virgolette e chiavi sconosciute non disturbano", () => {
  const righe = [
    "# scritto da DA-Link",
    "",
    'DALINK_URL="https://da-link.netbird.selfhosted:8443"',
    ...BUONO.slice(1),
    "ALTRO=qualcosa",
  ];
  assert.equal(leggiConfigDalink(scrivi("misto.env", righe)).stato, "pronta");
});

test("normalizzaImpronta: forme di curl e di DA-IPAM, il resto no", () => {
  assert.equal(normalizzaImpronta(`sha256//${B64}`), `sha256/${B64}`);
  assert.equal(normalizzaImpronta(`sha256/${B64}`), `sha256/${B64}`);
  assert.equal(normalizzaImpronta("sha256//corta"), null);
  assert.equal(normalizzaImpronta(""), null);
});

test("percorso: variabile d'ambiente, altrimenti /etc/dalink/oggetto.env", () => {
  const prima = process.env.DALINK_OGGETTO_ENV;
  try {
    delete process.env.DALINK_OGGETTO_ENV;
    assert.equal(percorsoOggettoEnv(), "/etc/dalink/oggetto.env");
    process.env.DALINK_OGGETTO_ENV = "/tmp/altro.env";
    assert.equal(percorsoOggettoEnv(), "/tmp/altro.env");
  } finally {
    if (prima === undefined) delete process.env.DALINK_OGGETTO_ENV;
    else process.env.DALINK_OGGETTO_ENV = prima;
  }
});
