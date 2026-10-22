/**
 * A-IPAM, Task 6: il giro verso l'hub DA-Vul-can — coda, ping, battito, audit.
 *
 * Contratto (il codice dell'hub vince, DA-Vul-can `src/app/api/ipam/*`):
 *   200/201 (anche doppione) → inviato · 400/404/413/422 e 3xx → scartato ·
 *   401/403/409 → tutto sospeso finché il gettone in `oggetto.env` non cambia ·
 *   503, altri 5xx, rete, tempo → si ritenta col backoff della coda.
 * Senza gettone: nessuna chiamata, nessuna riga, nessun audit (caso 1 del piano).
 *
 * Un `chiama` finto per la matrice degli esiti; l'hub finto HTTPS del Task 5 per la
 * prova di bordo (gettone, gzip, sha256 e audit senza segreti).
 *
 * Cartella dati isolata: `support/data-dir-isolata` va importato PER PRIMO.
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { migrateVulcanCoda } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { ensureAdHealthSchema } from "@/lib/ad/health/persist";
import { certificatoDiProva } from "@/lib/dalink/__tests__/support/certificato";
import { improntaDelGettone, type ConfigVulcan } from "../config";
import { MAX_TENTATIVI, accoda, leggiStatoVulcan, ultimoErrore, ultimoInviato } from "../coda";
import { ErroreHub, chiamaHub, type RichiestaHub, type RispostaHub } from "../trasporto";
import { _azzeraMemoriaVulcan, accodaInventario, battito, decidi, giroCoda, type DipendenzeGiro } from "../giro";
import type { RigaAuditVulcan } from "../registro";
import { BattitoHub } from "./fixtures/schemi-hub";

const TOKEN = "Gt_" + "q9W8e7R6".repeat(7);
const TOKEN_2 = "Nx_" + "z1X2c3V4".repeat(7);
const HOST = "hub.esempio.invalid";

function pronta(token = TOKEN, url = `https://${HOST}`): ConfigVulcan {
  return { stato: "pronta", url: new URL(url), token, codcli: "70791", nodo: "70791-ipam", improntaGettone: improntaDelGettone(token) };
}

function nuovoDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateVulcanCoda(db);
  return db;
}

type Rispondi = (r: RichiestaHub) => RispostaHub | Promise<RispostaHub>;
const PING_OK: RispostaHub = { status: 200, body: '{"fonte_id":3,"codcli":"70791","nodo":"70791-ipam"}' };

interface Banco {
  db: Database.Database;
  chiamate: RichiestaHub[];
  audit: RigaAuditVulcan[];
  orologio: { t: Date; avanza: (s: number) => void };
  config: { c: ConfigVulcan };
  dip: Partial<DipendenzeGiro>;
  /** Risposte alle rotte d'invio e al battito; il ping ha la sua. */
  risposta: { invio: Rispondi; ping: Rispondi; battito: Rispondi };
}

function banco(): Banco {
  const db = nuovoDb();
  const chiamate: RichiestaHub[] = [];
  const audit: RigaAuditVulcan[] = [];
  // Avanti di qualche secondo: `accoda` scrive `prossimo_tentativo = datetime('now')` col tempo vero.
  const orologio = {
    t: new Date(Date.now() + 5_000),
    avanza(s: number) {
      this.t = new Date(this.t.getTime() + s * 1000);
    },
  };
  const config = { c: pronta() };
  const risposta = {
    invio: (() => ({ status: 201, body: '{"report_id":272}' })) as Rispondi,
    ping: (() => PING_OK) as Rispondi,
    battito: (() => ({ status: 200, body: '{"ricevuto_il":"2026-10-22T08:00:00.000Z"}' })) as Rispondi,
  };
  const dip: Partial<DipendenzeGiro> = {
    config: () => config.c,
    tenant: () => "70791",
    db: () => db,
    ora: () => orologio.t,
    versione: () => "0.9.870",
    audit: (r) => audit.push(r),
    chiama: async (r) => {
      chiamate.push(r);
      if (r.percorso === "/api/ipam/ping") return risposta.ping(r);
      if (r.percorso === "/api/ipam/heartbeat") return risposta.battito(r);
      return risposta.invio(r);
    },
  };
  return { db, chiamate, audit, orologio, config, dip, risposta };
}

