/**
 * A-IPAM (invio AD e inventario a DA-Vul-can), Task 1: le chiavi VULCAN in
 * `/etc/dalink/oggetto.env` e il cliente da cui si legge.
 *
 * Stesse regole di `dalink/config.ts`: file assente = spento, permessi ≠ 600 =
 * rifiutato, riletto a ogni uso. In più: senza `VULCAN_TOKEN` il flusso è spento
 * anche se le chiavi DA-Link ci sono (caso 1 del piano: oggi tutte le istanze con
 * NetBird). Il gettone non compare mai in un motivo, in un campo diverso da
 * `token` o in una riga di console.
 *
 * Hub di prova isolato: `support/hub-isolato` va importato PER PRIMO (la catena
 * `vulcan/config` → `dalink/fatti` → `db-hub`).
 */
import "../../integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { leggiConfigVulcan, tenantPerVulcan, type ConfigVulcan } from "../config";
import { controllaFileOggetto } from "@/lib/dalink/config";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vulcan-config-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

// Forma vera del gettone dell'hub: 48 byte casuali in base64url (64 caratteri).
const GETTONE = crypto.randomBytes(48).toString("base64url");
const B64 = Buffer.alloc(32, 7).toString("base64");

const DALINK = [
  "DALINK_URL=https://da-link.netbird.selfhosted:8443",
  `DALINK_IMPRONTA=sha256//${B64}`,
  "DALINK_CODCLI=99999",
  "DALINK_NODO=99999-ipam",
  `DALINK_TOKEN=dlk_${"A".repeat(43)}`,
];
const VULCAN = ["VULCAN_URL=https://da-vulcan.domarc.it", `VULCAN_TOKEN=${GETTONE}`];

function scrivi(nome: string, righe: string[], modo = 0o600): string {
  const p = path.join(DIR, nome);
  fs.writeFileSync(p, righe.join("\n") + "\n");
  fs.chmodSync(p, modo);
  return p;
}

/** Legge la configurazione catturando la console: nessuna riga deve portare il gettone. */
function leggi(p: string, segreto = GETTONE): ConfigVulcan {
  const righe: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const cattura = (...a: unknown[]) => righe.push(a.map(String).join(" "));
  console.log = console.warn = console.error = console.info = cattura;
  let c: ConfigVulcan;
  try {
    c = leggiConfigVulcan(p);
  } finally {
    Object.assign(console, orig);
  }
  for (const r of righe) assert.ok(!r.includes(segreto), "il gettone è finito in console");
  if (c.stato === "non_valida") {
    assert.ok(!c.motivo.includes(segreto), "il gettone è finito nel motivo");
    assert.ok(c.motivo.length > 0);
  }
  return c;
}

function nonValida(c: ConfigVulcan, re: RegExp): void {
  assert.equal(c.stato, "non_valida");
  if (c.stato === "non_valida") assert.match(c.motivo, re);
}

test("file assente → spento", () => {
  assert.deepEqual(leggi(path.join(DIR, "non-esiste.env")), { stato: "spento" });
});

test("caso 1: oggetto.env con le sole chiavi DA-Link, senza VULCAN_TOKEN → spento", () => {
  assert.deepEqual(leggi(scrivi("solo-dalink.env", DALINK)), { stato: "spento" });
});

test("VULCAN_URL presente ma VULCAN_TOKEN assente o vuoto → spento", () => {
  assert.deepEqual(leggi(scrivi("senza-gettone.env", [...DALINK, VULCAN[0]])), { stato: "spento" });
  assert.deepEqual(leggi(scrivi("gettone-vuoto.env", [...DALINK, VULCAN[0], "VULCAN_TOKEN=  "])), { stato: "spento" });
});

test("permessi 644 → non_valida, senza il gettone nel motivo", () => {
  nonValida(leggi(scrivi("largo.env", [...DALINK, ...VULCAN], 0o644)), /permessi/);
});

test("VULCAN_URL http:// → non_valida", () => {
  nonValida(leggi(scrivi("http.env", [...DALINK, "VULCAN_URL=http://da-vulcan.domarc.it", VULCAN[1]])), /https/);
});

test("VULCAN_URL assente o non un indirizzo, col gettone presente → non_valida", () => {
  nonValida(leggi(scrivi("senza-url.env", [...DALINK, VULCAN[1]])), /VULCAN_URL/);
  nonValida(leggi(scrivi("url-storto.env", [...DALINK, "VULCAN_URL=non un url", VULCAN[1]])), /VULCAN_URL/);
});

test("VULCAN_URL con percorso, query o credenziali → non_valida (solo origine)", () => {
  for (const u of [
    "https://da-vulcan.domarc.it/api",
    "https://da-vulcan.domarc.it/?x=1",
    "https://utente:segreto@da-vulcan.domarc.it",
    "https://utente@da-vulcan.domarc.it/",
  ]) {
    const c = leggi(scrivi("url-origine.env", [...DALINK, `VULCAN_URL=${u}`, VULCAN[1]]));
    nonValida(c, /VULCAN_URL/);
    if (c.stato === "non_valida") assert.ok(!c.motivo.includes("segreto"));
  }
});

