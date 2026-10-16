import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureWazuhAlertSchema } from "@/lib/integrations/wazuh-alerts-db";
import { collectWazuhSignals } from "../wazuh-signals";

function dbWithEvents(
  rows: Array<{
    category: string;
    eventId?: string | null;
    targetUser?: string | null;
    agent?: string | null;
    occurrences?: number;
    daysAgo?: number;
  }>,
): Database.Database {
  const db = new Database(":memory:");
  ensureWazuhAlertSchema(db);
  const stmt = db.prepare(
    `INSERT INTO wazuh_alert_event
      (dedup_key, category, diagnostic, rule_id, rule_level, rule_description,
       agent_id, agent_name, event_id, target_user, source_ip,
       occurrence_count, first_seen_at, last_seen_at)
     VALUES (?, ?, 0, '60122', 5, 'Logon Failure', 'a', ?, ?, ?, NULL, ?,
             datetime('now', ?), datetime('now', ?))`,
  );
  rows.forEach((r, i) => {
    const ago = `-${r.daysAgo ?? 0} days`;
    stmt.run(
      `k${i}`,
      r.category,
      r.agent ?? "SRV-DC",
      r.eventId ?? null,
      r.targetUser ?? null,
      r.occurrences ?? 1,
      ago,
      ago,
    );
  });
  return db;
}

test("a missing table means unavailable, not zero", () => {
  // Se Wazuh non e' mai stato configurato la tabella non esiste: dire "zero
  // fallimenti" farebbe sembrare sano un dominio che non abbiamo guardato.
  const bare = new Database(":memory:");
  const s = collectWazuhSignals(bare);
  assert.equal(s.available, false);
  assert.equal(s.authFailureOccurrences, 0);
});

test("an empty table is available with nothing to report", () => {
  const s = collectWazuhSignals(dbWithEvents([]));
  assert.equal(s.available, true);
  assert.equal(s.authFailureOccurrences, 0);
});

test("sums the occurrences of authentication failures", () => {
  const s = collectWazuhSignals(
    dbWithEvents([
      { category: "auth_failure", occurrences: 1200, targetUser: "amministratore" },
      { category: "auth_failure", occurrences: 300, targetUser: "mrossi", agent: "PC-01" },
      { category: "ransomware", occurrences: 9 },
    ]),
  );
  assert.equal(s.authFailureOccurrences, 1500);
  assert.equal(s.authFailureTargets.length, 2);
  assert.equal(s.authFailureTargets[0]!.targetUser, "amministratore");
  assert.equal(s.authFailureTargets[0]!.occurrences, 1200);
});

test("events older than the window are ignored", () => {
  const s = collectWazuhSignals(
    dbWithEvents([
      { category: "auth_failure", occurrences: 500, daysAgo: 30 },
      { category: "auth_failure", occurrences: 20, daysAgo: 1 },
    ]),
    { windowDays: 7 },
  );
  assert.equal(s.authFailureOccurrences, 20);
});

test("counts lockout events separately so their absence is measurable", () => {
  const s = collectWazuhSignals(
    dbWithEvents([
      { category: "auth_failure", occurrences: 900 },
      { category: "privileged_change", eventId: "4740", occurrences: 3 },
    ]),
  );
  assert.equal(s.authFailureOccurrences, 900);
  assert.equal(s.lockoutOccurrences, 3);
});

test("no lockout events at all is reported as zero, with data available", () => {
  const s = collectWazuhSignals(dbWithEvents([{ category: "auth_failure", occurrences: 900 }]));
  assert.equal(s.available, true);
  assert.equal(s.lockoutOccurrences, 0);
});
