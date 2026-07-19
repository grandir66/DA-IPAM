/**
 * Test G1 — canAccessClientConfig: la config cliente è accessibile solo al proprio
 * tenant (o al superadmin). Chiude il leak cross-tenant di /api/client-config.
 * Run: node --import tsx --test src/lib/__tests__/client-config-access.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessClientConfig, isSuperadmin } from "../client-config-access";

const sess = (role: string | undefined, tenantCode: string | null | undefined) =>
  ({ user: { role, tenantCode } });

test("superadmin → accede a qualsiasi codice", () => {
  assert.equal(canAccessClientConfig(sess("superadmin", "__ALL__"), "70791"), true);
  assert.equal(canAccessClientConfig(sess("superadmin", "12345"), "70791"), true);
});

test("admin/viewer → solo il proprio tenant", () => {
  assert.equal(canAccessClientConfig(sess("admin", "70791"), "70791"), true);
  assert.equal(canAccessClientConfig(sess("admin", "70791"), "99999"), false); // cross-tenant negato
  assert.equal(canAccessClientConfig(sess("viewer", "70791"), "70791"), true);
  assert.equal(canAccessClientConfig(sess("viewer", "70791"), "99999"), false);
});

test("nessun tenant / __ALL__ per non-superadmin → negato", () => {
  assert.equal(canAccessClientConfig(sess("admin", null), "70791"), false);
  assert.equal(canAccessClientConfig(sess("admin", undefined), "70791"), false);
  assert.equal(canAccessClientConfig(sess("admin", "__ALL__"), "70791"), false);
});

test("isSuperadmin", () => {
  assert.equal(isSuperadmin(sess("superadmin", "x")), true);
  assert.equal(isSuperadmin(sess("admin", "x")), false);
});