const JSON_AD = (n = 8) => JSON.stringify({ codcli: "70791", run_id: n, integrazione: "ad-1", findings: [] });
type RigaDb = { stato: string; tentativi: number; preso_fino: string | null; ultimo_esito: string | null; ultimo_errore: string | null; risposta_id: string | null; corpo: number };
const riga = (db: Database.Database, id: number) =>
  db
    .prepare("SELECT stato, tentativi, preso_fino, ultimo_esito, ultimo_errore, risposta_id, length(corpo_gz) AS corpo FROM vulcan_coda WHERE id = ?")
    .get(id) as RigaDb;
const invii = (b: Banco) => b.chiamate.filter((c) => c.percorso !== "/api/ipam/ping" && c.percorso !== "/api/ipam/heartbeat");
const ping = (b: Banco) => b.chiamate.filter((c) => c.percorso === "/api/ipam/ping");

function auditPulito(righe: RigaAuditVulcan[]): void {
  const t = JSON.stringify(righe);
  assert.ok(!t.includes(TOKEN) && !t.includes(TOKEN_2), "gettone nell'audit");
  assert.ok(!t.includes(HOST) && !t.includes("localhost") && !t.includes("https://"), "URL nell'audit");
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t), "IP nell'audit");
}

beforeEach(() => _azzeraMemoriaVulcan());

const aperti: Server[] = [];
after(() => {
  for (const s of aperti) {
    s.closeAllConnections();
    s.close();
  }
});

// Per primo: è l'unica prova (oltre all'ultima) con l'audit vero, e la cartella deve restare vuota.
test("caso 1: senza gettone nessuna chiamata, nessuna riga, nessun DB aperto, nessun audit", async () => {
  const db = nuovoDb();
  let chiamate = 0;
  let dbAperti = 0;
  let tenant = 0;
  const dip: Partial<DipendenzeGiro> = {
    config: () => ({ stato: "spento" }),
    tenant: () => {
      tenant++;
      return "70791";
    },
    db: () => {
      dbAperti++;
      return db;
    },
    chiama: async () => {
      chiamate++;
      return PING_OK;
    },
  };
  assert.equal((await giroCoda(dip)).esito, "spento");
  assert.equal((await battito(dip)).esito, "spento");
  assert.equal(await accodaInventario(dip), "spento");
  assert.deepEqual({ chiamate, dbAperti, tenant }, { chiamate: 0, dbAperti: 0, tenant: 0 });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vulcan_coda").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vulcan_stato").get() as { n: number }).n, 0);
  assert.ok(!fs.existsSync(path.join(TEST_DATA_DIR, "audit")), "nessun file di audit");
});

test("configurazione non valida: nessuna chiamata, nessun DB, il motivo nell'esito", async () => {
  let n = 0;
  const dip: Partial<DipendenzeGiro> = {
    config: () => ({ stato: "non_valida", motivo: "VULCAN_URL deve essere https" }),
    db: () => {
      n++;
      return nuovoDb();
    },
    chiama: async () => {
      n++;
      return PING_OK;
    },
  };
  const e = await giroCoda(dip);
  assert.deepEqual(e, { esito: "non_valida", dettaglio: "VULCAN_URL deve essere https" });
  assert.equal((await battito(dip)).esito, "non_valida");
  assert.equal(n, 0);
});

test("cliente non presente su questa istanza: non_valida, nessuna chiamata", async () => {
  const b = banco();
  b.dip.tenant = () => null;
  const e = await giroCoda(b.dip);
  assert.equal(e.esito, "non_valida");
  assert.match(e.dettaglio, /cliente non presente su questa istanza/);
  assert.equal(b.chiamate.length, 0);
});

test("decidi: la tabella degli esiti del contratto", () => {
  const atteso: [number, string][] = [
    [200, "inviato"], [201, "inviato"],
    [400, "scarta"], [404, "scarta"], [413, "scarta"], [422, "scarta"], [301, "scarta"], [302, "scarta"], [307, "scarta"],
    [401, "sospendi"], [403, "sospendi"], [409, "sospendi"],
    [503, "ritenta"], [500, "ritenta"], [502, "ritenta"], [504, "ritenta"], [429, "ritenta"], [408, "ritenta"], [0, "ritenta"],
  ];
  for (const [s, d] of atteso) assert.equal(decidi(s), d, `stato ${s}`);
});

