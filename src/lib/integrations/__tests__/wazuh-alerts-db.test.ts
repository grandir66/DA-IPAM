import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  acknowledgeAlertEvent,
  countOpenByCategory,
  ensureWazuhAlertSchema,
  getAlertSyncState,
  listAlertEvents,
  listUnnotifiedEvents,
  markEventsNotified,
  purgeAcknowledgedOlderThan,
  setAlertSyncState,
  upsertAlertEvent,
} from "../wazuh-alerts-db";
import { normalizeAlert, type WazuhAlertDoc } from "../wazuh-alerts";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureWazuhAlertSchema(db);
  return db;
}

function alert(partial: Partial<WazuhAlertDoc> = {}, hitId = "hit-1") {
  const doc: WazuhAlertDoc = {
    "@timestamp": "2026-07-27T10:00:00.000Z",
    agent: { id: "003", name: "SRV-DC" },
    rule: {
      id: "60122",
      level: 10,
      description: "Multiple Windows Logon Failures",
      groups: ["windows", "authentication_failures"],
    },
    ...partial,
  };
  return normalizeAlert(doc, hitId);
}

test("ensureWazuhAlertSchema is idempotent", () => {
  const db = freshDb();
  ensureWazuhAlertSchema(db);
  ensureWazuhAlertSchema(db);
  assert.equal(listAlertEvents(db, {}).length, 0);
});

test("a new alert opens an event with occurrence 1", () => {
  const db = freshDb();
  const r = upsertAlertEvent(db, alert());
  assert.equal(r.created, true);

  const rows = listAlertEvents(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.occurrence_count, 1);
  assert.equal(rows[0]!.category, "auth_failure");
  assert.equal(rows[0]!.agent_name, "SRV-DC");
  assert.equal(rows[0]!.acknowledged, 0);
});

test("the same rule on the same agent increments instead of duplicating", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert({}, "hit-1"));
  const second = upsertAlertEvent(
    db,
    alert({ "@timestamp": "2026-07-27T11:00:00.000Z" }, "hit-2"),
  );
  assert.equal(second.created, false);

  const rows = listAlertEvents(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.occurrence_count, 2);
  assert.equal(rows[0]!.first_seen_at, "2026-07-27T10:00:00.000Z");
  assert.equal(rows[0]!.last_seen_at, "2026-07-27T11:00:00.000Z");
});

test("a different agent gets its own event", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  upsertAlertEvent(db, alert({ agent: { id: "004", name: "SRV-FILE" } }, "hit-2"));
  assert.equal(listAlertEvents(db, {}).length, 2);
});

test("an acknowledged event is not resurrected — a later alert opens a new one", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  const open = listAlertEvents(db, {})[0]!;
  acknowledgeAlertEvent(db, open.id, "riccardo");

  const after = listAlertEvents(db, {}).find((r) => r.id === open.id)!;
  assert.equal(after.acknowledged, 1);
  assert.equal(after.acknowledged_by, "riccardo");

  const again = upsertAlertEvent(
    db,
    alert({ "@timestamp": "2026-07-28T09:00:00.000Z" }, "hit-3"),
  );
  assert.equal(again.created, true);
  assert.equal(listAlertEvents(db, {}).length, 2);
  assert.equal(listAlertEvents(db, { onlyOpen: true }).length, 1);
});

test("listAlertEvents filters by category and open state", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  upsertAlertEvent(
    db,
    alert(
      {
        agent: { id: "010", name: "NAS" },
        rule: {
          id: "100200",
          level: 12,
          description: "Synology: RANSOMWARE ALERT",
          groups: ["synology", "ransomware_detection"],
        },
      },
      "hit-r",
    ),
  );
  assert.equal(listAlertEvents(db, { category: "ransomware" }).length, 1);
  assert.equal(listAlertEvents(db, { category: "auth_failure" }).length, 1);
  assert.equal(listAlertEvents(db, {}).length, 2);
});

test("diagnostic alerts are stored flagged so the UI can separate them", () => {
  const db = freshDb();
  upsertAlertEvent(
    db,
    alert(
      {
        rule: {
          id: "10000",
          level: 12,
          description: "Agent event queue is flooded.",
          groups: ["wazuh", "agent_flooding"],
        },
      },
      "hit-f",
    ),
  );
  const row = listAlertEvents(db, {})[0]!;
  assert.equal(row.category, "agent_health");
  assert.equal(row.diagnostic, 1);
});

test("alerts outside the curated selection are rejected", () => {
  const db = freshDb();
  const r = upsertAlertEvent(
    db,
    alert(
      {
        rule: { id: "1", level: 3, description: "noise", groups: ["syslog"] },
      },
      "hit-n",
    ),
  );
  assert.equal(r.created, false);
  assert.equal(r.skipped, true);
  assert.equal(listAlertEvents(db, {}).length, 0);
});

test("countOpenByCategory ignores acknowledged events", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  assert.deepEqual(countOpenByCategory(db), { auth_failure: 1 });
  acknowledgeAlertEvent(db, listAlertEvents(db, {})[0]!.id, "riccardo");
  assert.deepEqual(countOpenByCategory(db), {});
});

test("sync state round-trips the cursor", () => {
  const db = freshDb();
  assert.equal(getAlertSyncState(db).lastTimestamp, null);
  setAlertSyncState(db, {
    lastTimestamp: "2026-07-27T12:00:00.000Z",
    cursor: ["2026-07-27T12:00:00.000Z", "abc"],
  });
  const s = getAlertSyncState(db);
  assert.equal(s.lastTimestamp, "2026-07-27T12:00:00.000Z");
  assert.deepEqual(s.cursor, ["2026-07-27T12:00:00.000Z", "abc"]);
});

test("new events are pending notification until marked", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  const pending = listUnnotifiedEvents(db);
  assert.equal(pending.length, 1);

  markEventsNotified(db, [pending[0]!.id]);
  assert.equal(listUnnotifiedEvents(db).length, 0);
});

test("an event already notified is not re-sent when it recurs", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  markEventsNotified(db, [listUnnotifiedEvents(db)[0]!.id]);
  // stessa coppia agent+regola: incrementa, non deve riaprire la notifica
  upsertAlertEvent(db, alert({ "@timestamp": "2026-07-27T12:00:00.000Z" }, "hit-2"));
  assert.equal(listUnnotifiedEvents(db).length, 0);
});

test("retention removes old acknowledged events and never open ones", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  upsertAlertEvent(db, alert({ agent: { id: "004", name: "PC-01" } }, "hit-2"));

  const rows = listAlertEvents(db, {});
  acknowledgeAlertEvent(db, rows[0]!.id, "riccardo");
  // invecchia artificialmente l'ack
  db.prepare(
    "UPDATE wazuh_alert_event SET acknowledged_at = datetime('now', '-60 days') WHERE id = ?",
  ).run(rows[0]!.id);

  const removed = purgeAcknowledgedOlderThan(db, 30);
  assert.equal(removed, 1);

  const left = listAlertEvents(db, {});
  assert.equal(left.length, 1);
  assert.equal(left[0]!.acknowledged, 0);
});

test("retention keeps acknowledged events that are still recent", () => {
  const db = freshDb();
  upsertAlertEvent(db, alert());
  acknowledgeAlertEvent(db, listAlertEvents(db, {})[0]!.id, "riccardo");
  assert.equal(purgeAcknowledgedOlderThan(db, 30), 0);
  assert.equal(listAlertEvents(db, {}).length, 1);
});
