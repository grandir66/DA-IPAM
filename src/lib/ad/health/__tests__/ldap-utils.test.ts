import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_ADMINS_RID,
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
  // Niente letterali BigInt (`123n`): il target TS del progetto è ES2017.
  const filetime = (BigInt(unixMs) + BigInt("11644473600000")) * BigInt(10000);
  assert.equal(ldapTimestampToIso(filetime.toString()), "2020-01-01T00:00:00.000Z");
  // Input numerico: il FILETIME supera Number.MAX_SAFE_INTEGER, quindi si verifica
  // la variante number su un timestamp più recente e rappresentabile esattamente.
  const safeUnixMs = Date.UTC(2024, 5, 1);
  const safeFiletime = Number(BigInt(safeUnixMs) + BigInt("11644473600000")) * 10000;
  assert.equal(ldapTimestampToIso(safeFiletime), "2024-06-01T00:00:00.000Z");
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

test("isAccountEnabled and well-known RIDs", () => {
  assert.equal(isAccountEnabled(512), 1);
  assert.equal(isAccountEnabled(514), 0); // 512|2
  assert.equal(isAccountEnabled(null), 1);
  assert.equal(DOMAIN_ADMINS_RID, 512);
  assert.equal(DOMAIN_CONTROLLERS_RID, 516);
});