test("201 → inviato col report_id; ping solo al primo giro, poi dopo 24 ore", async () => {
  const b = banco();
  const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 15 });
  const e = await giroCoda(b.dip);
  assert.equal(e.esito, "ok");
  assert.equal(e.inviati, 1);
  assert.equal(ping(b).length, 1);
  assert.equal(b.chiamate[0].percorso, "/api/ipam/ping");
  assert.equal(b.chiamate[0].metodo, "GET");
  const inv = invii(b)[0];
  assert.equal(inv.percorso, "/api/ipam/ad-health");
  assert.equal(inv.metodo, "POST");
  assert.equal(inv.token, TOKEN);
  assert.equal(inv.versione, "0.9.870");
  assert.equal(zlib.gunzipSync(inv.corpoGz as Buffer).toString("utf8"), JSON_AD());
  const r = riga(b.db, id);
  assert.equal(r.stato, "inviato");
  assert.equal(r.risposta_id, "272");
  assert.equal(r.corpo, 0, "il corpo non resta sul disco");
  assert.deepEqual(ultimoInviato(b.db, "ad-health")?.risposta_id, "272");
  const sha = crypto.createHash("sha256").update(JSON_AD()).digest("hex");
  assert.deepEqual(b.audit, [{ azione: "invio", tipo: "ad-health", http: 201, byte: Buffer.byteLength(JSON_AD()), oggetti: 15, sha: sha.slice(0, 12), risposta_id: "272" }]);
  assert.equal(leggiStatoVulcan(b.db).ping_esito, "ok");

  b.orologio.avanza(3600);
  await giroCoda(b.dip);
  assert.equal(ping(b).length, 1, "entro 24 ore niente ping");
  b.orologio.avanza(25 * 3600);
  await giroCoda(b.dip);
  assert.equal(ping(b).length, 2, "dopo 24 ore il ping torna");
  auditPulito(b.audit);
});

test("200 doppione → inviato con lo stesso report_id; inventario 201 → inventario_id", async () => {
  const b = banco();
  b.risposta.invio = (r) =>
    r.percorso === "/api/ipam/inventario"
      ? { status: 201, body: '{"inventario_id":41,"oggetti":351}' }
      : { status: 200, body: '{"report_id":272,"doppione":true}' };
  const a = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 15 });
  const i = accoda(b.db, { tipo: "inventario", rif: null, json: '{"schema_versione":1}', oggetti: 351 });
  const e = await giroCoda(b.dip);
  assert.equal(e.inviati, 2);
  assert.equal(riga(b.db, a.id).stato, "inviato");
  assert.equal(riga(b.db, a.id).risposta_id, "272");
  assert.equal(riga(b.db, i.id).risposta_id, "41");
  assert.equal(b.audit.map((x) => x.http).join(","), "200,201");
});

test("risposta 2xx senza id numerico: inviato, risposta_id null (niente testo dell'hub)", async () => {
  const b = banco();
  b.risposta.invio = () => ({ status: 201, body: '{"report_id":"<script>"}' });
  const a = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  await giroCoda(b.dip);
  assert.equal(riga(b.db, a.id).stato, "inviato");
  assert.equal(riga(b.db, a.id).risposta_id, null);
});

test("503 tre volte → tentativi 3, ancora in attesa; dodici → fallito, una riga d'audit", async () => {
  const b = banco();
  b.risposta.invio = () => ({ status: 503, body: '{"error":"ricezione da DA-IPAM spenta (ipam.ingest)"}' });
  const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  for (let k = 0; k < 3; k++) {
    const e = await giroCoda(b.dip);
    assert.equal(e.esito, "errore");
    b.orologio.avanza(86_401);
  }
  let r = riga(b.db, id);
  assert.equal(r.stato, "in_attesa");
  assert.equal(r.tentativi, 3);
  assert.equal(r.ultimo_esito, "http_503");
  assert.ok(r.ultimo_errore && !r.ultimo_errore.includes("ipam.ingest"), "frasi nostre, mai il testo dell'hub");
  assert.equal(b.audit.length, 0, "un ritentativo non va nell'audit");
  for (let k = 3; k < MAX_TENTATIVI; k++) {
    await giroCoda(b.dip);
    b.orologio.avanza(86_401);
  }
  r = riga(b.db, id);
  assert.equal(r.stato, "fallito");
  assert.equal(r.tentativi, MAX_TENTATIVI);
  assert.deepEqual(b.audit.map((a) => a.azione), ["fallito"]);
  const prima = invii(b).length;
  await giroCoda(b.dip);
  assert.equal(invii(b).length, prima, "un fallito non riparte da solo");
});