test("gettone col prefisso dlk_ o con caratteri fuori alfabeto o troppo corto → non_valida", () => {
  const storti = [
    `dlk_${GETTONE}`,
    GETTONE.slice(0, 30) + "+/=" + GETTONE.slice(33),
    GETTONE.slice(0, 39),
    "x".repeat(201),
  ];
  for (const g of storti) {
    nonValida(leggi(scrivi("gettone-storto.env", [...DALINK, VULCAN[0], `VULCAN_TOKEN=${g}`]), g), /VULCAN_TOKEN/);
  }
});

test("nodo di un altro cliente → non_valida", () => {
  const righe = DALINK.map((r) => (r.startsWith("DALINK_NODO=") ? "DALINK_NODO=12345-ipam" : r));
  nonValida(leggi(scrivi("nodo-altrui.env", [...righe, ...VULCAN])), /DALINK_NODO/);
});

test("codcli non numerico → non_valida", () => {
  const righe = DALINK.map((r) => (r.startsWith("DALINK_CODCLI=") ? "DALINK_CODCLI=ABC" : r));
  nonValida(leggi(scrivi("codcli.env", [...righe, ...VULCAN])), /DALINK_CODCLI/);
});

test("file valido → pronta; impronta di 16 caratteri; il gettone solo in `token`", () => {
  const c = leggi(scrivi("buono.env", [...DALINK, ...VULCAN]));
  assert.equal(c.stato, "pronta");
  if (c.stato !== "pronta") return;
  assert.equal(c.url.origin, "https://da-vulcan.domarc.it");
  assert.equal(c.token, GETTONE);
  assert.equal(c.codcli, "99999");
  assert.equal(c.nodo, "99999-ipam");
  assert.match(c.improntaGettone, /^[0-9a-f]{16}$/);
  assert.equal(c.improntaGettone, crypto.createHash("sha256").update(GETTONE).digest("hex").slice(0, 16));
  const { token: _t, ...resto } = c;
  void _t;
  assert.ok(!JSON.stringify({ ...resto, url: c.url.href }).includes(GETTONE));
  // Nemmeno per sbaglio dentro l'URL.
  assert.ok(!c.url.href.includes(GETTONE));
});

test("DALINK_URL/DALINK_TOKEN non servono: codcli, nodo e chiavi VULCAN bastano", () => {
  const c = leggi(scrivi("solo-vulcan.env", ["DALINK_CODCLI=99999", "DALINK_NODO=99999-ipam-2", ...VULCAN]));
  assert.equal(c.stato, "pronta", c.stato === "non_valida" ? c.motivo : "");
});

test("valori fra virgolette e codcli con spazio davanti, come in config.ts", () => {
  const righe = ['DALINK_CODCLI=" 99999"', "DALINK_NODO=99999-ipam", `VULCAN_URL="https://da-vulcan.domarc.it/"`, `VULCAN_TOKEN='${GETTONE}'`];
  const c = leggi(scrivi("virgolette.env", righe));
  assert.equal(c.stato, "pronta", c.stato === "non_valida" ? c.motivo : "");
});

test("il file si rilegge a ogni uso: aggiunto il gettone, si accende senza riavvio", () => {
  const p = scrivi("riletto.env", DALINK);
  assert.equal(leggi(p).stato, "spento");
  fs.appendFileSync(p, VULCAN.join("\n") + "\n");
  assert.equal(leggi(p).stato, "pronta");
  fs.chmodSync(p, 0o640);
  assert.equal(leggi(p).stato, "non_valida");
});

test("tenantPerVulcan: codcli esistente → codcli", () => {
  assert.equal(tenantPerVulcan("99999", { clienteEsiste: (c) => c === "99999", unicoClienteAppliance: () => false }), "99999");
});

test("tenantPerVulcan: codcli assente e DEFAULT unico → DEFAULT", () => {
  assert.equal(tenantPerVulcan("99999", { clienteEsiste: () => false, unicoClienteAppliance: () => true }), "DEFAULT");
});

test("tenantPerVulcan: più clienti e codcli assente → null", () => {
  assert.equal(tenantPerVulcan("99999", { clienteEsiste: () => false, unicoClienteAppliance: () => false }), null);
});

test("tenantPerVulcan: un errore nel registro dei clienti → null, mai un tenant a caso", () => {
  const rotto = () => {
    throw new Error("hub illeggibile");
  };
  assert.equal(tenantPerVulcan("99999", { clienteEsiste: rotto, unicoClienteAppliance: () => true }), null);
});

test("revisione: un collegamento simbolico al posto del file → non_valida (anche se punta a un file buono)", () => {
  const vero = scrivi("vero.env", [...DALINK, ...VULCAN]);
  const link = path.join(DIR, "link.env");
  fs.symlinkSync(vero, link);
  nonValida(leggi(link), /collegamento/);
});

test("revisione: proprietario né root né l'utente del servizio → non_valida", () => {
  const p = scrivi("altrui.env", [...DALINK, ...VULCAN]);
  const f = controllaFileOggetto(p, [123456]);
  assert.equal(f.esito, "non_valido");
  if (f.esito === "non_valido") assert.match(f.motivo, /proprietario/);
  // Proprietario predefinito: root o l'utente che fa girare DA-IPAM (qui chi esegue la prova).
  assert.equal(controllaFileOggetto(p).esito, "letto");
});
