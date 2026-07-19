/**
 * Test per parseJsonSafe / tryParseJson (WAVE 3 / W3-1).
 * Run: node --import tsx --test src/lib/__tests__/json-safe.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonSafe, tryParseJson } from "../json-safe";

test("parseJsonSafe: JSON valido → parsato", () => {
  assert.deepEqual(parseJsonSafe('{"a":1}', {}), { a: 1 });
  assert.deepEqual(parseJsonSafe("[1,2,3]", []), [1, 2, 3]);
});

test("parseJsonSafe: JSON non valido → fallback", () => {
  assert.deepEqual(parseJsonSafe("{non valido", { ok: true }), { ok: true });
  assert.deepEqual(parseJsonSafe("undefined", []), []);
});

test("parseJsonSafe: null/undefined/vuoto → fallback", () => {
  assert.deepEqual(parseJsonSafe(null, { d: 1 }), { d: 1 });
  assert.deepEqual(parseJsonSafe(undefined, { d: 1 }), { d: 1 });
  assert.deepEqual(parseJsonSafe("", { d: 1 }), { d: 1 });
});

test("parseJsonSafe: preserva il tipo del fallback su errore", () => {
  const out: Record<string, string> = parseJsonSafe<Record<string, string>>("boom", {});
  assert.deepEqual(out, {});
});

test("tryParseJson: valido → valore, non valido/assente → null", () => {
  assert.deepEqual(tryParseJson<{ x: number }>('{"x":5}'), { x: 5 });
  assert.equal(tryParseJson("nope"), null);
  assert.equal(tryParseJson(null), null);
});