test("errori di trasporto → ritenta con l'esito rete|tempo|cert|risposta", async () => {
  for (const tipo of ["rete", "tempo", "cert", "risposta"] as const) {
    const b = banco();
    b.risposta.invio = () => {
      throw new ErroreHub(tipo, `messaggio ${tipo}`);
    };
    const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
    await giroCoda(b.dip);
    const r = riga(b.db, id);
    assert.equal(r.stato, "in_attesa");
    assert.equal(r.tentativi, 1);
    assert.equal(r.ultimo_esito, tipo);
  }
});

test("400, 413, 422 e 3xx → scartato al primo colpo, con audit", async () => {
  for (const status of [400, 413, 422, 302]) {
    const b = banco();
    b.risposta.invio = () => ({ status, body: '{"error":"testo dell\'hub"}' });
    const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
    await giroCoda(b.dip);
    const r = riga(b.db, id);
    assert.equal(r.stato, "scartato", `stato ${status}`);
    assert.equal(r.tentativi, 0);
    assert.equal(r.ultimo_esito, `http_${status}`);
    assert.ok(!r.ultimo_errore?.includes("testo dell'hub"));
    assert.equal(r.corpo, 0);
    assert.deepEqual(b.audit.map((a) => [a.azione, a.http]), [["scarto", status]]);
    auditPulito(b.audit);
  }
});

test("caso 4: 404 sull'inventario → scartato con un motivo leggibile", async () => {
  const b = banco();
  b.risposta.invio = () => ({ status: 404, body: "Not Found" });
  const { id } = accoda(b.db, { tipo: "inventario", rif: null, json: '{"schema_versione":1}', oggetti: 351 });
  await giroCoda(b.dip);
  const r = riga(b.db, id);
  assert.equal(r.stato, "scartato");
  assert.match(r.ultimo_errore ?? "", /l'hub non riceve ancora l'inventario/);
  assert.match(ultimoErrore(b.db)?.errore ?? "", /non riceve ancora l'inventario/);
});

test("caso 5: 401/403/409 su un invio → sospeso, riga in attesa coi tentativi invariati; poi nessuna chiamata", async () => {
  for (const status of [401, 403, 409]) {
    const b = banco();
    b.risposta.invio = () => ({ status, body: "{}" });
    const a = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(8), oggetti: 1 });
    const c = accoda(b.db, { tipo: "ad-health", rif: "9", json: JSON_AD(9), oggetti: 1 });
    const e = await giroCoda(b.dip);
    assert.equal(e.esito, "sospeso", `stato ${status}`);
    assert.equal(invii(b).length, 1, "ci si ferma al primo rifiuto");
    for (const id of [a.id, c.id]) {
      const r = riga(b.db, id);
      assert.equal(r.stato, "in_attesa");
      assert.equal(r.tentativi, 0);
      assert.equal(r.preso_fino, null, "rilasciate subito, anche quella non tentata");
    }
    const st = leggiStatoVulcan(b.db);
    assert.equal(st.sospeso_gettone, improntaDelGettone(TOKEN));
    assert.ok(st.sospeso_motivo && !st.sospeso_motivo.includes(TOKEN));
    assert.deepEqual(b.audit.map((x) => [x.azione, x.http]), [["sospeso", status]]);

    const prima = b.chiamate.length;
    b.orologio.avanza(30 * 3600);
    assert.equal((await giroCoda(b.dip)).esito, "sospeso");
    assert.equal((await battito(b.dip)).esito, "sospeso");
    assert.equal(b.chiamate.length, prima, "sospeso: nessuna chiamata, nemmeno il ping o il battito");
    assert.equal(b.audit.length, 1, "la sospensione si registra una volta");
  }
});

