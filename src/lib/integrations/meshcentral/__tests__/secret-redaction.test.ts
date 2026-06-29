process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-redaction";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TENANT_TABLES } from "@/lib/transfer/table-registry";

test("meshcentral config secret columns are registered for redaction", () => {
  const entry = TENANT_TABLES.find((e) => e.table === "mc_config");
  assert.ok(entry, "mc_config must be registered in the transfer table-registry");
  assert.ok(
    entry!.secretColumns?.includes("login_token_key_encrypted"),
    "login_token_key_encrypted must be marked as a secret column",
  );
  assert.ok(
    entry!.secretColumns?.includes("admin_pass_encrypted"),
    "admin_pass_encrypted must be marked as a secret column",
  );
});

test("no source file logs the loginTokenKey secret", () => {
  const root = join(process.cwd(), "src");
  const offenders: string[] = [];
  const skip = /(__tests__|\.test\.ts$)/;
  // Logging a secret means passing the decrypted key Buffer/string to console.
  const bad = /console\.(log|info|warn|error|debug)\([^)]*loginTokenKey/;

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (skip.test(p)) continue;
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (p.endsWith(".ts") || p.endsWith(".tsx")) {
        const src = readFileSync(p, "utf8");
        if (bad.test(src)) offenders.push(p);
      }
    }
  };
  walk(root);

  assert.deepEqual(offenders, [], `loginTokenKey must never be logged. Offenders:\n${offenders.join("\n")}`);
});
