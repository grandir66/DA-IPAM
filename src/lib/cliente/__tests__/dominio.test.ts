/**
 * Scheda Dominio: punteggio di rischio, rilievi, accessi delle ultime 24 ore.
 * Il database è in memoria, con le sole colonne che la scheda legge.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/dominio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { problemiDiAccesso, statoDominio, vociRilieviGravi } from "../schede/dominio";

function dbDiProva(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ad_health_runs (
      id INTEGER PRIMARY KEY,
      started_at TEXT,
      status TEXT,
      score_global INTEGER,
      score_stale INTEGER,
      score_privileged INTEGER,
      score_trust INTEGER,
      score_anomaly INTEGER
    );
    CREATE TABLE ad_health_findings (
      id INTEGER PRIMARY KEY,
      run_id INTEGER,
      severity TEXT,
      title TEXT,
      object_count INTEGER,
      sample_dns_json TEXT,
      rule_id TEXT
    );
    CREATE TABLE dc_evento (
      id INTEGER PRIMARY KEY,
      quando TEXT,
      event_id INTEGER,
      account TEXT,
      postazione TEXT,
      ip TEXT,
      motivo TEXT
    );
  `);
  return db;
}

function isoOreFa(ore: number): string {
  return new Date(Date.now() - ore * 3_600_000).toISOString();
}

test("nessun giro ok dà null; un solo giro recente non ha un mese fa", () => {
  const db = dbDiProva();
  assert.equal(statoDominio(db), null);
  db.prepare("INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (1, ?, 'error', null)").run(isoOreFa(1));
  assert.equal(statoDominio(db), null);

  db.prepare(
    "INSERT INTO ad_health_runs (id, started_at, status, score_global, score_stale, score_privileged, score_trust, score_anomaly) VALUES (2, ?, 'ok', 40, 10, NULL, 0, 40)",
  ).run(isoOreFa(2));
  const stato = statoDominio(db);
  assert.ok(stato);
  assert.equal(stato.punteggio, 40);
  assert.equal(stato.unMeseFa, null);
  assert.deepEqual(stato.aree.map((a) => a.nome), ["Account fermi", "Fiducie tra domini", "Anomalie"]);
  db.close();
});

test("un mese fa è il giro ok più recente fra quelli più vecchi di 25 giorni", () => {
  const db = dbDiProva();
  const run = db.prepare(
    "INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (?, ?, 'ok', ?)",
  );
  run.run(1, isoOreFa(24 * 40), 80);
  run.run(2, isoOreFa(24 * 26), 55);
  run.run(3, isoOreFa(2), 20);
  const stato = statoDominio(db);
  assert.equal(stato?.punteggio, 20);
  assert.equal(stato?.unMeseFa, 55);
  db.close();
});

test("i rilievi più gravi vengono prima e il nome è il CN", () => {
  const db = dbDiProva();
  db.prepare("INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (1, ?, 'ok', 30)").run(isoOreFa(1));
  const rilievo = db.prepare(
    "INSERT INTO ad_health_findings (id, run_id, severity, title, object_count, sample_dns_json) VALUES (?, 1, ?, ?, ?, ?)",
  );
  rilievo.run(1, "Low", "Nota", 1, null);
  rilievo.run(2, "Medium", "Media", 2, "non-json");
  rilievo.run(
    3,
    "Critical",
    "Admin",
    4,
    JSON.stringify(["CN=Mario Rossi,OU=Utenti,DC=a", "CN=Mario Rossi,OU=Altro", "CN=Anna,OU=Utenti", "senza cn"]),
  );
  rilievo.run(4, "High", "Alto", 3, "[]");
  const rilievi = statoDominio(db)?.rilievi ?? [];
  assert.deepEqual(rilievi.map((r) => r.gravita), ["grave", "grave", "attenzione", "nota"]);
  assert.equal(rilievi[0]?.testo, "Admin");
  assert.deepEqual(rilievi[0]?.nomi, ["Mario Rossi", "Anna", "senza cn"]);
  assert.deepEqual(rilievi[1]?.nomi, []);
  db.close();
});

test("gli account che finiscono con $ si scartano; 4 fallimenti no, 5 sì", () => {
  const db = dbDiProva();
  const evento = db.prepare(
    "INSERT INTO dc_evento (id, quando, event_id, account, postazione, ip, motivo) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (let n = 0; n < 4; n++) evento.run(n + 1, isoOreFa(1), 4625, "poche", "PC-1", null, null);
  for (let n = 0; n < 5; n++) evento.run(n + 10, isoOreFa(2), 4771, "tante", null, "10.0.0.8", "password errata");
  for (let n = 0; n < 6; n++) evento.run(n + 20, isoOreFa(1), 4625, "SERVER$", "DC", null, null);
  evento.run(30, isoOreFa(1), 4740, "  ", null, null, null);
  evento.run(31, isoOreFa(3), 4740, "bloccato", "PC-9", "10.1.1.9", "troppi tentativi");
  evento.run(32, isoOreFa(30), 4740, "vecchio", "PC-0", null, "fuori finestra");

  const problemi = problemiDiAccesso(db);
  assert.deepEqual(problemi.map((p) => p.utente), ["bloccato", "tante"]);
  assert.equal(problemi[0]?.tipo, "bloccato");
  assert.equal(problemi[0]?.quanti, 1);
  assert.equal(problemi[0]?.da, "PC-9");
  assert.equal(problemi[0]?.motivo, "troppi tentativi");
  assert.equal(problemi[1]?.tipo, "falliti");
  assert.equal(problemi[1]?.quanti, 5);
  assert.equal(problemi[1]?.da, "10.0.0.8");
  db.close();
});

test("senza la tabella degli eventi l'elenco è vuoto", () => {
  const db = new Database(":memory:");
  assert.deepEqual(problemiDiAccesso(db), []);
  db.close();
});

test("i nomi semplici restano, anche senza CN=", () => {
  const db = dbDiProva();
  db.prepare("INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (1, ?, 'ok', 10)").run(isoOreFa(1));
  db.prepare(
    "INSERT INTO ad_health_findings (id, run_id, severity, title, object_count, sample_dns_json) VALUES (1, 1, 'Low', 'Nomi', 3, ?)",
  ).run(JSON.stringify(["Guest", "mauri-a", "nety-audit", "Guest"]));
  assert.deepEqual(statoDominio(db)?.rilievi[0]?.nomi, ["Guest", "mauri-a", "nety-audit"]);
  db.close();
});

test("i gravi si contano tutti, e in casa al più tre voci", () => {
  const db = dbDiProva();
  db.prepare("INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (1, ?, 'ok', 100)").run(isoOreFa(1));
  const rilievo = db.prepare(
    "INSERT INTO ad_health_findings (id, run_id, severity, title, object_count, sample_dns_json) VALUES (?, 1, 'Critical', ?, 1, '[]')",
  );
  for (let n = 1; n <= 12; n++) rilievo.run(n, `Rilievo ${n}`);
  const stato = statoDominio(db);
  assert.equal(stato?.graviTotali, 12);
  assert.equal(stato?.rilievi.length, 10);
  const voci = vociRilieviGravi(
    (stato?.rilievi ?? []).filter((r) => r.gravita === "grave"),
    stato?.graviTotali ?? 0,
  );
  assert.equal(voci.length, 3);
  assert.equal(voci[2]?.testo, "Altri 10 rilievi gravi nel dominio");
  assert.equal(vociRilieviGravi([{ testo: "Uno", quanti: 1 }], 1)[0]?.testo, "1 · Uno");
  db.close();
});
