// Client dell'API di lettura e configurazione del pannello (passo 7.4): risposte
// lette con prudenza, errori col testo nostro, configurazione cifrata e validata,
// tabelle nello schema del tenant, e nessun controllo del proxy da DA-IPAM.
process.env.ENCRYPTION_KEY ||= "chiave-di-prova-del-pannello-zabbix";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { OFFERTA_PANNELLO_ZABBIX, opzioneAcquistata } from "@/lib/modules/offerta";
import { RispostaHost } from "../api";
import { leggiCentro, leggiRotta, normalizzaBase, percorsoRotta, type Lettore } from "../client";
import { chiaveLettura, leggiConfigLettura, salvaConfigLettura, togliConfigLettura } from "../config";
import { hostnameDaConf } from "../proxy-locale";
import { ErroreLettura, type Trasporto } from "../trasporto";
import { CODCLI, centroFinto } from "./support/centro-finto";

const CHIAVE = `zl1.a1b2c3d4.${"C".repeat(43)}`;
const BASE = new URL("https://centro.example/wizard");

function lettore(t: Trasporto): Lettore {
  return { base: BASE, codcli: CODCLI, trasporto: t };
}
const fisso = (status: number, body: string, retryAfter: string | null = null): Trasporto => async () => ({ status, body, retryAfter });

// ── Client ───────────────────────────────────────────────────────────────────

test("percorsi: base normalizzata, una rotta per volta, query codificata", () => {
  assert.equal(normalizzaBase("https://centro.example/wizard/"), "https://centro.example/wizard");
  assert.equal(normalizzaBase("https://centro.example/wizard/api/lettura/v1/"), "https://centro.example/wizard");
  assert.equal(percorsoRotta(BASE, "valori", { hostid: "1,2" }), "/wizard/api/lettura/v1/valori?hostid=1%2C2");
});

test("errori HTTP: testo nostro dal codice, mai quello del server; Retry-After letto", async () => {
  const corpo = JSON.stringify({ errore: "<script>testo del server</script>", codice: "chiave_non_valida" });
  await assert.rejects(leggiRotta(lettore(fisso(401, corpo)), "cliente", {}, RispostaHost), (e: unknown) => {
    assert.ok(e instanceof ErroreLettura);
    assert.equal(e.tipo, "http");
    assert.equal(e.dettagli.codice, "chiave_non_valida");
    assert.match(e.message, /chiave di lettura non valida o revocata/);
    assert.ok(!e.message.includes("script"));
    return true;
  });
  await assert.rejects(
    leggiRotta(lettore(fisso(429, JSON.stringify({ codice: "troppe_richieste" }), "42")), "cliente", {}, RispostaHost),
    (e: unknown) => e instanceof ErroreLettura && e.dettagli.riprovaTraS === 42,
  );
  await assert.rejects(
    leggiRotta(lettore(fisso(500, "non json")), "cliente", {}, RispostaHost),
    (e: unknown) => e instanceof ErroreLettura && /HTTP 500/.test(e.message),
  );
});

test("risposta non JSON o di forma inattesa: errore «risposta», nessun dato parziale", async () => {
  await assert.rejects(leggiRotta(lettore(fisso(200, "<html>")), "host", {}, RispostaHost), (e: unknown) => e instanceof ErroreLettura && e.tipo === "risposta");
  await assert.rejects(
    leggiRotta(lettore(fisso(200, JSON.stringify({ codcli: CODCLI, host: "no" }))), "host", {}, RispostaHost),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "risposta",
  );
  // Senza codcli non si sa di chi è: non si accetta.
  await assert.rejects(
    leggiRotta(lettore(fisso(200, JSON.stringify({ host: [], successivo: null }))), "host", {}, RispostaHost),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "risposta",
  );
});

test("cliente errato prima di ogni altra cosa, anche se il resto è malformato", async () => {
  await assert.rejects(
    leggiRotta(lettore(fisso(200, JSON.stringify({ codcli: "99999", host: "rotto" }))), "host", {}, RispostaHost),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "cliente_errato",
  );
});

test("valori strani diventano la cosa meno rassicurante", () => {
  const p = RispostaHost.parse({
    codcli: CODCLI,
    host: [{ hostid: "1", disponibilita: { complessiva: "forse" } }],
    successivo: null,
  });
  assert.equal(p.vecchio, true);
  assert.equal(p.host[0]!.disponibilita.complessiva, "non_so");
  assert.equal(p.host[0]!.dati_affidabili, false);
});

