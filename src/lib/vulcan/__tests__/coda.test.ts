/**
 * A-IPAM, Task 2: la coda degli invii verso DA-Vul-can (modello `upload_queue.py`
 * della sonda): doppione locale per sha256, l'inventario più nuovo sostituisce quello
 * in attesa (caso 4 del piano), backoff fino a 12 tentativi poi `fallito`, presa in
 * carico di 10 minuti contro i doppi invii, «Invia ora» che rimette i falliti.
 *
 * Date nella forma di SQLite ('YYYY-MM-DD HH:MM:SS'): il confronto è fra stringhe.
 *
 * Cartella dati isolata: `support/data-dir-isolata` va importato PER PRIMO.
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { migrateVulcanCoda } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import {
  BACKOFF_S,
  MAX_TENTATIVI,
  PRESA_MIN,
  accoda,
  conteggiCoda,
  leggiStatoVulcan,
  prendiProssimi,
  puliziaCoda,
  rilascia,
  rimettiFalliti,
  scriviStatoVulcan,
  segnaInviato,
  segnaRitento,
  segnaScartato,
  ultimoErrore,
  ultimoInviato,
} from "../coda";

function nuovoDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateVulcanCoda(db);
  return db;
}

const T0 = new Date("2026-10-22T08:00:00.000Z");
const piu = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const sql = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

type Riga = { stato: string; tentativi: number; prossimo_tentativo: string; preso_fino: string | null; corpo: number };
function riga(db: Database.Database, id: number): Riga {
  return db
    .prepare("SELECT stato, tentativi, prossimo_tentativo, preso_fino, length(corpo_gz) AS corpo FROM vulcan_coda WHERE id = ?")
    .get(id) as Riga;
}
/** Una riga accodata e resa subito prendibile all'ora simulata T0. */
function accodaA(db: Database.Database, json: string, tipo: "ad-health" | "inventario" = "ad-health", rif: string | null = "8") {
  const r = accoda(db, { tipo, rif, json, oggetti: 3 });
  db.prepare("UPDATE vulcan_coda SET prossimo_tentativo = ? WHERE id = ?").run(sql(T0), r.id);
  return r;
}

test("costanti come upload_queue.py", () => {
  assert.deepEqual([...BACKOFF_S], [1, 5, 30, 120, 600, 1800, 3600, 7200, 14400, 28800, 57600, 86400]);
  assert.equal(MAX_TENTATIVI, 12);
  assert.equal(PRESA_MIN, 10);
});

test("accoda: corpo gzip del JSON, sha256 del JSON non compresso, byte e oggetti", () => {
  const db = nuovoDb();
  const json = JSON.stringify({ run_id: 8, findings: ["à"] });
  const r = accoda(db, { tipo: "ad-health", rif: "8", json, oggetti: 3 });
  assert.equal(r.nuovo, true);
  const x = db.prepare("SELECT * FROM vulcan_coda WHERE id = ?").get(r.id) as {
    corpo_gz: Buffer; sha256: string; byte_json: number; oggetti: number; stato: string; tipo: string; rif: string;
  };
  assert.equal(zlib.gunzipSync(x.corpo_gz).toString("utf8"), json);
  assert.equal(x.sha256, crypto.createHash("sha256").update(json, "utf8").digest("hex"));
  assert.equal(x.byte_json, Buffer.byteLength(json, "utf8"));
  assert.equal(x.oggetti, 3);
  assert.equal(x.stato, "in_attesa");
  assert.equal(x.rif, "8");
});

test("accoda due volte lo stesso JSON → una riga sola (doppione locale)", () => {
  const db = nuovoDb();
  const a = accoda(db, { tipo: "ad-health", rif: "8", json: '{"a":1}', oggetti: null });
  const b = accoda(db, { tipo: "ad-health", rif: "8", json: '{"a":1}', oggetti: null });
  assert.deepEqual(b, { id: a.id, nuovo: false });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vulcan_coda").get() as { n: number }).n, 1);
});

