import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_CATEGORIES,
  buildAlertsQuery,
  categorizeAlert,
  minSelectedLevel,
  normalizeIp,
  accountKind,
  dedupKey,
  normalizeAlert,
  type WazuhAlertDoc,
} from "../wazuh-alerts";

const SINCE = "2026-07-20T00:00:00.000Z";

function doc(partial: Partial<WazuhAlertDoc> = {}): WazuhAlertDoc {
  return {
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
}

test("every category declares the groups it matches", () => {
  assert.ok(ALERT_CATEGORIES.length >= 5);
  for (const c of ALERT_CATEGORIES) {
    assert.ok(c.id.length > 0, c.id);
    assert.ok(c.groups.length > 0, c.id);
    assert.ok(c.labelIt.length > 3, c.id);
  }
  const ids = ALERT_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("buildAlertsQuery filters by time window and minimum level", () => {
  const q = buildAlertsQuery({ since: SINCE, minLevel: 10, size: 500 });
  assert.equal(q.size, 500);
  const filters = q.query.bool.filter;
  assert.ok(
    filters.some(
      (f) => "range" in f && f.range["@timestamp"]?.gte === SINCE,
    ),
    "missing timestamp filter",
  );
  assert.ok(
    filters.some((f) => "range" in f && f.range["rule.level"]?.gte === 10),
    "missing level filter",
  );
});

test("buildAlertsQuery restricts to the curated rule groups", () => {
  const q = buildAlertsQuery({ since: SINCE, minLevel: 8, size: 100 });
  const groupFilter = q.query.bool.filter.find((f) => "terms" in f);
  assert.ok(groupFilter && "terms" in groupFilter);
  const groups = groupFilter.terms["rule.groups"];
  assert.ok(groups.includes("authentication_failures"));
  assert.ok(groups.includes("ransomware_detection"));
  // Operational noise measured on the field must not be pulled in
  assert.ok(!groups.includes("windows_system"));
  assert.ok(!groups.includes("windows_application"));
  // CVE alerts are already covered by the existing vulnerability sync
  assert.ok(!groups.includes("vulnerability-detector"));
});

test("buildAlertsQuery sorts deterministically for search_after paging", () => {
  const q = buildAlertsQuery({ since: SINCE, minLevel: 8, size: 100 });
  assert.deepEqual(q.sort, [{ "@timestamp": "asc" }, { _id: "asc" }]);
  const paged = buildAlertsQuery({
    since: SINCE,
    minLevel: 8,
    size: 100,
    searchAfter: ["2026-07-25T00:00:00.000Z", "abc"],
  });
  assert.deepEqual(paged.search_after, ["2026-07-25T00:00:00.000Z", "abc"]);
});

test("normalizeAlert flattens the fields the alert store needs", () => {
  const a = normalizeAlert(doc(), "hit-1");
  assert.equal(a.id, "hit-1");
  assert.equal(a.agentName, "SRV-DC");
  assert.equal(a.ruleLevel, 10);
  assert.equal(a.ruleId, "60122");
  assert.equal(a.timestamp, "2026-07-27T10:00:00.000Z");
  assert.equal(a.category, "auth_failure");
});

test("normalizeAlert extracts the Windows event id and account when present", () => {
  const a = normalizeAlert(
    doc({
      data: {
        win: {
          system: { eventID: "4625" },
          eventdata: { targetUserName: "mrossi", ipAddress: "10.0.0.9" },
        },
      },
    }),
    "hit-2",
  );
  assert.equal(a.eventId, "4625");
  assert.equal(a.targetUser, "mrossi");
  assert.equal(a.sourceIp, "10.0.0.9");
});

test("categorizeAlert recognises ransomware and brute force", () => {
  assert.equal(categorizeAlert(["synology", "ransomware_detection"]), "ransomware");
  assert.equal(categorizeAlert(["sshd", "authentication_failures"]), "auth_failure");
  assert.equal(categorizeAlert(["syslog", "recon"]), null);
});

test("agent flooding is classified as a health signal, not a threat", () => {
  const cat = ALERT_CATEGORIES.find((c) => c.id === "agent_health");
  assert.ok(cat);
  assert.equal(cat!.diagnostic, true);
  assert.equal(categorizeAlert(["wazuh", "agent_flooding"]), "agent_health");
});

test("dedupKey collapses the same alert repeating on the same agent", () => {
  const a = normalizeAlert(doc(), "hit-1");
  const b = normalizeAlert(doc({ "@timestamp": "2026-07-27T11:30:00.000Z" }), "hit-9");
  assert.equal(dedupKey(a), dedupKey(b));

  const other = normalizeAlert(
    doc({ agent: { id: "004", name: "SRV-FILE" } }),
    "hit-3",
  );
  assert.notEqual(dedupKey(a), dedupKey(other));
});

test("the query threshold is the lowest any category needs", () => {
  // Sul campo i logon falliti Windows scattano a livello 5 e i fallimenti di
  // accesso Microsoft 365 a livello 3: la query deve scendere alla piu' bassa,
  // altrimenti scarta gli alert prima che le soglie per-categoria li vedano.
  // Misurato: da 2.492 a 3.862 alert in 24h, volume ampiamente gestibile.
  assert.equal(minSelectedLevel(), 3);
  const q = buildAlertsQuery({ since: SINCE, size: 100 });
  const lvl = q.query.bool.filter.find((f) => "range" in f && f.range["rule.level"]);
  assert.ok(lvl && "range" in lvl);
  assert.equal(lvl.range["rule.level"]?.gte, 3);
});

test("auth_failure captures the level-5 rule Windows actually fires", () => {
  const cat = ALERT_CATEGORIES.find((c) => c.id === "auth_failure")!;
  assert.ok(cat.minLevel <= 5);
  assert.ok(cat.groups.includes("authentication_failed"));
  assert.ok(cat.groups.includes("invalid_login"));
});

test("a graver category keeps its own higher threshold", () => {
  const ransom = ALERT_CATEGORIES.find((c) => c.id === "ransomware")!;
  assert.ok(ransom.minLevel >= 10);
});

// ── Soppressione del rumore generato da noi stessi ──────────────────────────

test("normalizeIp unwraps the IPv4-mapped IPv6 form Windows logs", () => {
  // Sul campo il DC scrive "::ffff:172.16.1.154": senza normalizzare, il
  // confronto con gli IP dell'appliance non aggancerebbe mai.
  assert.equal(normalizeIp("::ffff:172.16.1.154"), "172.16.1.154");
  assert.equal(normalizeIp("172.16.0.2"), "172.16.0.2");
  assert.equal(normalizeIp("  ::FFFF:10.0.0.1 "), "10.0.0.1");
  assert.equal(normalizeIp(null), null);
});

const SELF = { ips: ["172.16.0.2", "172.16.1.21"], accounts: ["domarc"] };

test("an alert coming from the appliance is recognised as our own probe", () => {
  const a = normalizeAlert(
    {
      "@timestamp": "2026-07-27T10:00:00.000Z",
      agent: { id: "003", name: "SRV-DC" },
      rule: { id: "60122", level: 5, description: "Logon Failure", groups: ["authentication_failed"] },
      data: { win: { system: { eventID: "4625" }, eventdata: { ipAddress: "::ffff:172.16.0.2" } } },
    },
    "h1",
    SELF,
  );
  assert.equal(a.category, "self_probe");
});

test("our service account is recognised however the domain is written", () => {
  const mk = (user: string) =>
    normalizeAlert(
      {
        "@timestamp": "2026-07-27T10:00:00.000Z",
        rule: { id: "60122", level: 5, description: "x", groups: ["authentication_failed"] },
        data: { win: { eventdata: { targetUserName: user } } },
      },
      "h",
      SELF,
    ).category;
  assert.equal(mk("domarc"), "self_probe");
  assert.equal(mk("DOMARC"), "self_probe");
  assert.equal(mk("domarc@dts.local"), "self_probe");
  assert.equal(mk("DTS\\domarc"), "self_probe");
});

test("a real user from a customer server stays a security alert", () => {
  const a = normalizeAlert(
    {
      "@timestamp": "2026-07-27T10:00:00.000Z",
      rule: { id: "60122", level: 5, description: "x", groups: ["authentication_failed"] },
      data: { win: { eventdata: { targetUserName: "gs.sicurezza", ipAddress: "::ffff:172.16.1.154" } } },
    },
    "h",
    SELF,
  );
  assert.equal(a.category, "auth_failure");
});

test("without a self-identity list nothing is suppressed", () => {
  const a = normalizeAlert(
    {
      "@timestamp": "2026-07-27T10:00:00.000Z",
      rule: { id: "60122", level: 5, description: "x", groups: ["authentication_failed"] },
      data: { win: { eventdata: { ipAddress: "172.16.0.2" } } },
    },
    "h",
  );
  assert.equal(a.category, "auth_failure");
});

test("self_probe is diagnostic: visible, but never an attack", () => {
  const cat = ALERT_CATEGORIES.find((c) => c.id === "self_probe");
  assert.ok(cat);
  assert.equal(cat!.diagnostic, true);
});

// ── Sorgenti oltre Windows e disambiguazione dell'account ───────────────────

test("a Microsoft 365 failed login is captured, its successes are not", () => {
  // Il gruppo AzureActiveDirectoryStsLogon contiene sia accessi riusciti sia
  // falliti: senza guardare l'Operation si archivierebbero 600 login riusciti
  // come se fossero attacchi.
  const mk = (op: string) =>
    normalizeAlert(
      {
        "@timestamp": "2026-07-27T10:00:00.000Z",
        rule: { id: "91004", level: 3, description: "STS logon", groups: ["office365", "AzureActiveDirectoryStsLogon"] },
        data: { office365: { Operation: op, UserId: "mario.rossi@acme.it", ClientIP: "203.0.113.9" } },
      },
      "h",
    );
  assert.equal(mk("UserLoginFailed").category, "cloud_auth_failure");
  assert.equal(mk("UserLoggedIn").category, null);
});

test("the user is read from whichever field the source uses", () => {
  const user = (data: Record<string, unknown>) =>
    normalizeAlert(
      {
        "@timestamp": "2026-07-27T10:00:00.000Z",
        rule: { id: "1", level: 5, description: "x", groups: ["authentication_failed"] },
        data,
      },
      "h",
    );
  assert.equal(user({ win: { eventdata: { targetUserName: "mrossi" } } }).targetUser, "mrossi");
  assert.equal(user({ srcuser: "root" }).targetUser, "root");
  assert.equal(user({ dstuser: "admin" }).targetUser, "admin");
  assert.equal(
    user({ office365: { Operation: "UserLoginFailed", UserId: "a@b.it" } }).targetUser,
    "a@b.it",
  );
});

test("the origin IP is read from whichever field the source uses", () => {
  const ip = (data: Record<string, unknown>) =>
    normalizeAlert(
      {
        "@timestamp": "2026-07-27T10:00:00.000Z",
        rule: { id: "1", level: 5, description: "x", groups: ["authentication_failed"] },
        data,
      },
      "h",
    ).sourceIp;
  assert.equal(ip({ win: { eventdata: { ipAddress: "::ffff:10.0.0.1" } } }), "10.0.0.1");
  assert.equal(ip({ srcip: "192.0.2.5" }), "192.0.2.5");
  assert.equal(ip({ office365: { ClientIP: "203.0.113.9" } }), "203.0.113.9");
});

test("each alert declares which system it came from", () => {
  const sys = (data: Record<string, unknown>, groups = ["authentication_failed"]) =>
    normalizeAlert(
      {
        "@timestamp": "2026-07-27T10:00:00.000Z",
        rule: { id: "1", level: 5, description: "x", groups },
        data,
      },
      "h",
    ).sourceSystem;
  assert.equal(sys({ win: { eventdata: { targetUserName: "a" } } }), "windows");
  assert.equal(
    sys({ office365: { Operation: "UserLoginFailed" } }, ["office365", "AzureActiveDirectoryStsLogon"]),
    "microsoft365",
  );
  assert.equal(sys({ srcuser: "root" }, ["sshd"]), "linux");
  assert.equal(sys({}), "altro");
});

test("a machine account is told apart from a person", () => {
  // Sul campo compaiono account come "PS-CERIELLO-P$": senza distinguerli
  // sembrano utenti e mandano fuori strada chi legge.
  assert.equal(accountKind("PS-CERIELLO-P$"), "computer");
  assert.equal(accountKind("mario.rossi"), "utente");
  assert.equal(accountKind("a@b.it"), "utente");
  assert.equal(accountKind(null), "utente");
});