test("caso 5: gettone cambiato in oggetto.env → la sospensione si toglie, ping e invio ripartono", async () => {
  const b = banco();
  b.risposta.invio = () => ({ status: 401, body: "{}" });
  const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  await giroCoda(b.dip);
  assert.equal(riga(b.db, id).stato, "in_attesa");
  b.config.c = pronta(TOKEN_2);
  b.risposta.invio = () => ({ status: 201, body: '{"report_id":5}' });
  const e = await giroCoda(b.dip);
  assert.equal(e.esito, "ok");
  assert.equal(ping(b).length, 2, "gettone nuovo = ping nuovo");
  assert.equal(invii(b).at(-1)?.token, TOKEN_2);
  assert.equal(riga(b.db, id).stato, "inviato");
  const st = leggiStatoVulcan(b.db);
  assert.equal(st.sospeso_gettone, null);
  assert.equal(st.sospeso_motivo, null);
});

test("caso 5: ping con un codcli diverso → sospeso, niente invii", async () => {
  const b = banco();
  b.risposta.ping = () => ({ status: 200, body: '{"fonte_id":4,"codcli":"12345","nodo":"12345-ipam"}' });
  const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  const e = await giroCoda(b.dip);
  assert.equal(e.esito, "sospeso");
  assert.match(e.dettaglio, /il gettone è di un altro cliente/);
  assert.ok(!e.dettaglio.includes("12345"));
  assert.equal(invii(b).length, 0);
  assert.equal(riga(b.db, id).tentativi, 0);
  assert.equal(leggiStatoVulcan(b.db).sospeso_gettone, improntaDelGettone(TOKEN));
});

test("ping 401 o 403 → sospeso; ping illeggibile o 404 → errore senza invii e senza sospensione", async () => {
  for (const status of [401, 403]) {
    const b = banco();
    b.risposta.ping = () => ({ status, body: "{}" });
    accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
    assert.equal((await giroCoda(b.dip)).esito, "sospeso");
    assert.equal(invii(b).length, 0);
  }
  for (const r of [{ status: 200, body: "non json" }, { status: 404, body: "" }]) {
    const b = banco();
    b.risposta.ping = () => r;
    const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
    assert.equal((await giroCoda(b.dip)).esito, "errore");
    assert.equal(invii(b).length, 0);
    assert.equal(riga(b.db, id).tentativi, 0);
    assert.equal(leggiStatoVulcan(b.db).sospeso_gettone, null);
  }
});

test("caso 3: ping 503 (hub spento) → si prosegue, le righe prendono 503 e il backoff", async () => {
  const b = banco();
  b.risposta.ping = () => ({ status: 503, body: "{}" });
  b.risposta.invio = () => ({ status: 503, body: "{}" });
  const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  await giroCoda(b.dip);
  assert.equal(leggiStatoVulcan(b.db).ping_esito, "spento_hub");
  assert.equal(riga(b.db, id).tentativi, 1);
  assert.equal(riga(b.db, id).stato, "in_attesa");
});

test("ping per errore di rete → errore, nessuna riga toccata", async () => {
  const b = banco();
  b.risposta.ping = () => {
    throw new ErroreHub("rete", "hub DA-Vul-can non raggiungibile: nome non risolto");
  };
  const { id } = accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  const e = await giroCoda(b.dip);
  assert.equal(e.esito, "errore");
  assert.match(e.dettaglio, /nome non risolto/);
  assert.equal(riga(b.db, id).tentativi, 0);
  assert.equal(leggiStatoVulcan(b.db).ping_esito, "rete");
});

test("al massimo 20 invii per giro", async () => {
  const b = banco();
  for (let k = 0; k < 25; k++) accoda(b.db, { tipo: "ad-health", rif: String(k), json: JSON_AD(k), oggetti: 1 });
  assert.equal((await giroCoda(b.dip)).inviati, 20);
  assert.equal((await giroCoda(b.dip)).inviati, 5);
});

test("due giroCoda in parallelo: ogni riga inviata una volta sola", async () => {
  const b = banco();
  const lenta = b.dip.chiama as DipendenzeGiro["chiama"];
  b.dip.chiama = async (r) => {
    await new Promise((ok) => setTimeout(ok, 5));
    return lenta(r);
  };
  for (let k = 0; k < 6; k++) accoda(b.db, { tipo: "ad-health", rif: String(k), json: JSON_AD(k), oggetti: 1 });
  const [x, y] = await Promise.all([giroCoda(b.dip), giroCoda(b.dip)]);
  assert.equal((x.inviati ?? 0) + (y.inviati ?? 0), 6);
  const corpi = invii(b).map((c) => zlib.gunzipSync(c.corpoGz as Buffer).toString("utf8"));
  assert.equal(new Set(corpi).size, 6);
  assert.equal(corpi.length, 6);
});