test("due inventari → il primo diventa superato e perde il corpo; l'AD in attesa non si tocca", () => {
  const db = nuovoDb();
  const ad = accoda(db, { tipo: "ad-health", rif: "8", json: '{"ad":1}', oggetti: 1 });
  const i1 = accoda(db, { tipo: "inventario", rif: null, json: '{"inv":1}', oggetti: 10 });
  const i2 = accoda(db, { tipo: "inventario", rif: null, json: '{"inv":2}', oggetti: 11 });
  assert.equal(riga(db, i1.id).stato, "superato");
  assert.equal(riga(db, i1.id).corpo, 0);
  assert.equal(riga(db, i2.id).stato, "in_attesa");
  assert.equal(riga(db, ad.id).stato, "in_attesa");
});

test("tipo fuori dal CHECK → errore, nessuna riga", () => {
  const db = nuovoDb();
  assert.throws(() => accoda(db, { tipo: "altro" as "inventario", rif: null, json: "{}", oggetti: null }));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vulcan_coda").get() as { n: number }).n, 0);
});

test("prendiProssimi due volte di fila → la seconda vuota; dopo 10 minuti la riga torna", () => {
  const db = nuovoDb();
  const r = accodaA(db, '{"a":1}');
  const prima = prendiProssimi(db, 5, T0);
  assert.equal(prima.length, 1);
  assert.equal(prima[0].id, r.id);
  assert.ok(Buffer.isBuffer(prima[0].corpo_gz));
  assert.equal(riga(db, r.id).preso_fino, sql(piu(T0, PRESA_MIN * 60)));
  assert.deepEqual(prendiProssimi(db, 5, piu(T0, 60)), []);
  assert.deepEqual(prendiProssimi(db, 5, piu(T0, PRESA_MIN * 60 - 1)), []);
  assert.equal(prendiProssimi(db, 5, piu(T0, PRESA_MIN * 60)).length, 1);
});

test("prendiProssimi: non prende le righe non scadute, rispetta max, salta inviati e falliti", () => {
  const db = nuovoDb();
  const a = accodaA(db, '{"a":1}');
  const b = accodaA(db, '{"b":1}');
  accodaA(db, '{"c":1}');
  db.prepare("UPDATE vulcan_coda SET prossimo_tentativo = ? WHERE id = ?").run(sql(piu(T0, 60)), b.id);
  segnaInviato(db, a.id, "272", T0);
  const presi = prendiProssimi(db, 1, T0);
  assert.equal(presi.length, 1);
  assert.notEqual(presi[0].id, a.id);
  assert.notEqual(presi[0].id, b.id);
});

test("backoff: dopo 1 e 2 ritenti 1 s e 5 s; al 12° fallito", () => {
  const db = nuovoDb();
  const { id } = accodaA(db, '{"a":1}');
  assert.equal(segnaRitento(db, id, "http 503", "hub spento", T0), "in_attesa");
  assert.equal(riga(db, id).prossimo_tentativo, sql(piu(T0, 1)));
  assert.equal(riga(db, id).preso_fino, null);
  assert.equal(segnaRitento(db, id, "http 503", "hub spento", T0), "in_attesa");
  assert.equal(riga(db, id).prossimo_tentativo, sql(piu(T0, 5)));
  for (let k = 3; k <= 11; k++) {
    assert.equal(segnaRitento(db, id, "rete", "rete non raggiungibile", T0), "in_attesa");
    assert.equal(riga(db, id).prossimo_tentativo, sql(piu(T0, BACKOFF_S[k - 1])));
  }
  assert.equal(segnaRitento(db, id, "tempo", "tempo scaduto", T0), "fallito");
  assert.equal(riga(db, id).stato, "fallito");
  assert.equal(riga(db, id).tentativi, 12);
  assert.deepEqual(prendiProssimi(db, 5, piu(T0, 10 * 86400)), []);
});

test("rilascia: torna prendibile senza contare un tentativo", () => {
  const db = nuovoDb();
  const { id } = accodaA(db, '{"a":1}');
  prendiProssimi(db, 5, T0);
  rilascia(db, id);
  assert.equal(riga(db, id).tentativi, 0);
  assert.equal(riga(db, id).preso_fino, null);
  assert.equal(prendiProssimi(db, 5, T0).length, 1);
});

