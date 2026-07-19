/**
 * Test H2 — resolveSessionTenant: `__ALL__` non ammesso per operazioni tenant-scoped.
 * Run: node --import tsx --test src/lib/__tests__/resolve-session-tenant.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSessionTenant } from "../api-tenant";

test("__ALL__ (vista aggregata) → rifiutato", () => {
  assert.deepEqual(resolveSessionTenant("__ALL__"), { ok: false });
});

test("tenant specifico → passa quel tenant", () => {
  assert.deepEqual(resolveSessionTenant("70791"), { ok: true, tenant: "70791" });
});

test("assente/null/vuoto (single-tenant/legacy) → DEFAULT", () => {
  assert.deepEqual(resolveSessionTenant(null), { ok: true, tenant: "DEFAULT" });
  assert.deepEqual(resolveSessionTenant(undefined), { ok: true, tenant: "DEFAULT" });
  assert.deepEqual(resolveSessionTenant(""), { ok: true, tenant: "DEFAULT" });
});