test("battito: la forma esatta del contratto, validata con lo schema dell'hub; della risposta non si legge niente", async () => {
  const b = banco();
  ensureAdHealthSchema(b.db);
  b.db.pragma("foreign_keys = OFF"); // le esecuzioni senza integrazione AD: qui conta solo la loro data
  const run = b.db.prepare(
    "INSERT INTO ad_health_runs (integration_id, started_at, finished_at, status, engine_version) VALUES (1, ?, ?, ?, 'v1')",
  );
  run.run("2026-10-20T08:00:00.000Z", "2026-10-20T08:05:00.000Z", "ok");
  run.run("2026-10-21T08:00:00.000Z", "2026-10-21T08:03:00.000Z", "error");
  run.run("2026-10-22T08:00:00.000Z", null, "running");
  const i = accoda(b.db, { tipo: "inventario", rif: null, json: '{"schema_versione":1}', oggetti: 351 });
  b.db.prepare("UPDATE vulcan_coda SET stato = 'inviato', inviato_il = '2026-10-22 03:00:05', corpo_gz = zeroblob(0) WHERE id = ?").run(i.id);
  accoda(b.db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 1 });
  const f = accoda(b.db, { tipo: "ad-health", rif: "9", json: JSON_AD(9), oggetti: 1 });
  b.db.prepare("UPDATE vulcan_coda SET stato = 'fallito' WHERE id = ?").run(f.id);
  // Una risposta che prova a dare istruzioni: si ignora.
  b.risposta.battito = () => ({ status: 200, body: '{"ricevuto_il":"x","sospendi":true,"nuovo_url":"https://altro"}' });

  const e = await battito(b.dip);
  assert.equal(e.esito, "ok");
  const c = b.chiamate.find((x) => x.percorso === "/api/ipam/heartbeat");
  assert.ok(c);
  assert.equal(c.metodo, "POST");
  const corpo = JSON.parse(zlib.gunzipSync(c.corpoGz as Buffer).toString("utf8")) as Record<string, unknown>;
  const p = BattitoHub.safeParse(corpo);
  assert.ok(p.success, JSON.stringify(p.error?.issues));
  assert.deepEqual(corpo, {
    versione: "0.9.870",
    generato_il: b.orologio.t.toISOString(),
    ad: { ultima_esecuzione: "2026-10-20T08:05:00.000Z", esito: "error" },
    inventario: { ultimo_invio: "2026-10-22T03:00:05.000Z", oggetti: 351 },
    coda: { in_attesa: 1, falliti: 1 },
  });
  assert.deepEqual(Object.keys(corpo), ["versione", "generato_il", "ad", "inventario", "coda"]);
  const st = leggiStatoVulcan(b.db);
  assert.equal(st.battito_esito, "ok");
  assert.ok(st.battito_il);
  assert.equal(st.sospeso_gettone, null, "la risposta non cambia niente");
});

test("battito senza AD né inventari: null e zero (oggetti non è nullable sull'hub)", async () => {
  const b = banco();
  await battito(b.dip);
  const c = b.chiamate.find((x) => x.percorso === "/api/ipam/heartbeat");
  const corpo = JSON.parse(zlib.gunzipSync(c?.corpoGz as Buffer).toString("utf8")) as Record<string, unknown>;
  assert.ok(BattitoHub.safeParse(corpo).success);
  assert.deepEqual(corpo.ad, { ultima_esecuzione: null, esito: null });
  assert.deepEqual(corpo.inventario, { ultimo_invio: null, oggetti: 0 });
});

test("battito: 503 → spento_hub, 422 → errore, 401 → sospeso", async () => {
  const b = banco();
  b.risposta.battito = () => ({ status: 503, body: "{}" });
  assert.equal((await battito(b.dip)).esito, "errore");
  assert.equal(leggiStatoVulcan(b.db).battito_esito, "spento_hub");
  b.risposta.battito = () => ({ status: 422, body: "{}" });
  await battito(b.dip);
  assert.equal(leggiStatoVulcan(b.db).battito_esito, "http_422");
  b.risposta.battito = () => ({ status: 401, body: "{}" });
  assert.equal((await battito(b.dip)).esito, "sospeso");
  assert.equal(leggiStatoVulcan(b.db).sospeso_gettone, improntaDelGettone(TOKEN));
});

