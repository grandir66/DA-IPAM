/**
 * I dati ESET letti da DA-Link (17/11/2026, zona rossa): la copia si sostituisce intera, la
 * risposta di un altro cliente non si scrive, un guasto tiene la copia di prima, spento non
 * chiama nessuno.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  assicuraSchemaEset,
  giroEset,
  impostaEsetDaDalink,
  leggiRispostaEset,
  type DipendenzeGiroEset,
} from "../eset-dalink";

function banco(acceso = true): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE tenant_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
  assicuraSchemaEset(db);
  if (acceso) impostaEsetDaDalink(db, true);
  return db;
}

// Forma vera: quella di `per_appliance` di DA-Link (dalink/eset_viste.py), versione 1.
function risposta(codcli: string, macchine: unknown[]): string {
  return JSON.stringify({ versione: 1, codcli, giri: {}, macchine });
}
const M1 = {
  uuid: "m1", nome: "pc-a", hostname: "pc-a.dominio.lan", mac: ["AA-BB-CC-00-11-22", "non-un-mac"], seriale: "SN1",
  ip_locale: "10.0.0.5", sistema: "Windows 11", console: "mdr", protezione: "piena", ultimo_contatto: "2026-11-16T10:00:00Z",
  vulnerabilita: [
    { cve: "CVE-2026-0001", gravita: "SEVERITY_LEVEL_HIGH", oggetto: "Firefox", versione: "120.0", patch: true, fonte: "eset", kev: true, exploit_pubblico: false, cvss: 8.1 },
    { cve: "CVE-2026-0002", gravita: null, oggetto: "Chrome", versione: "120", patch: null, fonte: "software", kev: false, exploit_pubblico: true, cvss: null },
    { cve: "CVE-2026-0003", fonte: "inventata" },
  ],
  software: [{ nome: "Chrome", editore: "Google", versione: "120" }, { editore: "senza nome" }],
};
const M2 = { uuid: "m2", nome: "pc-b", mac: [], vulnerabilita: [], software: [] };

function giro(db: Database.Database, corpo: string | Error, extra: Partial<DipendenzeGiroEset> = {}) {
  let chiamate = 0;
  const p = giroEset({
    db,
    codcli: "70001",
    chiedi: async () => {
      chiamate++;
      if (corpo instanceof Error) throw corpo;
      return { status: 200, body: corpo };
    },
    ...extra,
  });
  return p.then((esito) => ({ esito, chiamate }));
}
const conta = (db: Database.Database, t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

test("la risposta si normalizza al confine: MAC, fonti note, righe senza nome scartate", () => {
  const r = leggiRispostaEset(risposta("70001", [M1, { nome: "senza uuid" }, M1]), "70001");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.dati.macchine.length, 1);
  const m = r.dati.macchine[0];
  assert.deepEqual(m.mac, ["aa:bb:cc:00:11:22"]);
  assert.deepEqual(m.vulnerabilita.map((v) => [v.cve, v.fonte, v.kev, v.exploit]), [
    ["CVE-2026-0001", "eset", true, false],
    ["CVE-2026-0002", "software", false, true],
  ]);
  assert.deepEqual(m.software, [{ nome: "Chrome", editore: "Google", versione: "120" }]);
});

test("la risposta di un altro cliente, di un'altra versione o storta non passa", () => {
  assert.deepEqual(leggiRispostaEset(risposta("70002", [M1]), "70001"), { ok: false, motivo: "la risposta è di un altro cliente: non scritta" });
  assert.equal(leggiRispostaEset(JSON.stringify({ versione: 2, codcli: "70001", macchine: [] }), "70001").ok, false);
  assert.equal(leggiRispostaEset("<html>", "70001").ok, false);
  assert.equal(leggiRispostaEset(JSON.stringify({ versione: 1, codcli: "70001" }), "70001").ok, false);
});

test("il giro sostituisce la copia intera e tiene gli agganci delle macchine rimaste", async () => {
  const db = banco();
  let { esito } = await giro(db, risposta("70001", [M1, M2]));
  assert.deepEqual(esito, { esito: "ok", macchine: 2, vulnerabilita: 2, software: 1 });
  db.prepare("INSERT INTO eset_abbinamento (macchina_uuid, host_id, per, a_mano, quando) VALUES ('m1', 7, 'mac', 0, 'x'), ('m2', 8, 'nome', 1, 'x')").run();
  ({ esito } = await giro(db, risposta("70001", [M1])));
  assert.deepEqual(esito, { esito: "ok", macchine: 1, vulnerabilita: 2, software: 1 });
  assert.equal(conta(db, "eset_macchina"), 1);
  assert.equal(conta(db, "eset_vuln"), 2);
  assert.deepEqual(db.prepare("SELECT macchina_uuid FROM eset_abbinamento").all(), [{ macchina_uuid: "m1" }]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM eset_giro WHERE esito = 'ok'").get() as { n: number }).n, 2);
});

test("la risposta di un altro cliente non si scrive e la copia di prima resta", async () => {
  const db = banco();
  await giro(db, risposta("70001", [M1]));
  const { esito } = await giro(db, risposta("70002", [M2]));
  assert.equal(esito.esito, "errore");
  assert.deepEqual(db.prepare("SELECT uuid FROM eset_macchina").all(), [{ uuid: "m1" }]);
  assert.equal(conta(db, "eset_vuln"), 2);
});

test("guasto di rete, risposta non 200 e zero macchine dopo un giro pieno tengono la copia", async () => {
  const db = banco();
  await giro(db, risposta("70001", [M1]));
  for (const cattiva of [new Error("rete"), risposta("70001", [])]) {
    const { esito } = await giro(db, cattiva);
    assert.equal(esito.esito, "errore");
    assert.equal(conta(db, "eset_macchina"), 1);
  }
  const e = await giroEset({ db, codcli: "70001", chiedi: async () => ({ status: 503, body: "{}" }) });
  assert.equal(e.esito, "errore");
  assert.equal(conta(db, "eset_software"), 1);
  const ultimo = db.prepare("SELECT esito, dettaglio FROM eset_giro ORDER BY id DESC LIMIT 1").get() as { esito: string; dettaglio: string };
  assert.equal(ultimo.esito, "errore");
  assert.match(ultimo.dettaglio, /503/);
});

test("un cliente senza macchine ESET al primo giro è una copia vuota, non un errore", async () => {
  const db = banco();
  const { esito } = await giro(db, risposta("70001", []));
  assert.deepEqual(esito, { esito: "ok", macchine: 0, vulnerabilita: 0, software: 0 });
});

test("spento non chiama nessuno e non scrive niente", async () => {
  const db = banco(false);
  const { esito, chiamate } = await giro(db, risposta("70001", [M1]));
  assert.equal(esito.esito, "spento");
  assert.equal(chiamate, 0);
  assert.equal(conta(db, "eset_macchina"), 0);
  assert.equal(conta(db, "eset_giro"), 0);
});

test("un guasto dopo la copia non la annulla", async () => {
  const db = banco();
  const { esito } = await giro(db, risposta("70001", [M1]), { dopo: () => { throw new Error("aggancio rotto"); } });
  assert.equal(esito.esito, "ok");
  assert.equal(conta(db, "eset_macchina"), 1);
});
