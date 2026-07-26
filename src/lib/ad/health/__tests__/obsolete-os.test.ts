import { test } from "node:test";
import assert from "node:assert/strict";
import { isObsoleteOs } from "../obsolete-os";

test("detects obsolete OS substrings", () => {
  assert.equal(isObsoleteOs("Windows 7 Professional"), true);
  assert.equal(isObsoleteOs("Windows Server 2012 R2"), true);
  assert.equal(isObsoleteOs("Windows Server 2019"), false);
  assert.equal(isObsoleteOs(null), false);
});