test("accodaInventario: accodato, poi doppione con gli stessi dati e la stessa ora", async () => {
  const b = banco();
  assert.equal(await accodaInventario(b.dip), "accodato");
  assert.equal(await accodaInventario(b.dip), "doppione");
  const r = b.db.prepare("SELECT tipo, oggetti, stato FROM vulcan_coda").all();
  assert.deepEqual(r, [{ tipo: "inventario", oggetti: 0, stato: "in_attesa" }]);
  assert.equal(b.chiamate.length, 0, "accodare non chiama la rete");
});

test("accodaInventario: costruttore che fallisce → riga scartata col motivo, «ultimo errore» la mostra", async () => {
  const b = banco();
  b.dip.inventario = () => {
    throw new Error("tabella hosts illeggibile");
  };
  assert.equal(await accodaInventario(b.dip), "errore");
  const r = b.db.prepare("SELECT tipo, stato, length(corpo_gz) AS corpo, ultimo_errore FROM vulcan_coda").all();
  assert.deepEqual(r, [{ tipo: "inventario", stato: "scartato", corpo: 0, ultimo_errore: "inventario non costruito: tabella hosts illeggibile" }]);
  assert.match(ultimoErrore(b.db)?.errore ?? "", /inventario non costruito/);
  // Un secondo errore uguale un altro giorno: un'altra riga, nessun vincolo violato.
  b.orologio.avanza(86_400);
  assert.equal(await accodaInventario(b.dip), "errore");
  assert.equal((b.db.prepare("SELECT COUNT(*) AS n FROM vulcan_coda").get() as { n: number }).n, 2);
});

test("sul bordo: hub finto HTTPS, gettone e gzip veri, audit su file senza gettone, URL o IP", async () => {
  const c = certificatoDiProva("localhost");
  const visti: { percorso: string; auth: string; testo: string }[] = [];
  const srv = createServer({ key: c.key, cert: c.cert }, (req, res) => {
    const pezzi: Buffer[] = [];
    req.on("data", (d: Buffer) => pezzi.push(d));
    req.on("end", () => {
      const grezzo = Buffer.concat(pezzi);
      const testo = req.headers["content-encoding"] === "gzip" ? zlib.gunzipSync(grezzo).toString("utf8") : grezzo.toString("utf8");
      visti.push({ percorso: req.url ?? "", auth: String(req.headers.authorization ?? ""), testo });
      res.writeHead(req.url === "/api/ipam/ping" ? 200 : 201, { "Content-Type": "application/json" });
      res.end(req.url === "/api/ipam/ping" ? PING_OK.body : '{"report_id":99}');
    });
  });
  aperti.push(srv);
  await new Promise<void>((ok) => srv.listen(0, ok));
  const { port } = srv.address() as AddressInfo;

  const db = nuovoDb();
  const { id } = accoda(db, { tipo: "ad-health", rif: "8", json: JSON_AD(), oggetti: 15 });
  const config = pronta(TOKEN, `https://localhost:${port}`);
  const righeLog: string[] = [];
  const [w, er] = [console.warn, console.error];
  console.warn = (...a: unknown[]) => void righeLog.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void righeLog.push(a.map(String).join(" "));
  try {
    const e = await giroCoda({
      config: () => config,
      tenant: () => "70791",
      db: () => db,
      ora: () => new Date(Date.now() + 5_000),
      versione: () => "0.9.870",
      chiama: (r) => chiamaHub({ ...r, ca: c.cert }),
    });
    assert.equal(e.esito, "ok");
  } finally {
    console.warn = w;
    console.error = er;
  }
  assert.deepEqual(visti.map((v) => v.percorso), ["/api/ipam/ping", "/api/ipam/ad-health"]);
  assert.ok(visti.every((v) => v.auth === `Bearer ${TOKEN}`));
  assert.equal(visti[1].testo, JSON_AD());
  const sha = crypto.createHash("sha256").update(visti[1].testo).digest("hex");
  assert.equal((db.prepare("SELECT sha256 FROM vulcan_coda WHERE id = ?").get(id) as { sha256: string }).sha256, sha);
  assert.equal(riga(db, id).risposta_id, "99");

  const dir = path.join(TEST_DATA_DIR, "audit");
  const file = fs.readdirSync(dir).filter((f) => f.startsWith("invii-vulcan-"));
  assert.equal(file.length, 1);
  const testo = fs.readFileSync(path.join(dir, file[0]), "utf8");
  assert.match(testo, /"azione":"invio"/);
  for (const t of [testo, ...righeLog]) {
    assert.ok(!t.includes(TOKEN), "gettone");
    assert.ok(!t.includes("localhost") && !t.includes(String(port)) && !t.includes("https://"), "URL o porta");
    assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t), "IP");
  }
});

