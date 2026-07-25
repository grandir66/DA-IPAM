import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_CONTROLLERS_RID,
  isAccountEnabled,
  ldapStr,
  ldapStrArray,
  ldapTimestampToIso,
  parseUac,
} from "../../ldap-utils";

test("ldapTimestampToIso returns null for empty / never-logged", () => {
  assert.equal(ldapTimestampToIso(null), null);
  assert.equal(ldapTimestampToIso(undefined), null);
  assert.equal(ldapTimestampToIso("0"), null);
  assert.equal(ldapTimestampToIso(0), null);
});

test("ldapTimestampToIso converts known FILETIME to ISO", () => {
  // 2020-01-01T00:00:00.000Z → FILETIME 100-ns since 1601
  const unixMs = Date.UTC(2020, 0, 1);
  const filetime = (BigInt(unixMs) + 11644473600000n) * 10000n;
  assert.equal(ldapTimestampToIso(filetime.toString()), "2020-01-01T00:00:00.000Z");
  assert.equal(ldapTimestampToIso(filetime), "2020-01-01T00:00:00.000Z");
});

test("ldapTimestampToIso rejects garbage", () => {
  assert.equal(ldapTimestampToIso("not-a-number"), null);
  assert.equal(ldapTimestampToIso("-1"), null);
});

test("ldapStr / ldapStrArray / parseUac helpers", () => {
  assert.equal(ldapStr("x"), "x");
  assert.equal(ldapStr(["a", "b"]), "a");
  assert.equal(ldapStr(null), null);
  assert.deepEqual(ldapStrArray(["a", "b"]), ["a", "b"]);
  assert.deepEqual(ldapStrArray("solo"), ["solo"]);
  assert.deepEqual(ldapStrArray(null), []);
  assert.equal(parseUac("512"), 512);
  assert.equal(parseUac(["514"]), 514);
  assert.equal(parseUac("nope"), null);
});

test("isAccountEnabled and Domain Controllers RID", () => {
  assert.equal(isAccountEnabled(512), 1);
  assert.equal(isAccountEnabled(514), 0); // 512|2
  assert.equal(isAccountEnabled(null), 1);
  assert.equal(DOMAIN_CONTROLLERS_RID, 516);
});