test("paginazione: segue «successivo»; una pagina che si ripete è un errore, non un ciclo", async () => {
  const c = centroFinto();
  c.stato.limitePagina = 1;
  const l = await leggiCentro(lettore(c.trasporto));
  assert.equal(l.host.length, 2);
  const bloccato: Trasporto = async (p) => {
    if (p.includes("/cliente")) return { status: 200, body: JSON.stringify({ codcli: CODCLI, vecchio: false, eta_s: 0 }), retryAfter: null };
    return {
      status: 200,
      body: JSON.stringify({ codcli: CODCLI, vecchio: false, eta_s: 0, host: [], successivo: "5" }),
      retryAfter: null,
    };
  };
  await assert.rejects(leggiCentro(lettore(bloccato)), (e: unknown) => e instanceof ErroreLettura && /ferma/.test(e.message));
});

// ── Configurazione ───────────────────────────────────────────────────────────

function dbProva(): Database.Database {
  return new Database(":memory:");
}

test("configurazione: chiave cifrata a riposo, mai nella vista; solo la parte pubblica", () => {
  const db = dbProva();
  const r = salvaConfigLettura(db, { baseUrl: "https://centro.example/wizard", chiave: CHIAVE, codcli: CODCLI, enabled: true }, "prova");
  assert.ok(r.ok);
  const grezza = db.prepare("SELECT * FROM zabbix_lettura_config").get() as Record<string, unknown>;
  assert.ok(!JSON.stringify(grezza).includes("CCCCCCCC"), "la chiave in chiaro non sta nel DB");
  assert.ok(!JSON.stringify(leggiConfigLettura(db)).includes("CCCCCCCC"), "né nella vista");
  assert.equal(leggiConfigLettura(db)!.chiaveId, "a1b2c3d4");
  assert.equal(chiaveLettura(db), CHIAVE);
});

test("configurazione: validazioni (https, chiave, codice cliente, impronta)", () => {
  const db = dbProva();
  const base = { baseUrl: "https://centro.example/wizard", chiave: CHIAVE, codcli: CODCLI, enabled: true };
  const errore = (i: Partial<typeof base> & { impronta?: string }) => {
    const r = salvaConfigLettura(db, { ...base, ...i }, "prova");
    return r.ok ? null : r.errore;
  };
  assert.match(errore({ baseUrl: "http://centro.example/wizard" })!, /https/);
  assert.match(errore({ baseUrl: "https://u:p@centro.example" })!, /credenziali/);
  assert.match(errore({ chiave: "zl1.corta" })!, /zl1/);
  assert.match(errore({ codcli: "12a" })!, /Codice cliente/);
  assert.match(errore({ impronta: "non-un-impronta" })!, /Impronta/);
  assert.equal(errore({ impronta: `sha256//${Buffer.alloc(32, 3).toString("base64")}` }), null);
  assert.equal(errore({}), null);
});

test("configurazione: chiave vuota = invariata; ma un indirizzo nuovo vuole la chiave di nuovo", () => {
  const db = dbProva();
  assert.ok(salvaConfigLettura(db, { baseUrl: "https://centro.example/wizard", chiave: CHIAVE, codcli: CODCLI, enabled: true }, "p").ok);
  assert.ok(salvaConfigLettura(db, { baseUrl: "https://centro.example/wizard", chiave: "", codcli: CODCLI, enabled: false }, "p").ok);
  assert.equal(chiaveLettura(db), CHIAVE);
  const r = salvaConfigLettura(db, { baseUrl: "https://altro.example/wizard", chiave: "", codcli: CODCLI, enabled: true }, "p");
  assert.ok(!r.ok && /chiave/.test(r.errore));
  assert.ok(togliConfigLettura(db));
  assert.equal(leggiConfigLettura(db), null);
});

test("lo schema del tenant crea le tabelle del pannello, e rifarlo non rompe niente", () => {
  const db = dbProva();
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_SCHEMA_SQL);
  const tabelle = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
  assert.ok(tabelle.includes("zabbix_lettura_config"));
  assert.ok(tabelle.includes("zabbix_abbinamenti"));
});

// ── Offerta e proxy locale ───────────────────────────────────────────────────

test("il pannello Zabbix è un'opzione, oggi acquistata come tutte (fino alla licenza di DA-Link)", () => {
  assert.equal(OFFERTA_PANNELLO_ZABBIX, "opzione");
  assert.equal(opzioneAcquistata("zabbix"), true);
});

test("nome del proxy dalla sua configurazione (Hostname=)", () => {
  assert.equal(hostnameDaConf("# commento\nServer=192.0.2.1\nHostname=12345-zbx\n"), "12345-zbx");
  assert.equal(hostnameDaConf("# Hostname=finto\nServer=192.0.2.1\n"), null);
});

test("DA-IPAM non governa il proxy: niente comandi di sistema nel pannello, niente proxy negli aggiornamenti", () => {
  const dir = join(process.cwd(), "src/lib/zabbix-lettura");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(src, /child_process|systemctl|execFile|spawn\(/, f);
  }
  for (const f of ["scripts/update.sh", "src/lib/aggiornamento-servizio.ts"]) {
    assert.doesNotMatch(readFileSync(join(process.cwd(), f), "utf8"), /zabbix/i, f);
  }
});
