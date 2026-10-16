import { test } from "node:test";
import assert from "node:assert/strict";
import { isObsoleteOs } from "../obsolete-os";

test("detects obsolete OS substrings", () => {
  assert.equal(isObsoleteOs("Windows 7 Professional"), true);
  assert.equal(isObsoleteOs("Windows Server 2012 R2"), true);
  assert.equal(isObsoleteOs("Windows Server 2019"), false);
  assert.equal(isObsoleteOs(null), false);
});

const NOW_2026 = new Date("2026-07-27T00:00:00.000Z");

test("Windows 10 is obsolete after its 2025-10-14 end of support", () => {
  assert.equal(isObsoleteOs("Windows 10 Pro", NOW_2026), true);
  assert.equal(
    isObsoleteOs("Windows 10 Enterprise", new Date("2025-01-01T00:00:00.000Z")),
    false,
  );
});

test("Windows 10 LTSC keeps its own longer lifecycle", () => {
  assert.equal(isObsoleteOs("Windows 10 Enterprise LTSC 2021", NOW_2026), false);
});

test("Server 2016 flips to obsolete only after 2027-01-12", () => {
  assert.equal(isObsoleteOs("Windows Server 2016 Standard", NOW_2026), false);
  assert.equal(
    isObsoleteOs("Windows Server 2016 Standard", new Date("2027-06-01T00:00:00.000Z")),
    true,
  );
});

test("Windows 11 and Server 2022 are not obsolete today", () => {
  assert.equal(isObsoleteOs("Windows 11 Pro", NOW_2026), false);
  assert.equal(isObsoleteOs("Windows Server 2022 Datacenter", NOW_2026), false);
});
