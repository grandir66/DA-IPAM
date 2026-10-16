/**
 * Naabu TCP pre-pass wrapper (Task 8).
 * Run: node --import tsx --test src/lib/scanner/__tests__/naabu.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNaabuJsonLine,
  mergeNaabuPortMap,
  isNaabuAvailable,
  runNaabuTcpPorts,
} from "../naabu";

test("parseNaabuJsonLine reads ip and port", () => {
  const r = parseNaabuJsonLine('{"ip":"192.0.2.1","port":443}');
  assert.deepEqual(r, { ip: "192.0.2.1", port: 443 });
});

test("parseNaabuJsonLine returns null for invalid / incomplete lines", () => {
  assert.equal(parseNaabuJsonLine(""), null);
  assert.equal(parseNaabuJsonLine("not-json"), null);
  assert.equal(parseNaabuJsonLine('{"ip":"192.0.2.1"}'), null);
  assert.equal(parseNaabuJsonLine('{"port":443}'), null);
  assert.equal(parseNaabuJsonLine('{"ip":"192.0.2.1","port":"x"}'), null);
});

test("mergeNaabuPortMap aggregates ports per ip", () => {
  const m = mergeNaabuPortMap([
    { ip: "192.0.2.1", port: 80 },
    { ip: "192.0.2.1", port: 443 },
  ]);
  assert.deepEqual(m.get("192.0.2.1"), [80, 443]);
});

test("mergeNaabuPortMap dedupes ports and sorts", () => {
  const m = mergeNaabuPortMap([
    { ip: "192.0.2.1", port: 443 },
    { ip: "192.0.2.2", port: 22 },
    { ip: "192.0.2.1", port: 80 },
    { ip: "192.0.2.1", port: 443 },
  ]);
  assert.deepEqual(m.get("192.0.2.1"), [80, 443]);
  assert.deepEqual(m.get("192.0.2.2"), [22]);
});

test("isNaabuAvailable returns false when binary missing", async () => {
  const ok = await isNaabuAvailable("/nonexistent/naabu-bin-task8");
  assert.equal(ok, false);
});

test("runNaabuTcpPorts returns empty Map when binary missing (fail-soft)", async () => {
  const m = await runNaabuTcpPorts(["192.0.2.1"], {
    binPath: "/nonexistent/naabu-bin-task8",
  });
  assert.ok(m instanceof Map);
  assert.equal(m.size, 0);
});

test("runNaabuTcpPorts returns empty Map for empty targets", async () => {
  const m = await runNaabuTcpPorts([]);
  assert.equal(m.size, 0);
});
