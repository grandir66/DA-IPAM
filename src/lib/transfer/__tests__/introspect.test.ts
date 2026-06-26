// src/lib/transfer/__tests__/introspect.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "../../db-tenant-schema";
import { listTables, tableColumns, writableColumns, isRekeyColumn, rekeyColumns } from "../schema-introspect";

function db() { const d = new Database(":memory:"); d.exec(TENANT_SCHEMA_SQL); return d; }

test("listTables include networks e hosts", () => {
  const t = listTables(db());
  assert.ok(t.includes("networks"));
  assert.ok(t.includes("hosts"));
});

test("hosts.os_family (GENERATED) è esclusa da writableColumns", () => {
  const d = db();
  const cols = tableColumns(d, "hosts");
  const osFamily = cols.find((c) => c.name === "os_family");
  assert.ok(osFamily, "os_family deve esistere");
  assert.equal(osFamily!.generated, true);
  assert.ok(!writableColumns(d, "hosts").includes("os_family"));
  assert.ok(writableColumns(d, "hosts").includes("ip"));
});

test("isRekeyColumn riconosce le colonne env-key", () => {
  for (const c of ["encrypted_password", "inline_encrypted_password", "token_encrypted", "password_enc", "api_token_enc"]) {
    assert.equal(isRekeyColumn(c), true, c);
  }
  for (const c of ["community_string", "api_token", "api_url", "username", "agent_token_hash"]) {
    assert.equal(isRekeyColumn(c), false, c);
  }
});

test("rekeyColumns(credentials) = encrypted_username, encrypted_password", () => {
  assert.deepEqual(rekeyColumns(db(), "credentials").sort(), ["encrypted_password", "encrypted_username"]);
});