test("revisione: un giro lento si ferma prima che scada la presa; il secondo giro non rimanda le righe del primo", async () => {
  const b = banco();
  for (let k = 0; k < 12; k++) accoda(b.db, { tipo: "ad-health", rif: String(k), json: JSON_AD(k), oggetti: 1 });
  await giroCoda({ ...b.dip, chiama: async (r) => (r.percorso === "/api/ipam/ping" ? PING_OK : { status: 503, body: "" }) });
  // Tutte di nuovo scadute; ora l'hub è lento: ogni invio dura 60 s finti (il massimo del trasporto).
  b.orologio.avanza(86_401);
  const inizio = b.orologio.t.getTime();
  let secondo: Promise<unknown> | null = null;
  const veloce = b.dip.chiama as DipendenzeGiro["chiama"];
  b.dip.chiama = async (r) => {
    const x = await veloce(r);
    if (r.percorso === "/api/ipam/ad-health") {
      b.orologio.avanza(60);
      // Scaduta la presa del primo giro (10 minuti), ne parte un altro mentre il primo è ancora aperto.
      if (!secondo && b.orologio.t.getTime() - inizio >= 10 * 60_000) secondo = giroCoda({ ...b.dip, chiama: veloce });
    }
    return x;
  };
  const primo = (await giroCoda(b.dip)) as { inviati?: number; dettaglio: string };
  if (!secondo) {
    // Il primo si è fermato prima: il secondo parte adesso, a presa scaduta.
    b.orologio.t = new Date(inizio + 10 * 60_000);
    secondo = giroCoda({ ...b.dip, chiama: veloce });
  }
  await secondo;
  const corpi = invii(b).map((c) => zlib.gunzipSync(c.corpoGz as Buffer).toString("utf8"));
  assert.equal(new Set(corpi).size, 12, "tutte inviate");
  assert.equal(corpi.length, 12, "nessuna riga inviata due volte");
  assert.equal(primo.inviati, 9, "il primo giro si ferma a 8 minuti dall'inizio");
  assert.match(primo.dettaglio, /3 rimandate al giro dopo/);
  const stati = b.db.prepare("SELECT stato, tentativi FROM vulcan_coda ORDER BY id").all() as { stato: string; tentativi: number }[];
  assert.ok(stati.every((s) => s.stato === "inviato" && s.tentativi === 1), JSON.stringify(stati));
});

test("revisione: inventario costruito ma non accodato → motivo distinto col codice", async () => {
  const b = banco();
  b.db.exec("CREATE TRIGGER blocca BEFORE INSERT ON vulcan_coda WHEN NEW.stato = 'in_attesa' BEGIN SELECT RAISE(ABORT, 'bloccato'); END");
  assert.equal(await accodaInventario(b.dip), "errore");
  const r = b.db.prepare("SELECT stato, ultimo_errore FROM vulcan_coda").all();
  assert.deepEqual(r, [{ stato: "scartato", ultimo_errore: "inventario costruito, non accodato: SQLITE_CONSTRAINT_TRIGGER" }]);
});

test("revisione: scarto di una riga superata nel frattempo → nessuna riga d'audit", async () => {
  const b = banco();
  const vecchio = accoda(b.db, { tipo: "inventario", rif: null, json: '{"schema_versione":1,"n":1}', oggetti: 1 });
  b.risposta.invio = () => {
    // Mentre la vecchia fotografia viaggia ne arriva una nuova: la vecchia diventa `superato`.
    accoda(b.db, { tipo: "inventario", rif: null, json: '{"schema_versione":1,"n":2}', oggetti: 2 });
    return { status: 422, body: "{}" };
  };
  await giroCoda({ ...b.dip, chiama: async (r) => (r.percorso === "/api/ipam/ping" ? PING_OK : b.risposta.invio(r)) });
  assert.equal(riga(b.db, vecchio.id).stato, "superato");
  assert.deepEqual(b.audit, [], "nessuno scarto registrato per una riga che non è stata scartata");
});
