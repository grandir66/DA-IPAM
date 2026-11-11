/**
 * Scheda Log di sicurezza: frasi, avvisi veri, sette giorni.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/log-sicurezza.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { fraseAvviso } from "../frasi-avvisi";
import { logSicurezza, schedaLogSicurezza } from "../schede/log-sicurezza";
import { SCHEDE_CLIENTE } from "../registro";

const ORA = new Date("2026-11-11T12:00:00.000Z");

function dbDiProva(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE wazuh_alert_event (
      id INTEGER PRIMARY KEY,
      diagnostic INTEGER,
      rule_level INTEGER,
      rule_description TEXT,
      agent_name TEXT,
      target_user TEXT,
      occurrence_count INTEGER,
      last_seen_at TEXT,
      acknowledged INTEGER,
      acknowledged_at TEXT
    );
    CREATE TABLE wazuh_agent (
      agent_id TEXT PRIMARY KEY,
      status TEXT
    );
  `);
  return db;
}

test("fraseAvviso traduce i titoli misurati e lascia gli altri", () => {
  assert.equal(fraseAvviso("PAM: User login failed."), "Accesso non riuscito");
  assert.equal(fraseAvviso("Una regola mai vista"), "Una regola mai vista");
});

test("gli avvisi diagnostici non contano e i sette giorni ci sono sempre", () => {
  const db = dbDiProva();
  const avviso = db.prepare(`
    INSERT INTO wazuh_alert_event
      (id, diagnostic, rule_level, rule_description, agent_name, target_user, occurrence_count, last_seen_at, acknowledged, acknowledged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  avviso.run(1, 0, 12, "PAM: User login failed.", "PC-1", "mario", 3, "2026-11-09T10:00:00.000Z", 0, null);
  avviso.run(2, 1, 15, "PAM: User login failed.", "PC-2", null, 1, "2026-11-09T11:00:00.000Z", 0, null);
  avviso.run(3, 0, 3, "Regola rara", "PC-3", null, 1, "2026-10-01T10:00:00.000Z", 0, null);
  avviso.run(4, 0, 8, "New user added to the system.", "PC-4", null, 1, "2026-11-01T10:00:00.000Z", 1, "2026-11-02 10:00:00");
  avviso.run(5, 0, 8, "New user added to the system.", "PC-5", null, 1, "2026-09-01T10:00:00.000Z", 1, "2026-09-02 10:00:00");
  avviso.run(6, 1, 8, "New user added to the system.", "PC-6", null, 1, "2026-11-02T10:00:00.000Z", 1, "2026-11-03 10:00:00");
  db.prepare("INSERT INTO wazuh_agent (agent_id, status) VALUES ('1', 'active')").run();
  db.prepare("INSERT INTO wazuh_agent (agent_id, status) VALUES ('2', 'active')").run();
  db.prepare("INSERT INTO wazuh_agent (agent_id, status) VALUES ('3', 'disconnected')").run();

  const log = logSicurezza(db, ORA);
  assert.equal(log.perGiorno.length, 7);
  assert.equal(log.perGiorno[0]?.giorno, "2026-11-05");
  assert.equal(log.perGiorno[6]?.giorno, "2026-11-11");
  assert.equal(log.perGiorno.find((g) => g.giorno === "2026-11-09")?.avvisi, 1);
  assert.equal(log.perGiorno.filter((g) => g.avvisi === 0).length, 6);
  assert.equal(log.totaleAperti, 2);
  assert.equal(log.aperti[0]?.gravita, "grave");
  assert.equal(log.aperti[0]?.testo, "Accesso non riuscito");
  assert.equal(log.aperti[0]?.dove, "PC-1");
  assert.equal(log.aperti[0]?.chi, "mario");
  assert.equal(log.aperti[0]?.volte, 3);
  assert.equal(log.chiusiNelMese, 1);
  assert.equal(log.sottoControllo, 2);
  assert.equal(log.totaleComputer, 3);
  db.close();
});

test("la scheda Log di sicurezza è nel registro", () => {
  assert.equal(schedaLogSicurezza.id, "log-sicurezza");
  assert.equal(schedaLogSicurezza.titolo, "Log di sicurezza");
  assert.equal(schedaLogSicurezza.ordine, 50);
  assert.equal(schedaLogSicurezza.icona, "FileText");
  assert.equal(SCHEDE_CLIENTE.some((s) => s.id === "log-sicurezza"), true);
});