test("rimettiFalliti: fallito → in_attesa con tentativi a zero; gli altri stati no", () => {
  const db = nuovoDb();
  const f = accodaA(db, '{"f":1}');
  const s = accodaA(db, '{"s":1}');
  for (let k = 0; k < MAX_TENTATIVI; k++) segnaRitento(db, f.id, "http 503", "hub spento", T0);
  segnaScartato(db, s.id, "http 404", "rotta assente sull'hub", T0);
  assert.equal(rimettiFalliti(db), 1);
  assert.equal(riga(db, f.id).stato, "in_attesa");
  assert.equal(riga(db, f.id).tentativi, 0);
  assert.equal(riga(db, s.id).stato, "scartato");
  assert.equal(prendiProssimi(db, 5, new Date()).map((r) => r.id).includes(f.id), true);
});

test("segnaInviato svuota il corpo e scrive risposta e ora; ultimoInviato lo rende", () => {
  const db = nuovoDb();
  const { id } = accodaA(db, '{"a":1}');
  assert.equal(ultimoInviato(db, "ad-health"), null);
  segnaInviato(db, id, "272", T0);
  assert.equal(riga(db, id).stato, "inviato");
  assert.equal(riga(db, id).corpo, 0);
  assert.deepEqual(ultimoInviato(db, "ad-health"), { inviato_il: sql(T0), oggetti: 3, risposta_id: "272" });
  assert.equal(ultimoInviato(db, "inventario"), null);
});

test("segnaScartato svuota il corpo; conteggi e ultimo errore", () => {
  const db = nuovoDb();
  const a = accodaA(db, '{"a":1}');
  const b = accodaA(db, '{"b":1}', "inventario", null);
  const c = accodaA(db, '{"c":1}');
  segnaScartato(db, b.id, "http 404", "rotta dell'inventario assente sull'hub", piu(T0, 10));
  for (let k = 0; k < MAX_TENTATIVI; k++) segnaRitento(db, c.id, "http 503", "hub spento", T0);
  assert.equal(riga(db, b.id).corpo, 0);
  assert.equal(riga(db, a.id).stato, "in_attesa");
  const n = conteggiCoda(db, piu(T0, 60));
  assert.deepEqual(n, { in_attesa: 1, falliti: 1, scartati_7g: 1 });
  assert.deepEqual(conteggiCoda(db, piu(T0, 8 * 86400)).scartati_7g, 0);
  assert.deepEqual(ultimoErrore(db), {
    quando: sql(piu(T0, 10)),
    tipo: "inventario",
    esito: "http 404",
    errore: "rotta dell'inventario assente sull'hub",
  });
});

test("puliziaCoda: via inviati/scartati/superati oltre 90 giorni, le in_attesa vecchie restano", () => {
  const db = nuovoDb();
  const vecchia = accodaA(db, '{"v":1}');
  const inv = accodaA(db, '{"i":1}');
  const recente = accodaA(db, '{"r":1}');
  db.prepare("UPDATE vulcan_coda SET creato_il = ? WHERE id = ?").run(sql(piu(T0, -200 * 86400)), vecchia.id);
  segnaInviato(db, inv.id, "1", piu(T0, -100 * 86400));
  segnaInviato(db, recente.id, "2", piu(T0, -10 * 86400));
  assert.equal(puliziaCoda(db, T0), 1);
  const restano = (db.prepare("SELECT id FROM vulcan_coda ORDER BY id").all() as { id: number }[]).map((r) => r.id);
  assert.deepEqual(restano, [vecchia.id, recente.id]);
});

test("stato del flusso: riga unica, letture con i vuoti, scritture parziali", () => {
  const db = nuovoDb();
  const vuoto = leggiStatoVulcan(db);
  assert.equal(vuoto.battito_il, null);
  assert.equal(vuoto.sospeso_gettone, null);
  scriviStatoVulcan(db, { battito_il: sql(T0), battito_esito: "ok" });
  scriviStatoVulcan(db, { sospeso_gettone: "0123456789abcdef", sospeso_motivo: "gettone revocato (403)" });
  const s = leggiStatoVulcan(db);
  assert.equal(s.battito_il, sql(T0));
  assert.equal(s.battito_esito, "ok");
  assert.equal(s.sospeso_gettone, "0123456789abcdef");
  scriviStatoVulcan(db, { sospeso_gettone: null, sospeso_motivo: null });
  assert.equal(leggiStatoVulcan(db).sospeso_gettone, null);
  assert.equal(leggiStatoVulcan(db).battito_esito, "ok");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vulcan_stato").get() as { n: number }).n, 1);
});

