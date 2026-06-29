process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-hoststatus";

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHostIdsCapped } from "@/app/api/integrations/meshcentral/host-status/route";

test("parseHostIdsCapped filters + caps at 1000", () => {
  assert.deepEqual(parseHostIdsCapped([1, 2, -3, 0, "4", null, 2]), [1, 2, 4, 2]);
  const big = Array.from({ length: 1500 }, (_, i) => i + 1);
  assert.equal(parseHostIdsCapped(big).length, 1000);
  assert.deepEqual(parseHostIdsCapped(undefined), []);
  assert.deepEqual(parseHostIdsCapped("nope"), []);
});
