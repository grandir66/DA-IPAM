# Mobile Agent Inventory — Backend DA-IPAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DA-IPAM backend (enrollment, idempotent inventory ingest, data model, change history, UI) that lets a corporate Android agent push device inventory so mobiles appear as first-class hosts.

**Architecture:** Stateless push from the agent authenticated by a per-device Bearer token. A global registry DB (`mobile-agents-registry.db`) maps `token_hash → tenant + agent_id` so a session-less push resolves its tenant; the full agent record + inventory live in the tenant DB. Ingest dedups by snapshot hash, diffs against prior state into an append-only history, and merges the device into the existing `hosts` table.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, better-sqlite3 (tenant DBs under `data/tenants/<code>.db`), Zod v4, bcrypt, AES-GCM crypto helpers, `node --import tsx --test`.

## Global Constraints

- Branch governance: develop on `dev`, never push to `main` directly (promote via UI).
- Every code change → `npm run version:release` at the end (DA-IPAM versioning).
- API routes: integration endpoints use custom Bearer auth (NO `requireAuth`/NextAuth, like edge-bridges); admin CRUD endpoints use `requireAdmin()`.
- `req.json()` always in try/catch → `400 "Invalid JSON"`. Zod errors use `.issues` (not `.errors`).
- Tenant-scoped DB access only inside `withTenant(code, fn)` / `withTenantFromSession` — never let it fall back to `DEFAULT.db` silently.
- `hosts.os_family` is a GENERATED VIRTUAL column derived from `hosts.os_info`. Mobile OS is set by writing `os_info` (e.g. `"Android 15"`), and the generated CASE must be extended to emit `Android`/`iOS`.
- bcrypt cost 12. Tokens: `crypto.randomBytes(32).toString("base64url")`. Token at rest: `token_hash` (bcrypt) + `token_encrypted` (AES-GCM via `encrypt()` from `src/lib/crypto.ts`) for one-time re-display.
- Test command pattern: `node --import tsx --test <file>` (project has no jest/vitest).

---

## File Structure

- Create `src/lib/mobile-agents/registry-db.ts` — global cross-tenant registry DB (open + schema + lookup/insert/revoke).
- Create `src/lib/mobile-agents/tokens.ts` — token generation/hash/verify helpers.
- Create `src/lib/mobile-agents/auth.ts` — `authenticateMobileAgent(req)` middleware.
- Create `src/lib/mobile-agents/schemas.ts` — Zod schemas for enroll/inventory/heartbeat payloads.
- Create `src/lib/mobile-agents/db.ts` — tenant DB helpers (agent CRUD, inventory upsert, app diff, history).
- Modify `src/lib/db-tenant-schema.ts` — add 4 tenant tables + extend os_family CASE.
- Modify `src/lib/db-tenant.ts` — runtime migration to extend os_family CASE on existing DBs.
- Create `src/app/api/mobile-agents/enroll/route.ts` — POST enroll.
- Create `src/app/api/mobile-agents/inventory/route.ts` — POST inventory.
- Create `src/app/api/mobile-agents/heartbeat/route.ts` — POST heartbeat.
- Create `src/app/api/mobile-agents/route.ts` — admin CRUD (list/create).
- Create `src/app/api/mobile-agents/[id]/route.ts` — admin revoke/delete.
- Create UI under `src/app/(dashboard)/settings/mobile-agents/` — list + create (QR) + revoke.
- Modify host-detail page — mobile profile panel + change timeline.
- Create `scripts/test-mobile-agent.ts` — end-to-end mock-agent test.
- Tests under `src/lib/mobile-agents/__tests__/`.

---

### Task 1: Global registry DB module

**Files:**
- Create: `src/lib/mobile-agents/registry-db.ts`
- Test: `src/lib/mobile-agents/__tests__/registry-db.test.ts`

**Interfaces:**
- Produces:
  - `getRegistryDb(): Database.Database`
  - `registerAgentToken(tokenHash: string, tenantCode: string, agentId: number): void`
  - `lookupActiveByTokenHash(tokenHash: string): { tenant_id: string; agent_id: number } | undefined`
  - `listActiveRegistryRows(): Array<{ token_hash: string; tenant_id: string; agent_id: number }>`
  - `revokeRegistryToken(tokenHash: string): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mobile-agents/__tests__/registry-db.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAgentToken, lookupActiveByTokenHash, revokeRegistryToken } from "../registry-db";

test("register + lookup + revoke round-trip", () => {
  const h = "hash-" + Math.floor(process.hrtime()[1]); // unique per run
  registerAgentToken(h, "DEFAULT", 7);
  assert.deepEqual(lookupActiveByTokenHash(h), { tenant_id: "DEFAULT", agent_id: 7 });
  revokeRegistryToken(h);
  assert.equal(lookupActiveByTokenHash(h), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/registry-db.test.ts`
Expected: FAIL — `Cannot find module '../registry-db'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mobile-agents/registry-db.ts
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { resolveDataDir } from "@/lib/data-dir";

let _db: Database.Database | null = null;

export function getRegistryDb(): Database.Database {
  if (_db) return _db;
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "mobile-agents-registry.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_agent_registry (
      token_hash TEXT PRIMARY KEY,
      tenant_id  TEXT NOT NULL,
      agent_id   INTEGER NOT NULL,
      state      TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_registry_state ON mobile_agent_registry(state);
  `);
  _db = db;
  return db;
}

export function registerAgentToken(tokenHash: string, tenantCode: string, agentId: number): void {
  getRegistryDb()
    .prepare(`INSERT OR REPLACE INTO mobile_agent_registry (token_hash, tenant_id, agent_id, state)
              VALUES (?, ?, ?, 'active')`)
    .run(tokenHash, tenantCode, agentId);
}