test("scriviStatoVulcan rifiuta una chiave che non è una colonna (niente SQL composto da fuori)", () => {
  const db = nuovoDb();
  assert.throws(() => scriviStatoVulcan(db, { "x = 1; --": "y" } as never), /colonna/);
});

test("coda senza schema (migrazione fallita): accoda lo dice, non scrive a vuoto", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  assert.throws(() => accoda(db, { tipo: "ad-health", rif: "8", json: "{}", oggetti: null }), /vulcan_coda_v21/);
});

test("revisione: un inventario superato mentre era in invio non torna in attesa né scartato", () => {
  const db = nuovoDb();
  const a = accodaA(db, '{"inv":"A"}', "inventario", null);
  assert.equal(prendiProssimi(db, 5, T0).length, 1);
  accoda(db, { tipo: "inventario", rif: null, json: '{"inv":"B"}', oggetti: 1 });
  assert.equal(segnaRitento(db, a.id, "http 503", "hub spento", T0), "superato");
  assert.equal(riga(db, a.id).stato, "superato");
  assert.equal(riga(db, a.id).tentativi, 0);
  segnaScartato(db, a.id, "http 404", "rotta assente", T0);
  assert.equal(riga(db, a.id).stato, "superato");
  assert.equal(riga(db, a.id).corpo, 0);
});

test("revisione: un superato che l'hub ha comunque ricevuto si segna inviato (è arrivato davvero)", () => {
  const db = nuovoDb();
  const a = accodaA(db, '{"inv":"A"}', "inventario", null);
  accoda(db, { tipo: "inventario", rif: null, json: '{"inv":"B"}', oggetti: 1 });
  segnaInviato(db, a.id, "inv-1", T0);
  assert.equal(riga(db, a.id).stato, "inviato");
  assert.deepEqual(ultimoInviato(db, "inventario")?.risposta_id, "inv-1");
});

test("revisione: segnaInviato su una riga fallita o scartata non la cambia", () => {
  const db = nuovoDb();
  const s = accodaA(db, '{"s":1}');
  segnaScartato(db, s.id, "http 422", "corpo rifiutato", T0);
  segnaInviato(db, s.id, "x", T0);
  assert.equal(riga(db, s.id).stato, "scartato");
});

test("revisione: lo stesso JSON di una riga scartata si riaccoda (la riga rinasce in attesa, col corpo)", () => {
  const db = nuovoDb();
  const json = '{"run_id":8}';
  const a = accodaA(db, json);
  segnaScartato(db, a.id, "http 422", "corpo rifiutato", T0);
  const b = accoda(db, { tipo: "ad-health", rif: "8", json, oggetti: 3 });
  assert.deepEqual(b, { id: a.id, nuovo: true });
  const r = db.prepare("SELECT stato, tentativi, corpo_gz, ultimo_errore FROM vulcan_coda WHERE id = ?").get(a.id) as {
    stato: string; tentativi: number; corpo_gz: Buffer; ultimo_errore: string | null;
  };
  assert.equal(r.stato, "in_attesa");
  assert.equal(r.tentativi, 0);
  assert.equal(r.ultimo_errore, null);
  assert.equal(zlib.gunzipSync(r.corpo_gz).toString("utf8"), json);
  // Inviato o in attesa: resta doppione.
  segnaInviato(db, a.id, "272", T0);
  assert.deepEqual(accoda(db, { tipo: "ad-health", rif: "8", json, oggetti: 3 }), { id: a.id, nuovo: false });
});

test("revisione: scriviStatoVulcan ignora le chiavi con valore undefined", () => {
  const db = nuovoDb();
  scriviStatoVulcan(db, { battito_esito: "ok", ping_esito: "ok" });
  scriviStatoVulcan(db, { battito_esito: undefined, ping_esito: "http 503" });
  const s = leggiStatoVulcan(db);
  assert.equal(s.battito_esito, "ok");
  assert.equal(s.ping_esito, "http 503");
});
