import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelfIdentity } from "../self-identity";
import { isSelfOrigin } from "../wazuh-alerts";

test("merges the sources and deduplicates", () => {
  const s = buildSelfIdentity({
    localIps: ["10.0.0.2", "10.0.1.21"],
    dbIps: ["10.0.0.2"],
    extraIps: ["10.0.0.5"],
    dbAccounts: ["domarc@cliente-a.local", "CLIENTE-A\\domarc"],
    extraAccounts: ["svc-scanner"],
  });
  assert.deepEqual(s.ips.sort(), ["10.0.0.2", "10.0.0.5", "10.0.1.21"]);
  assert.deepEqual(s.accounts.sort(), ["domarc", "svc-scanner"]);
});

test("loopback is not treated as our own probe", () => {
  // Sul DC "127.0.0.1" indica un fallimento locale della macchina, non una
  // nostra connessione: sopprimerlo nasconderebbe un problema reale.
  const s = buildSelfIdentity({ localIps: ["127.0.0.1", "::1", "10.0.0.2"] });
  assert.deepEqual(s.ips, ["10.0.0.2"]);
});

test("an empty identity suppresses nothing", () => {
  const s = buildSelfIdentity({});
  assert.deepEqual(s.ips, []);
  assert.deepEqual(s.accounts, []);
  assert.equal(
    isSelfOrigin({ sourceIp: "10.0.0.2", targetUser: "domarc" }, s),
    false,
  );
});

test("the built identity actually matches what Windows logs", () => {
  const s = buildSelfIdentity({ localIps: ["10.0.0.2"], dbAccounts: ["domarc@cliente-a.local"] });
  assert.equal(isSelfOrigin({ sourceIp: "::ffff:10.0.0.2", targetUser: null }, s), true);
  assert.equal(isSelfOrigin({ sourceIp: null, targetUser: "CLIENTE-A\\domarc" }, s), true);
  assert.equal(isSelfOrigin({ sourceIp: "::ffff:10.0.1.154", targetUser: "gs.sicurezza" }, s), false);
});