export function lookupActiveByTokenHash(tokenHash: string): { tenant_id: string; agent_id: number } | undefined {
  return getRegistryDb()
    .prepare(`SELECT tenant_id, agent_id FROM mobile_agent_registry WHERE token_hash = ? AND state = 'active'`)
    .get(tokenHash) as { tenant_id: string; agent_id: number } | undefined;
}

export function listActiveRegistryRows(): Array<{ token_hash: string; tenant_id: string; agent_id: number }> {
  return getRegistryDb()
    .prepare(`SELECT token_hash, tenant_id, agent_id FROM mobile_agent_registry WHERE state = 'active'`)
    .all() as Array<{ token_hash: string; tenant_id: string; agent_id: number }>;
}

export function revokeRegistryToken(tokenHash: string): void {
  getRegistryDb().prepare(`UPDATE mobile_agent_registry SET state='revoked' WHERE token_hash = ?`).run(tokenHash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/registry-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile-agents/registry-db.ts src/lib/mobile-agents/__tests__/registry-db.test.ts
git commit -m "feat(mobile-agents): global token registry DB"
```

---

### Task 2: Token helpers

**Files:**
- Create: `src/lib/mobile-agents/tokens.ts`
- Test: `src/lib/mobile-agents/__tests__/tokens.test.ts`

**Interfaces:**
- Consumes: `bcrypt`, `encrypt` from `@/lib/crypto`.
- Produces:
  - `generateToken(): string`
  - `hashToken(plain: string): Promise<string>` (bcrypt cost 12)
  - `verifyToken(plain: string, hash: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mobile-agents/__tests__/tokens.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashToken, verifyToken } from "../tokens";

test("token generate/hash/verify", async () => {
  const t = generateToken();
  assert.ok(t.length >= 40);
  const h = await hashToken(t);
  assert.ok(await verifyToken(t, h));
  assert.equal(await verifyToken("wrong", h), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mobile-agents/tokens.ts
import crypto from "node:crypto";

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function hashToken(plain: string): Promise<string> {
  const bcrypt = await import("bcrypt");
  return bcrypt.hash(plain, 12);
}

export async function verifyToken(plain: string, hash: string): Promise<boolean> {
  const bcrypt = await import("bcrypt");
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile-agents/tokens.ts src/lib/mobile-agents/__tests__/tokens.test.ts
git commit -m "feat(mobile-agents): token generate/hash/verify helpers"
```

---

### Task 3: Tenant schema tables + os_family extension

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (append tables to `TENANT_SCHEMA_SQL`; extend os_family CASE)
- Modify: `src/lib/db-tenant.ts` (runtime migration for existing DBs: extend os_family CASE; new tables are `IF NOT EXISTS` so auto-create)

**Interfaces:**
- Produces tables: `mobile_agents`, `mobile_device_inventory`, `mobile_device_apps`, `mobile_inventory_history` (schemas exactly as in spec §5).

- [ ] **Step 1: Add the four tables to `TENANT_SCHEMA_SQL`**

Append inside the `TENANT_SCHEMA_SQL` template literal in `src/lib/db-tenant-schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS mobile_agents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  label             TEXT NOT NULL,
  host_id           INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  device_fingerprint TEXT UNIQUE,
  token_hash        TEXT NOT NULL,
  token_encrypted   TEXT NOT NULL,
  platform          TEXT,
  enrollment_mode   TEXT,
  agent_version     TEXT,
  state             TEXT NOT NULL DEFAULT 'active',
  enrolled_at       TEXT,
  last_seen_at      TEXT,
  last_inventory_at TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mobile_device_inventory (
  agent_id          INTEGER PRIMARY KEY REFERENCES mobile_agents(id) ON DELETE CASCADE,
  serial            TEXT, model TEXT, manufacturer TEXT,
  os_family         TEXT, os_version TEXT, security_patch TEXT,
  user_profile      TEXT, imei TEXT,
  storage_total_mb  INTEGER, storage_free_mb INTEGER,
  primary_mac       TEXT, snapshot_sha256 TEXT, last_inventory_at TEXT
);
CREATE TABLE IF NOT EXISTS mobile_device_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES mobile_agents(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL, app_name TEXT,
  version_name TEXT, version_code INTEGER,
  system_app INTEGER DEFAULT 0, first_seen TEXT, last_seen TEXT,
  UNIQUE(agent_id, package_name)
);
CREATE TABLE IF NOT EXISTS mobile_inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES mobile_agents(id) ON DELETE CASCADE,
  changed_at TEXT DEFAULT (datetime('now')),
  change_type TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT
);
```

Also add to `TENANT_INDEXES_SQL`:

```sql
CREATE INDEX IF NOT EXISTS idx_mobile_history_agent ON mobile_inventory_history(agent_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_mobile_apps_agent ON mobile_device_apps(agent_id);
```

- [ ] **Step 2: Extend the os_family generated CASE**

In `src/lib/db-tenant-schema.ts` find the `hosts` table's `os_family GENERATED ALWAYS AS (CASE ... END) VIRTUAL` and add the Apple-iOS and Android branches BEFORE the macOS branch (iOS must win over a generic `mac`/`darwin` match):

```sql
        WHEN LOWER(os_info) LIKE '%android%' THEN 'Android'
        WHEN LOWER(os_info) LIKE '%ios %' OR LOWER(os_info) LIKE 'ios%'
          OR LOWER(os_info) LIKE '%ipados%' OR LOWER(os_info) LIKE '%iphone%'
          OR LOWER(os_info) LIKE '%ipad%' THEN 'iOS'
```

Apply the identical two branches to `OS_FAMILY_GENERATED_SQL` in `src/lib/db-tenant.ts` (the runtime migration copy), keeping the two strings byte-identical so the generated-column definitions match.

- [ ] **Step 3: Trigger the os_family rebuild on existing DBs**

The existing `rebuildHostsOsFamilyLegacy()` path in `src/lib/db-tenant.ts` recreates `hosts` when the stored `os_family` definition differs from `OS_FAMILY_GENERATED_SQL`. Confirm (read the function) that it compares the live `sql` from `sqlite_master` against the new definition and rebuilds on mismatch. If it only checks for the legacy double-quote bug, extend its guard so a definition mismatch (new Android/iOS branches absent) also triggers the rebuild. Do NOT write a fresh ALTER — reuse the rebuild helper (see memory: "os_family ALTER bomb").

- [ ] **Step 4: Verify schema loads on a fresh tenant**

Run:
```bash
node --import tsx -e "import('./src/lib/db-tenant.ts').then(m=>{m.withTenant('TESTMOB',()=>{const db=m.getTenantDb('TESTMOB');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'mobile_%'\").all());console.log(db.prepare(\"SELECT sql FROM sqlite_master WHERE name='hosts'\").get().sql.includes('Android'));});m.deleteTenantDatabase('TESTMOB');})"
```
Expected: prints the 4 `mobile_*` table names and `true` (hosts os_family includes Android).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts
git commit -m "feat(mobile-agents): tenant schema tables + os_family Android/iOS"
```

---

### Task 4: Zod payload schemas

**Files:**
- Create: `src/lib/mobile-agents/schemas.ts`
- Test: `src/lib/mobile-agents/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: `enrollSchema`, `inventorySchema`, `heartbeatSchema` (Zod) + inferred types `EnrollInput`, `InventoryInput`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mobile-agents/__tests__/schemas.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { enrollSchema, inventorySchema } from "../schemas";

test("enroll requires fingerprint+platform+mode+version", () => {
  assert.equal(enrollSchema.safeParse({}).success, false);
  assert.equal(enrollSchema.safeParse({
    device_fingerprint: "abc", platform: "android",
    enrollment_mode: "device_owner", agent_version: "1.0.0",
  }).success, true);
});

test("inventory requires snapshot+device+apps", () => {
  const ok = inventorySchema.safeParse({
    snapshot_sha256: "x", captured_at: "2026-06-26T10:00:00Z",
    device: { model: "Pixel 8", manufacturer: "Google", os_family: "android", os_version: "15" },
    apps: [{ package_name: "com.whatsapp" }],
  });
  assert.equal(ok.success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/schemas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mobile-agents/schemas.ts
import { z } from "zod";

export const enrollSchema = z.object({
  device_fingerprint: z.string().min(1),
  platform: z.enum(["android", "ios"]),
  enrollment_mode: z.enum(["device_owner", "work_profile", "unmanaged"]),
  agent_version: z.string().min(1),
  model: z.string().optional(),
  label: z.string().optional(),
});

export const inventorySchema = z.object({
  snapshot_sha256: z.string().min(1),
  captured_at: z.string().min(1),
  device: z.object({
    serial: z.string().nullish(),
    model: z.string().min(1),
    manufacturer: z.string().min(1),
    os_family: z.enum(["android", "ios"]),
    os_version: z.string().min(1),
    security_patch: z.string().nullish(),
    user_profile: z.string().nullish(),
    imei: z.string().nullish(),
    primary_mac: z.string().nullish(),
    storage_total_mb: z.number().int().nullish(),
    storage_free_mb: z.number().int().nullish(),
  }),
  apps: z.array(z.object({
    package_name: z.string().min(1),
    app_name: z.string().nullish(),
    version_name: z.string().nullish(),
    version_code: z.number().int().nullish(),
    system_app: z.boolean().default(false),
  })),
});

export const heartbeatSchema = z.object({ agent_version: z.string().optional() });

export type EnrollInput = z.infer<typeof enrollSchema>;
export type InventoryInput = z.infer<typeof inventorySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile-agents/schemas.ts src/lib/mobile-agents/__tests__/schemas.test.ts
git commit -m "feat(mobile-agents): Zod payload schemas"
```

---

### Task 5: Tenant DB helpers (agent CRUD + inventory diff + history)

**Files:**
- Create: `src/lib/mobile-agents/db.ts`
- Test: `src/lib/mobile-agents/__tests__/db.test.ts`

**Interfaces:**
- Consumes: `getTenantDb`/`withTenant`/`upsertHost`/`getHostByMac` from `@/lib/db-tenant`; `InventoryInput` from `../schemas`.
- Produces:
  - `createMobileAgent(input: { label: string; tokenHash: string; tokenEncrypted: string }): number` (returns agentId)
  - `finalizeEnroll(agentId: number, p: { deviceFingerprint: string; platform: string; enrollmentMode: string; agentVersion: string }): void`
  - `touchSeen(agentId: number, agentVersion?: string): void`
  - `applyInventory(agentId: number, inv: InventoryInput): { deduped: boolean; changes: number; hostId: number | null }`
  - `listMobileAgents(): MobileAgentRow[]`
  - `getMobileAgentDetail(agentId: number): { agent: MobileAgentRow; inventory: any; apps: any[]; history: any[] } | undefined`

> All functions assume they run inside a `withTenant(code, ...)` context (they call `getTenantDb` with the current tenant).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mobile-agents/__tests__/db.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase } from "@/lib/db-tenant";
import { createMobileAgent, applyInventory, getMobileAgentDetail } from "../db";

const T = "TESTMOBDB";
after(() => deleteTenantDatabase(T));

test("apply inventory: insert, dedup, diff", () => {
  withTenant(T, () => {
    const id = createMobileAgent({ label: "Phone A", tokenHash: "h", tokenEncrypted: "e" });
    const base = {
      snapshot_sha256: "s1", captured_at: "2026-06-26T10:00:00Z",
      device: { model: "Pixel 8", manufacturer: "Google", os_family: "android", os_version: "15",
                primary_mac: "AA:BB:CC:DD:EE:01" },
      apps: [{ package_name: "com.whatsapp", system_app: false },
             { package_name: "com.android.chrome", system_app: true }],
    } as any;

    const r1 = applyInventory(id, base);
    assert.equal(r1.deduped, false);
    assert.ok(r1.hostId);

    const r2 = applyInventory(id, base); // same snapshot
    assert.equal(r2.deduped, true);

    const changed = { ...base, snapshot_sha256: "s2",
      device: { ...base.device, os_version: "16" },
      apps: [{ package_name: "com.whatsapp", system_app: false },
             { package_name: "com.new.app", system_app: false }] }; // chrome removed, new.app added
    const r3 = applyInventory(id, changed);
    assert.equal(r3.deduped, false);

    const detail = getMobileAgentDetail(id)!;
    assert.equal(detail.inventory.os_version, "16");
    const types = detail.history.map((h: any) => h.change_type);
    assert.ok(types.includes("os_update") || types.includes("field_change"));
    assert.ok(types.includes("app_added"));
    assert.ok(types.includes("app_removed"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mobile-agents/db.ts
import { getTenantDb, getCurrentTenantCode, upsertHost } from "@/lib/db-tenant";
import type { InventoryInput } from "./schemas";

export interface MobileAgentRow {
  id: number; label: string; host_id: number | null; platform: string | null;
  enrollment_mode: string | null; agent_version: string | null; state: string;
  enrolled_at: string | null; last_seen_at: string | null; last_inventory_at: string | null;
}

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("mobile-agents db: no tenant context");
  return getTenantDb(code);
}

export function createMobileAgent(input: { label: string; tokenHash: string; tokenEncrypted: string }): number {
  const r = db().prepare(
    `INSERT INTO mobile_agents (label, token_hash, token_encrypted, state, created_at)
     VALUES (?, ?, ?, 'active', datetime('now'))`
  ).run(input.label, input.tokenHash, input.tokenEncrypted);
  return Number(r.lastInsertRowid);
}

export function finalizeEnroll(agentId: number, p: { deviceFingerprint: string; platform: string; enrollmentMode: string; agentVersion: string }): void {
  db().prepare(
    `UPDATE mobile_agents SET device_fingerprint=?, platform=?, enrollment_mode=?, agent_version=?,
       enrolled_at=datetime('now'), last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
  ).run(p.deviceFingerprint, p.platform, p.enrollmentMode, p.agentVersion, agentId);
}

export function touchSeen(agentId: number, agentVersion?: string): void {
  db().prepare(
    `UPDATE mobile_agents SET last_seen_at=datetime('now')${agentVersion ? ", agent_version=?" : ""} WHERE id=?`
  ).run(...(agentVersion ? [agentVersion, agentId] : [agentId]) as never[]);
}

function logHistory(agentId: number, change_type: string, field: string | null, oldV: string | null, newV: string | null) {
  db().prepare(
    `INSERT INTO mobile_inventory_history (agent_id, change_type, field, old_value, new_value) VALUES (?,?,?,?,?)`
  ).run(agentId, change_type, field, oldV, newV);
}

export function applyInventory(agentId: number, inv: InventoryInput): { deduped: boolean; changes: number; hostId: number | null } {
  const conn = db();
  const tx = conn.transaction(() => {
    const prev = conn.prepare(`SELECT * FROM mobile_device_inventory WHERE agent_id=?`).get(agentId) as any;
    if (prev && prev.snapshot_sha256 === inv.snapshot_sha256) {
      conn.prepare(`UPDATE mobile_agents SET last_seen_at=datetime('now'), last_inventory_at=datetime('now') WHERE id=?`).run(agentId);
      return { deduped: true, changes: 0, hostId: prev_host(agentId) };
    }
    let changes = 0;
    const d = inv.device;

    // field diffs
    if (prev) {
      const fields: Array<[string, string, any, any]> = [
        ["os_update", "os_version", prev.os_version, d.os_version],
        ["patch_update", "security_patch", prev.security_patch, d.security_patch ?? null],
        ["user_change", "user_profile", prev.user_profile, d.user_profile ?? null],
        ["field_change", "model", prev.model, d.model],
        ["field_change", "serial", prev.serial, d.serial ?? null],
      ];
      for (const [type, field, o, n] of fields) {
        if ((o ?? null) !== (n ?? null)) { logHistory(agentId, type, field, o ?? null, n ?? null); changes++; }
      }
    }

    // upsert inventory snapshot
    conn.prepare(
      `INSERT INTO mobile_device_inventory
         (agent_id, serial, model, manufacturer, os_family, os_version, security_patch,
          user_profile, imei, storage_total_mb, storage_free_mb, primary_mac, snapshot_sha256, last_inventory_at)
       VALUES (@agent_id,@serial,@model,@manufacturer,@os_family,@os_version,@security_patch,
          @user_profile,@imei,@storage_total_mb,@storage_free_mb,@primary_mac,@snapshot_sha256, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
          serial=@serial, model=@model, manufacturer=@manufacturer, os_family=@os_family,
          os_version=@os_version, security_patch=@security_patch, user_profile=@user_profile,
          imei=@imei, storage_total_mb=@storage_total_mb, storage_free_mb=@storage_free_mb,
          primary_mac=@primary_mac, snapshot_sha256=@snapshot_sha256, last_inventory_at=datetime('now')`
    ).run({
      agent_id: agentId, serial: d.serial ?? null, model: d.model, manufacturer: d.manufacturer,
      os_family: d.os_family, os_version: d.os_version, security_patch: d.security_patch ?? null,
      user_profile: d.user_profile ?? null, imei: d.imei ?? null,
      storage_total_mb: d.storage_total_mb ?? null, storage_free_mb: d.storage_free_mb ?? null,
      primary_mac: d.primary_mac ?? null, snapshot_sha256: inv.snapshot_sha256,
    });

    // app diff
    const prevApps = conn.prepare(`SELECT package_name, version_name FROM mobile_device_apps WHERE agent_id=?`).all(agentId) as Array<{ package_name: string; version_name: string | null }>;
    const prevSet = new Map(prevApps.map((a) => [a.package_name, a.version_name]));
    const nextSet = new Set(inv.apps.map((a) => a.package_name));
    for (const a of inv.apps) {
      const existed = prevSet.has(a.package_name);
      conn.prepare(
        `INSERT INTO mobile_device_apps (agent_id, package_name, app_name, version_name, version_code, system_app, first_seen, last_seen)
         VALUES (?,?,?,?,?,?, datetime('now'), datetime('now'))
         ON CONFLICT(agent_id, package_name) DO UPDATE SET
           app_name=excluded.app_name, version_name=excluded.version_name,
           version_code=excluded.version_code, system_app=excluded.system_app, last_seen=datetime('now')`
      ).run(agentId, a.package_name, a.app_name ?? null, a.version_name ?? null, a.version_code ?? null, a.system_app ? 1 : 0);
      if (!existed) { logHistory(agentId, "app_added", a.package_name, null, a.version_name ?? null); changes++; }
    }
    for (const a of prevApps) {
      if (!nextSet.has(a.package_name)) {
        conn.prepare(`DELETE FROM mobile_device_apps WHERE agent_id=? AND package_name=?`).run(agentId, a.package_name);
        logHistory(agentId, "app_removed", a.package_name, a.version_name ?? null, null); changes++;
      }
    }

    // merge into hosts (first-class) when we have a MAC
    let hostId: number | null = prev_host(agentId);
    if (d.primary_mac) {
      const host = upsertHost({
        ip: "", mac: d.primary_mac, hostname: inv.device.model,
        os_info: `${d.os_family === "ios" ? "iOS" : "Android"} ${d.os_version}`,
        serial_number: d.serial ?? undefined, model: d.model,
        device_manufacturer: d.manufacturer, status: "online", preserve_existing: true,
      } as never);
      if (host) {
        hostId = host.id;
        conn.prepare(`UPDATE mobile_agents SET host_id=?, last_inventory_at=datetime('now') WHERE id=?`).run(hostId, agentId);
      }
    } else {
      conn.prepare(`UPDATE mobile_agents SET last_inventory_at=datetime('now') WHERE id=?`).run(agentId);
    }
    conn.prepare(`UPDATE mobile_agents SET last_seen_at=datetime('now') WHERE id=?`).run(agentId);
    return { deduped: false, changes, hostId };
  });
  return tx();
}

function prev_host(agentId: number): number | null {
  const r = db().prepare(`SELECT host_id FROM mobile_agents WHERE id=?`).get(agentId) as { host_id: number | null } | undefined;
  return r?.host_id ?? null;
}

export function listMobileAgents(): MobileAgentRow[] {
  return db().prepare(
    `SELECT id,label,host_id,platform,enrollment_mode,agent_version,state,enrolled_at,last_seen_at,last_inventory_at
     FROM mobile_agents ORDER BY id DESC`
  ).all() as MobileAgentRow[];
}

export function getMobileAgentDetail(agentId: number) {
  const conn = db();
  const agent = conn.prepare(`SELECT id,label,host_id,platform,enrollment_mode,agent_version,state,enrolled_at,last_seen_at,last_inventory_at FROM mobile_agents WHERE id=?`).get(agentId) as MobileAgentRow | undefined;
  if (!agent) return undefined;
  const inventory = conn.prepare(`SELECT * FROM mobile_device_inventory WHERE agent_id=?`).get(agentId);
  const apps = conn.prepare(`SELECT * FROM mobile_device_apps WHERE agent_id=? ORDER BY app_name`).all(agentId);
  const history = conn.prepare(`SELECT * FROM mobile_inventory_history WHERE agent_id=? ORDER BY changed_at DESC, id DESC LIMIT 500`).all(agentId);
  return { agent, inventory, apps, history };
}
```

> NOTE: verify `upsertHost`'s exact accepted fields against `src/lib/db-tenant.ts:1578` and adjust the call to match (the signature there is the source of truth). If `upsertHost` rejects an empty `ip`, pass a sentinel or look up via `getHostByMac` first and `updateHost` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile-agents/db.ts src/lib/mobile-agents/__tests__/db.test.ts
git commit -m "feat(mobile-agents): tenant DB helpers + inventory diff/history + host merge"
```

---

### Task 6: Auth middleware

**Files:**
- Create: `src/lib/mobile-agents/auth.ts`
- Test: `src/lib/mobile-agents/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `listActiveRegistryRows` (registry-db), `verifyToken` (tokens).
- Produces: `authenticateMobileAgent(req: Request): Promise<{ tenantId: string; agentId: number } | Response>` — returns a `401` Response on failure.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mobile-agents/__tests__/auth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateMobileAgent } from "../auth";
import { registerAgentToken, revokeRegistryToken } from "../registry-db";
import { generateToken, hashToken } from "../tokens";

test("auth: valid token resolves, revoked fails", async () => {
  const t = generateToken();
  const h = await hashToken(t);
  registerAgentToken(h, "DEFAULT", 99);

  const ok = await authenticateMobileAgent(new Request("http://x", { headers: { authorization: `Bearer ${t}` } }));
  assert.deepEqual(ok, { tenantId: "DEFAULT", agentId: 99 });

  const noAuth = await authenticateMobileAgent(new Request("http://x"));
  assert.ok(noAuth instanceof Response && noAuth.status === 401);

  revokeRegistryToken(h);
  const revoked = await authenticateMobileAgent(new Request("http://x", { headers: { authorization: `Bearer ${t}` } }));
  assert.ok(revoked instanceof Response && revoked.status === 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mobile-agents/auth.ts
import { listActiveRegistryRows } from "./registry-db";
import { verifyToken } from "./tokens";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
}

export async function authenticateMobileAgent(req: Request): Promise<{ tenantId: string; agentId: number } | Response> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return unauthorized();
  const token = m[1].trim();
  for (const row of listActiveRegistryRows()) {
    if (await verifyToken(token, row.token_hash)) {
      return { tenantId: row.tenant_id, agentId: row.agent_id };
    }
  }
  return unauthorized();
}
```

> Performance note: bcrypt.compare loops over active rows. Acceptable for the expected fleet size (hundreds). If it ever grows, add a fast pre-filter column (e.g. a non-secret token prefix index). Out of scope now (YAGNI).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile-agents/auth.ts src/lib/mobile-agents/__tests__/auth.test.ts
git commit -m "feat(mobile-agents): authenticateMobileAgent middleware"
```

---

### Task 7: Admin CRUD endpoints (create/list/revoke)

**Files:**
- Create: `src/app/api/mobile-agents/route.ts` (GET list, POST create)
- Create: `src/app/api/mobile-agents/[id]/route.ts` (DELETE revoke)

**Interfaces:**
- Consumes: `requireAdmin`, `withTenantFromSession`, `createMobileAgent`/`listMobileAgents` (db), `generateToken`/`hashToken` (tokens), `encrypt` (crypto), `registerAgentToken`/`revokeRegistryToken` (registry).
- Produces: POST returns `{ agent_id, enrollment_token, qr_payload }` (token shown once).

- [ ] **Step 1: Implement create/list route**

```ts
// src/app/api/mobile-agents/route.ts
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { createMobileAgent, listMobileAgents } from "@/lib/mobile-agents/db";
import { generateToken, hashToken } from "@/lib/mobile-agents/tokens";
import { registerAgentToken } from "@/lib/mobile-agents/registry-db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const agents = await withTenantFromSession(() => listMobileAgents());
  return Response.json({ agents });
}

const createSchema = z.object({ label: z.string().min(1) });

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const tokenEncrypted = encrypt(token);
  const tenantCode = await getServerTenantCode();

  const agentId = await withTenantFromSession(() =>
    createMobileAgent({ label: parsed.data.label, tokenHash, tokenEncrypted })
  );
  registerAgentToken(tokenHash, tenantCode, agentId);

  const base = process.env.MOBILE_AGENT_HUB_URL ?? "";
  return Response.json({
    agent_id: agentId,
    enrollment_token: token,
    qr_payload: JSON.stringify({ hub_base_url: base, enrollment_token: token }),
  });
}
```

- [ ] **Step 2: Implement revoke route**

```ts
// src/app/api/mobile-agents/[id]/route.ts
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { revokeRegistryToken } from "@/lib/mobile-agents/registry-db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const agentId = Number(id);
  const hash = await withTenantFromSession(() => {
    const code = getCurrentTenantCode()!;
    const db = getTenantDb(code);
    const row = db.prepare(`SELECT token_hash FROM mobile_agents WHERE id=?`).get(agentId) as { token_hash: string } | undefined;
    db.prepare(`UPDATE mobile_agents SET state='revoked', updated_at=datetime('now') WHERE id=?`).run(agentId);
    return row?.token_hash ?? null;
  });
  if (hash) revokeRegistryToken(hash);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Manual smoke (dev server running on 3002, logged in as admin)**

Run:
```bash
curl -s -X POST http://localhost:3002/api/mobile-agents -H 'content-type: application/json' \
  -b "$ADMIN_COOKIE" -d '{"label":"Phone Test"}' | head
```
Expected: JSON with `agent_id` and `enrollment_token`. (If 401, ensure a valid admin session cookie in `$ADMIN_COOKIE`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mobile-agents/route.ts src/app/api/mobile-agents/[id]/route.ts
git commit -m "feat(mobile-agents): admin CRUD endpoints (create/list/revoke)"
```

---

### Task 8: enroll / inventory / heartbeat endpoints

**Files:**
- Create: `src/app/api/mobile-agents/enroll/route.ts`
- Create: `src/app/api/mobile-agents/inventory/route.ts`
- Create: `src/app/api/mobile-agents/heartbeat/route.ts`

**Interfaces:**
- Consumes: `authenticateMobileAgent`, `withTenant`, `finalizeEnroll`/`applyInventory`/`touchSeen` (db), `enrollSchema`/`inventorySchema`/`heartbeatSchema`.

- [ ] **Step 1: Implement enroll**

```ts
// src/app/api/mobile-agents/enroll/route.ts
import { authenticateMobileAgent } from "@/lib/mobile-agents/auth";
import { withTenant } from "@/lib/db-tenant";
import { finalizeEnroll } from "@/lib/mobile-agents/db";
import { enrollSchema } from "@/lib/mobile-agents/schemas";

export async function POST(req: Request) {
  const auth = await authenticateMobileAgent(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = enrollSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const p = parsed.data;
  withTenant(auth.tenantId, () => finalizeEnroll(auth.agentId, {
    deviceFingerprint: p.device_fingerprint, platform: p.platform,
    enrollmentMode: p.enrollment_mode, agentVersion: p.agent_version,
  }));
  return Response.json({
    agent_id: auth.agentId,
    device_token: null, // per-device token == enrollment token in v1 (single Bearer); rotation handled by admin re-issue
    heartbeat_interval_sec: 900, inventory_interval_sec: 86400,
  });
}
```

> v1 simplification: the enrollment Bearer IS the per-device token (one token per agent row). The spec's separate `device_token` rotation is deferred; document this in the API contract note. If rotation is required later, generate a new token here, re-`registerAgentToken`, and return it.

- [ ] **Step 2: Implement inventory**

```ts
// src/app/api/mobile-agents/inventory/route.ts
import { authenticateMobileAgent } from "@/lib/mobile-agents/auth";
import { withTenant } from "@/lib/db-tenant";
import { applyInventory } from "@/lib/mobile-agents/db";
import { inventorySchema } from "@/lib/mobile-agents/schemas";

export async function POST(req: Request) {
  const auth = await authenticateMobileAgent(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = inventorySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const result = withTenant(auth.tenantId, () => applyInventory(auth.agentId, parsed.data));
  return Response.json({ ...result, agent_id: auth.agentId });
}
```

- [ ] **Step 3: Implement heartbeat**

```ts
// src/app/api/mobile-agents/heartbeat/route.ts
import { authenticateMobileAgent } from "@/lib/mobile-agents/auth";
import { withTenant } from "@/lib/db-tenant";
import { touchSeen } from "@/lib/mobile-agents/db";
import { heartbeatSchema } from "@/lib/mobile-agents/schemas";

export async function POST(req: Request) {
  const auth = await authenticateMobileAgent(req);
  if (auth instanceof Response) return auth;
  let body: unknown = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }
  const parsed = heartbeatSchema.safeParse(body ?? {});
  const v = parsed.success ? parsed.data.agent_version : undefined;
  withTenant(auth.tenantId, () => touchSeen(auth.agentId, v));
  return Response.json({ ok: true, server_time: new Date().toISOString() });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors (except `.next/dev/types/routes.d.ts` if present).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mobile-agents/enroll src/app/api/mobile-agents/inventory src/app/api/mobile-agents/heartbeat
git commit -m "feat(mobile-agents): enroll/inventory/heartbeat ingest endpoints"
```

---

### Task 9: End-to-end mock-agent script

**Files:**
- Create: `scripts/test-mobile-agent.ts`

**Interfaces:**
- Consumes: running dev server (`http://localhost:3002`) + an admin cookie, OR direct DB calls. This script uses the HTTP path to mirror the real agent.

- [ ] **Step 1: Write the script**

```ts
// scripts/test-mobile-agent.ts
// Usage: ADMIN_COOKIE='next-auth.session-token=...' node --import tsx scripts/test-mobile-agent.ts
const BASE = process.env.BASE ?? "http://localhost:3002";
const COOKIE = process.env.ADMIN_COOKIE ?? "";

async function main() {
  // 1. admin creates agent
  const created = await (await fetch(`${BASE}/api/mobile-agents`, {
    method: "POST", headers: { "content-type": "application/json", cookie: COOKIE },
    body: JSON.stringify({ label: "E2E Phone" }),
  })).json();
  const token = created.enrollment_token;
  const H = { "content-type": "application/json", authorization: `Bearer ${token}` };
  console.log("agent_id", created.agent_id);

  // 2. enroll
  console.log("enroll", await (await fetch(`${BASE}/api/mobile-agents/enroll`, { method: "POST", headers: H,
    body: JSON.stringify({ device_fingerprint: "fp-e2e", platform: "android", enrollment_mode: "device_owner", agent_version: "1.0.0" }) })).json());

  const inv = (snap: string, os: string, apps: string[]) => ({
    snapshot_sha256: snap, captured_at: new Date().toISOString(),
    device: { serial: "RZ8E2E", model: "Pixel 8", manufacturer: "Google", os_family: "android", os_version: os, primary_mac: "AA:BB:CC:DD:EE:E2" },
    apps: apps.map((p) => ({ package_name: p, system_app: false })),
  });

  // 3. push #1
  console.log("push1", await (await fetch(`${BASE}/api/mobile-agents/inventory`, { method: "POST", headers: H, body: JSON.stringify(inv("s1", "15", ["com.whatsapp", "com.android.chrome"])) })).json());
  // 4. push #2 identical -> deduped
  console.log("push2", await (await fetch(`${BASE}/api/mobile-agents/inventory`, { method: "POST", headers: H, body: JSON.stringify(inv("s1", "15", ["com.whatsapp", "com.android.chrome"])) })).json());
  // 5. push #3 changed -> os_update + app_added + app_removed
  console.log("push3", await (await fetch(`${BASE}/api/mobile-agents/inventory`, { method: "POST", headers: H, body: JSON.stringify(inv("s2", "16", ["com.whatsapp", "com.new.app"])) })).json());
  // 6. heartbeat
  console.log("hb", await (await fetch(`${BASE}/api/mobile-agents/heartbeat`, { method: "POST", headers: H, body: "{}" })).json());
}
main();
```

- [ ] **Step 2: Run it (dev server up + admin cookie)**

Run: `ADMIN_COOKIE='<cookie>' node --import tsx scripts/test-mobile-agent.ts`
Expected: `push1` → `deduped:false`, `push2` → `deduped:true`, `push3` → `deduped:false, changes>=3`, `hb` → `ok:true`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-mobile-agent.ts
git commit -m "test(mobile-agents): end-to-end mock-agent script"
```

---

### Task 10: UI — settings list/create/revoke + QR

**Files:**
- Create: `src/app/(dashboard)/settings/mobile-agents/page.tsx`
- Create: `src/app/(dashboard)/settings/mobile-agents/MobileAgentsClient.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/mobile-agents`, `DELETE /api/mobile-agents/[id]`.

- [ ] **Step 1: Server page (reads list)**

```tsx
// src/app/(dashboard)/settings/mobile-agents/page.tsx
import { withTenantFromSession } from "@/lib/api-tenant";
import { listMobileAgents } from "@/lib/mobile-agents/db";
import { MobileAgentsClient } from "./MobileAgentsClient";

export default async function Page() {
  const agents = await withTenantFromSession(() => listMobileAgents());
  return <MobileAgentsClient initialAgents={agents} />;
}
```

- [ ] **Step 2: Client component (create shows token + QR once, revoke)**

Implement a client component with: a "Nuovo agente" form (label) that POSTs and renders the returned `enrollment_token` + a QR of `qr_payload` (use an existing QR lib in the repo if present — check `package.json` for `qrcode`/`qrcode.react`; if absent, render the token text + a copy button and note QR is added when the lib is available). List agents with `last_seen_at`, `state`, and a "Revoca" button calling DELETE, then `router.refresh()`. Follow existing settings-page styling conventions (look at a sibling page under `settings/`).

- [ ] **Step 3: Verify in browser**

Run: open `http://localhost:3002/settings/mobile-agents`, create an agent, confirm token shows once, revoke it.
Expected: agent appears in list; after revoke, `state=revoked`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/settings/mobile-agents"
git commit -m "feat(mobile-agents): settings UI (create/list/revoke + QR)"
```

---

### Task 11: UI — mobile profile panel + change timeline on host detail

**Files:**
- Modify: host-detail page (find it: `src/app/(dashboard)/hosts/[id]/page.tsx` or equivalent — grep for the host detail route)
- Create: `src/components/mobile/MobileProfilePanel.tsx`
- Create: `src/app/api/mobile-agents/by-host/[hostId]/route.ts` (GET detail for a host's linked agent)

**Interfaces:**
- Consumes: `getMobileAgentDetail` via a host→agent lookup.

- [ ] **Step 1: Add a by-host detail endpoint**

```ts
// src/app/api/mobile-agents/by-host/[hostId]/route.ts
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getMobileAgentDetail } from "@/lib/mobile-agents/db";

export async function GET(_req: Request, { params }: { params: Promise<{ hostId: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof Response) return auth;
  const { hostId } = await params;
  const detail = await withTenantFromSession(() => {
    const db = getTenantDb(getCurrentTenantCode()!);
    const row = db.prepare(`SELECT id FROM mobile_agents WHERE host_id=? AND state='active' ORDER BY id DESC LIMIT 1`).get(Number(hostId)) as { id: number } | undefined;
    return row ? getMobileAgentDetail(row.id) : null;
  });
  return Response.json({ detail });
}
```

- [ ] **Step 2: Render the panel on host detail**

Create `MobileProfilePanel.tsx` that fetches `/api/mobile-agents/by-host/<hostId>`; when `detail` is present, render seriale/modello/OS/security_patch/utente, the full app list (table), and a change **timeline** from `history` (icon per `change_type`, `changed_at`, `field`, old→new). Mount it in the host-detail page only when the host is a mobile (`os_family` in Android/iOS). Match existing host-detail panel styling.

- [ ] **Step 3: Verify in browser**

After running the Task 9 script, open the host created for MAC `AA:BB:CC:DD:EE:E2`. Confirm the mobile panel shows the apps and a timeline with os_update + app_added + app_removed.

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile/MobileProfilePanel.tsx "src/app/api/mobile-agents/by-host" src/app/**/hosts/\[id\]/page.tsx
git commit -m "feat(mobile-agents): host-detail mobile profile panel + change timeline"
```

---

### Task 12: Full verification + release

- [ ] **Step 1: Run all unit tests**

Run: `node --import tsx --test src/lib/mobile-agents/__tests__/*.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && rm -rf .next && npm run build`
Expected: 0 lint errors, 0 type errors, build succeeds.

- [ ] **Step 3: Release (on dev)**

Run: `npm run version:release`
Expected: patch bump + `release: vX.Y.Z` commit on `dev`.

---

## Self-Review

**Spec coverage:**
- §2 architecture (push, host first-class, tenant resolution) → Tasks 1, 3, 5.
- §3 enrollment (token gen, QR, revoke) → Tasks 2, 7, 10.
- §4 transport/auth (Bearer, authenticateMobileAgent, idempotent ingest) → Tasks 6, 8.
- §5 data model (registry + 4 tenant tables, os_family android/ios) → Tasks 1, 3.
- §6 ingest & tracking (dedup, diff, history, host merge) → Task 5.
- §7 UI (settings + host detail profile + timeline) → Tasks 10, 11.
- §8 error handling (try/catch json, Zod .issues, 401 WWW-Authenticate, withTenant) → Tasks 6, 7, 8.
- §9 testing (curl/mock script) → Task 9.
- §11 API contract → Tasks 7, 8 (note: v1 collapses device_token into the enrollment Bearer; flagged in Task 8).

**Known deviations from spec to reconcile during implementation:**
- Spec §11.1 returns a distinct `device_token`; v1 reuses the single enrollment Bearer per agent (Task 8 note). Update the spec's API-contract section to match, OR implement rotation in enroll. Decide before building the Android app, since it changes the app's token handling.
- `upsertHost` signature is the source of truth (Task 5 note) — adjust the merge call to the real accepted fields.

**Placeholder scan:** none — every code step contains full code; UI Tasks 10/11 steps 2 describe components referencing existing repo styling (acceptable: they depend on sibling-page conventions the implementer must read).

**Type consistency:** `applyInventory` return `{ deduped, changes, hostId }` consistent across Tasks 5/8/9. `authenticateMobileAgent` returns `{ tenantId, agentId } | Response` consistent across Tasks 6/8. Token helpers names consistent across Tasks 2/6/7.
