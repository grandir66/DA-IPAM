import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POLICY,
  buildDigestMessage,
  buildImmediateMessage,
  buildWebhookPayload,
  shouldNotifyImmediately,
  type NotifiableEvent,
} from "../policy";

function ev(partial: Partial<NotifiableEvent> = {}): NotifiableEvent {
  return {
    id: 1,
    category: "auth_failure",
    diagnostic: 0,
    rule_level: 10,
    rule_description: "Multiple Windows Logon Failures",
    agent_name: "SRV-DC",
    event_id: "4625",
    target_user: "mrossi",
    source_ip: "10.0.0.9",
    occurrence_count: 12,
    first_seen_at: "2026-07-27T09:00:00.000Z",
    last_seen_at: "2026-07-27T10:00:00.000Z",
    ...partial,
  };
}

test("grave categories notify immediately even below the level threshold", () => {
  const e = ev({ category: "ransomware", rule_level: 10 });
  assert.equal(shouldNotifyImmediately(e, DEFAULT_POLICY), true);
});

test("a high level notifies immediately whatever the category", () => {
  assert.equal(
    shouldNotifyImmediately(ev({ category: "auth_failure", rule_level: 12 }), DEFAULT_POLICY),
    true,
  );
});

test("an ordinary event waits for the digest", () => {
  assert.equal(
    shouldNotifyImmediately(ev({ category: "auth_failure", rule_level: 8 }), DEFAULT_POLICY),
    false,
  );
});

test("diagnostic events never trigger an immediate alert", () => {
  // Agent flooding is the loudest signal on the field: paging someone at 3am
  // because a queue is full would train them to ignore the channel.
  const e = ev({ category: "agent_health", diagnostic: 1, rule_level: 12 });
  assert.equal(shouldNotifyImmediately(e, DEFAULT_POLICY), false);
});

test("the policy is configurable", () => {
  const strict = { ...DEFAULT_POLICY, immediateCategories: [], immediateMinLevel: 15 };
  assert.equal(shouldNotifyImmediately(ev({ category: "ransomware" }), strict), false);
});

test("the immediate message names what happened and where", () => {
  const m = buildImmediateMessage(ev({ category: "ransomware" }), "ACME");
  assert.ok(m.subject.includes("ACME"));
  assert.ok(/ransomware/i.test(m.subject) || /ransomware/i.test(m.text));
  assert.ok(m.text.includes("SRV-DC"));
  assert.ok(m.text.includes("Multiple Windows Logon Failures"));
  assert.ok(m.text.includes("4625"));
});

test("the digest is skipped when there is nothing to report", () => {
  assert.equal(buildDigestMessage([], "ACME"), null);
});

test("the digest groups by category and counts occurrences", () => {
  const m = buildDigestMessage(
    [
      ev({ id: 1, category: "auth_failure", occurrence_count: 12 }),
      ev({ id: 2, category: "auth_failure", occurrence_count: 3, agent_name: "PC-01" }),
      ev({ id: 3, category: "agent_health", diagnostic: 1, agent_name: "PC-02" }),
    ],
    "ACME",
  );
  assert.ok(m);
  assert.ok(m!.subject.includes("3"));
  assert.ok(m!.text.includes("Fallimenti di autenticazione"));
  assert.ok(m!.text.includes("Salute degli agent"));
  assert.ok(m!.text.includes("PC-01"));
});

test("the webhook payload is machine-readable and carries the events", () => {
  const p = buildWebhookPayload("immediate", [ev()], "ACME");
  assert.equal(p.source, "da-ipam");
  assert.equal(p.kind, "immediate");
  assert.equal(p.tenant, "ACME");
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0]!.agent, "SRV-DC");
  assert.equal(p.events[0]!.category, "auth_failure");
  assert.ok(typeof p.text === "string" && p.text.length > 0);
});
