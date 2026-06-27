# MDM Connector (Headwind) — DA-IPAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DA-IPAM pulls Android device inventory from a self-hosted Headwind MDM server (REST+JWT) and surfaces each device as a first-class host with a dedicated mobile profile + change history.

**Architecture:** A `hmdm-client` (JWT login + paginated device search + deviceinfo plugin per-device) feeds an `mdm-sync` mapper that dedups by snapshot hash, diffs into an append-only history, and merges each device into the `hosts` table by serial/imei/number. A staggered cron drives periodic pulls. UI under `/settings/mdm` configures the connection; the host detail page shows the mobile profile + timeline.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, better-sqlite3 (tenant DBs), Zod v4, AES-GCM crypto helpers, `node --import tsx --test`. Live test server: Headwind `headwindmdm/hmdm:0.1.8` at `http://192.168.99.50:8088`.

## Global Constraints

- Branch governance: develop on `dev`, never push to `main` directly (promote via UI). End with `npm run version:release`.
- API routes: admin CRUD/trigger use `requireAdmin()`; read endpoints use `requireAuth()`. `req.json()` in try/catch → 400. Zod errors `.issues`.
- Tenant DB access only inside `withTenant(code, fn)` / `withTenantFromSession` — never silent `DEFAULT.db` fallback.
- `hosts.os_family` is a GENERATED VIRTUAL column derived from `hosts.os_info`; mobile OS set by writing `os_info` (`"Android <ver>"`); extend the generated CASE to emit `Android`/`iOS`. Reuse the existing `rebuildHostsOsFamilyLegacy()` path (os_family ALTER bomb — never ad-hoc ALTER).
- Secrets at rest via `encrypt()`/`safeDecrypt()` from `@/lib/crypto`. Never log credentials/JWT.
- Headwind REST contract is authoritative in [docs/integrations/hmdm/hmdm-rest-contract.md](../../integrations/hmdm/hmdm-rest-contract.md). Base path `/rest`. Two-call strategy: `POST /rest/private/devices/search` (DeviceView, no `model`) + `GET /rest/plugins/deviceinfo/deviceinfo/private/{number}` (DeviceInfoView with model + apps). Merge host key: serial → imei → number. Not available: manufacturer, security_patch, storage, MAC.
- Test command: `node --import tsx --test <file>`.

---

## File Structure

- Modify `src/lib/db-tenant-schema.ts` — add `mdm_config` + 4 mobile tables; extend os_family CASE.
- Modify `src/lib/db-tenant.ts` — extend `OS_FAMILY_GENERATED_SQL` (Android/iOS) + rebuild trigger.
- Create `src/lib/integrations/hmdm-client.ts` — JWT login, device search, deviceinfo fetch.
- Create `src/lib/integrations/mdm-config.ts` — tenant config read/write (encrypted password, cached JWT).
- Create `src/lib/integrations/mdm-sync.ts` — map + dedup + diff/history + host merge.
- Create `src/lib/integrations/__tests__/mdm-sync.test.ts` — unit tests (tenant DB).
- Create `src/app/api/mdm/config/route.ts` — GET/PUT config (admin).
- Create `src/app/api/mdm/sync/route.ts` — POST manual sync trigger (admin).
- Create `src/app/api/mdm/by-host/[hostId]/route.ts` — GET mobile detail for a host (auth).
- Modify scheduler registration (scheduled_jobs) — add staggered `mdm_sync` job.
- Create `src/app/(dashboard)/settings/mdm/page.tsx` + `MdmSettingsClient.tsx` — config UI.
- Create `src/components/mobile/MobileProfilePanel.tsx` — host-detail profile + timeline.
- Create `scripts/test-mdm-connector.ts` — end-to-end against the live hmdm test instance.

---

### Task 1: Schema — mdm_config + mobile tables + os_family Android/iOS

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (`TENANT_SCHEMA_SQL`, `TENANT_INDEXES_SQL`)
- Modify: `src/lib/db-tenant.ts` (`OS_FAMILY_GENERATED_SQL` + rebuild trigger)

**Interfaces:**
- Produces tables: `mdm_config`, `mobile_devices`, `mobile_device_inventory`, `mobile_device_apps`, `mobile_inventory_history` (schemas exactly as spec §4.4).

- [ ] **Step 1: Append tables to `TENANT_SCHEMA_SQL`**

```sql
CREATE TABLE IF NOT EXISTS mdm_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT, username TEXT, password_encrypted TEXT,
  jwt_cached TEXT, jwt_expires_at TEXT,
  user_field TEXT DEFAULT 'description',
  enabled INTEGER DEFAULT 0, last_sync_at TEXT, last_error TEXT,
  consecutive_errors INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mobile_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hmdm_device_id TEXT UNIQUE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  label TEXT, last_seen_at TEXT, last_sync_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mobile_device_inventory (
  device_id INTEGER PRIMARY KEY REFERENCES mobile_devices(id) ON DELETE CASCADE,
  serial TEXT, model TEXT, os_family TEXT, os_version TEXT,
  user_profile TEXT, imei TEXT, imei2 TEXT, phone TEXT, cpu TEXT, battery_level INTEGER,
  snapshot_sha256 TEXT, last_inventory_at TEXT
);
CREATE TABLE IF NOT EXISTS mobile_device_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL, app_name TEXT, version_name TEXT,
  first_seen TEXT, last_seen TEXT,
  UNIQUE(device_id, package_name)
);
CREATE TABLE IF NOT EXISTS mobile_inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  changed_at TEXT DEFAULT (datetime('now')),
  change_type TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT
);
```

Add to `TENANT_INDEXES_SQL`:

```sql
CREATE INDEX IF NOT EXISTS idx_mobile_hist_dev ON mobile_inventory_history(device_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_mobile_apps_dev ON mobile_device_apps(device_id);
```

- [ ] **Step 2: Extend os_family generated CASE (both copies, byte-identical)**

In `src/lib/db-tenant-schema.ts` (hosts table) AND `src/lib/db-tenant.ts` (`OS_FAMILY_GENERATED_SQL`), add these two branches BEFORE the existing macOS/Apple branch:

```sql
        WHEN LOWER(os_info) LIKE '%android%' THEN 'Android'
        WHEN LOWER(os_info) LIKE 'ios%' OR LOWER(os_info) LIKE '%ipados%'
          OR LOWER(os_info) LIKE '%iphone%' OR LOWER(os_info) LIKE '%ipad%' THEN 'iOS'
```

Confirm `rebuildHostsOsFamilyLegacy()` rebuilds `hosts` when the stored `os_family` SQL differs from the new `OS_FAMILY_GENERATED_SQL`; if its guard only matches the legacy double-quote bug, widen it to also rebuild on definition mismatch. Do NOT write an ad-hoc ALTER.

- [ ] **Step 3: Verify on a fresh tenant**

Run:
```bash
node --import tsx -e "import('./src/lib/db-tenant.ts').then(m=>{m.withTenant('TESTMDM',()=>{const db=m.getTenantDb('TESTMDM');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'mobile_%' OR name='mdm_config'\").all());console.log('android:', db.prepare(\"SELECT sql FROM sqlite_master WHERE name='hosts'\").get().sql.includes('Android'));});m.deleteTenantDatabase('TESTMDM');})"
```
Expected: prints `mdm_config` + 4 `mobile_*` tables and `android: true`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts
git commit -m "feat(mdm): tenant schema (mdm_config + mobile tables) + os_family Android/iOS"
```

---

### Task 2: hmdm REST client

**Files:**
- Create: `src/lib/integrations/hmdm-client.ts`
- Test: `src/lib/integrations/__tests__/hmdm-client.test.ts`

**Interfaces:**
- Produces:
  - `type HmdmCreds = { baseUrl: string; username: string; password: string }`
  - `loginJwt(c: HmdmCreds): Promise<string>` — POST `/rest/public/jwt/login`, returns token string (throws on non-200).
  - `searchDevices(baseUrl: string, jwt: string, pageNum: number, pageSize: number): Promise<DeviceView[]>` — POST `/rest/private/devices/search`.
  - `getDeviceInfo(baseUrl: string, jwt: string, number: string): Promise<DeviceInfoView | null>` — GET `/rest/plugins/deviceinfo/deviceinfo/private/{number}`.
  - Types `DeviceView` (number, serial, imei, phone, androidVersion, description, custom1..3, lastUpdate, enrollTime, info, statusCode) and `DeviceInfoView` (model, serial, imei, androidVersion, batteryLevel, applications: DeviceInfoApplication[]) and `DeviceInfoApplication` (applicationName, applicationPkg, versionInstalled).

- [ ] **Step 1: Write the failing test (response-shape parsing, no network)**

```ts
// src/lib/integrations/__tests__/hmdm-client.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeviceSearchResponse, parseDeviceInfoResponse } from "../hmdm-client";

test("parse device search payload", () => {
  const raw = { data: { devices: { items: [{ number: "A1", serial: "RZ8", imei: "35", androidVersion: "15",
    description: "mario", lastUpdate: 1719400000000, info: "{}" }] } } };
  const list = parseDeviceSearchResponse(raw);
  assert.equal(list.length, 1);
  assert.equal(list[0].number, "A1");
  assert.equal(list[0].serial, "RZ8");
});

test("parse deviceinfo payload", () => {
  const raw = { data: { model: "Pixel 8", serial: "RZ8", androidVersion: "15", batteryLevel: 80,
    applications: [{ applicationPkg: "com.whatsapp", applicationName: "WhatsApp", versionInstalled: "2.26" }] } };
  const di = parseDeviceInfoResponse(raw);
  assert.equal(di!.model, "Pixel 8");
  assert.equal(di!.applications.length, 1);
  assert.equal(di!.applications[0].applicationPkg, "com.whatsapp");
});
```

> NOTE: Headwind wraps payloads as `{ status: "OK", data: ... }`. The search `data` shape (`devices.items` vs `items`) must be confirmed against the live instance during Task 8; adjust `parseDeviceSearchResponse` to the real shape there. Keep the parser tolerant (optional chaining).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/integrations/__tests__/hmdm-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/integrations/hmdm-client.ts
export type HmdmCreds = { baseUrl: string; username: string; password: string };
export interface DeviceView {
  number: string; serial: string | null; imei: string | null; phone: string | null;
  androidVersion: string | null; description: string | null;
  custom1: string | null; custom2: string | null; custom3: string | null;
  lastUpdate: number | null; enrollTime: number | null; info: string | null; statusCode: string | null;
}
export interface DeviceInfoApplication { applicationName: string | null; applicationPkg: string; versionInstalled: string | null; }
export interface DeviceInfoView {
  model: string | null; serial: string | null; imei: string | null;
  androidVersion: string | null; batteryLevel: number | null; cpu: string | null;
  applications: DeviceInfoApplication[];
}

function base(u: string) { return u.replace(/\/+$/, ""); }

import crypto from "node:crypto";
// Headwind expects password = MD5(plaintext) hex lowercase (web UI hashes client-side);
// server verifies SHA1(md5 + "5YdSYHyg2U"). Sending plaintext → 401. Token is in `id_token`.
function md5hex(s: string) { return crypto.createHash("md5").update(s).digest("hex"); }

export async function loginJwt(c: HmdmCreds): Promise<string> {
  const res = await fetch(`${base(c.baseUrl)}/rest/public/jwt/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: c.username, password: md5hex(c.password) }),
  });
  if (!res.ok) throw new Error(`hmdm login failed: ${res.status}`);
  const j = await res.json();
  const token = j?.id_token ?? j?.data?.id_token;
  if (!token) throw new Error("hmdm login: no id_token in response");
  return token as string;
}

export function parseDeviceSearchResponse(raw: unknown): DeviceView[] {
  const r = raw as { data?: { devices?: { items?: unknown[] }; items?: unknown[] } };
  const items = (r?.data?.devices?.items ?? r?.data?.items ?? []) as Record<string, unknown>[];
  return items.map((d) => ({
    number: String(d.number ?? ""), serial: (d.serial as string) ?? null, imei: (d.imei as string) ?? null,
    phone: (d.phone as string) ?? null, androidVersion: (d.androidVersion as string) ?? null,
    description: (d.description as string) ?? null,
    custom1: (d.custom1 as string) ?? null, custom2: (d.custom2 as string) ?? null, custom3: (d.custom3 as string) ?? null,
    lastUpdate: (d.lastUpdate as number) ?? null, enrollTime: (d.enrollTime as number) ?? null,
    info: (d.info as string) ?? null, statusCode: (d.statusCode as string) ?? null,
  }));
}

export function parseDeviceInfoResponse(raw: unknown): DeviceInfoView | null {
  const d = (raw as { data?: Record<string, unknown> })?.data;
  if (!d) return null;
  const apps = (d.applications as Record<string, unknown>[] | undefined) ?? [];
  return {
    model: (d.model as string) ?? null, serial: (d.serial as string) ?? null, imei: (d.imei as string) ?? null,
    androidVersion: (d.androidVersion as string) ?? null, batteryLevel: (d.batteryLevel as number) ?? null,
    cpu: (d.cpu as string) ?? null,
    applications: apps.map((a) => ({
      applicationName: (a.applicationName as string) ?? null,
      applicationPkg: String(a.applicationPkg ?? ""), versionInstalled: (a.versionInstalled as string) ?? null,
    })).filter((a) => a.applicationPkg),
  };
}

export async function searchDevices(baseUrl: string, jwt: string, pageNum: number, pageSize: number): Promise<DeviceView[]> {
  const res = await fetch(`${base(baseUrl)}/rest/private/devices/search`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ pageNum, pageSize, sortBy: "number", sortDir: "ASC", value: "" }),
  });
  if (!res.ok) throw new Error(`hmdm device search failed: ${res.status}`);
  return parseDeviceSearchResponse(await res.json());
}

export async function getDeviceInfo(baseUrl: string, jwt: string, number: string): Promise<DeviceInfoView | null> {
  const res = await fetch(`${base(baseUrl)}/rest/plugins/deviceinfo/deviceinfo/private/${encodeURIComponent(number)}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`hmdm deviceinfo failed: ${res.status}`);
  return parseDeviceInfoResponse(await res.json());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/integrations/__tests__/hmdm-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/hmdm-client.ts src/lib/integrations/__tests__/hmdm-client.test.ts
git commit -m "feat(mdm): Headwind REST client (jwt login, device search, deviceinfo)"
```

---

### Task 3: Tenant config helper

**Files:**
- Create: `src/lib/integrations/mdm-config.ts`
- Test: `src/lib/integrations/__tests__/mdm-config.test.ts`

**Interfaces:**
- Consumes: `getTenantDb`/`getCurrentTenantCode` (db-tenant), `encrypt`/`safeDecrypt` (crypto).
- Produces:
  - `type MdmConfig = { base_url: string|null; username: string|null; user_field: string; enabled: boolean; last_sync_at: string|null; last_error: string|null; consecutive_errors: number }`
  - `getMdmConfig(): MdmConfig` (password never returned)
  - `getMdmCreds(): { baseUrl: string; username: string; password: string } | null` (decrypts password)
  - `saveMdmConfig(input: { base_url: string; username: string; password?: string; user_field?: string; enabled?: boolean }): void`
  - `recordSync(ok: boolean, error?: string): void` (updates last_sync_at / last_error / consecutive_errors with auto-disable at >=5)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/integrations/__tests__/mdm-config.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase } from "@/lib/db-tenant";
import { saveMdmConfig, getMdmConfig, getMdmCreds, recordSync } from "../mdm-config";

const T = "TESTMDMCFG";
after(() => deleteTenantDatabase(T));

test("config save/read + creds decrypt + auto-disable", () => {
  withTenant(T, () => {
    saveMdmConfig({ base_url: "http://h:8088", username: "admin", password: "secret", enabled: true });
    const cfg = getMdmConfig();
    assert.equal(cfg.base_url, "http://h:8088");
    assert.equal(cfg.enabled, true);
    assert.equal((cfg as Record<string, unknown>).password_encrypted, undefined); // never leaked
    assert.equal(getMdmCreds()!.password, "secret");
    for (let i = 0; i < 5; i++) recordSync(false, "boom");
    assert.equal(getMdmConfig().enabled, false); // auto-disabled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/integrations/__tests__/mdm-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/integrations/mdm-config.ts
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { encrypt, safeDecrypt } from "@/lib/crypto";

export interface MdmConfig {
  base_url: string | null; username: string | null; user_field: string;
  enabled: boolean; last_sync_at: string | null; last_error: string | null; consecutive_errors: number;
}
function db() { const c = getCurrentTenantCode(); if (!c) throw new Error("mdm-config: no tenant"); return getTenantDb(c); }

export function getMdmConfig(): MdmConfig {
  const r = db().prepare(`SELECT base_url, username, user_field, enabled, last_sync_at, last_error, consecutive_errors FROM mdm_config WHERE id=1`).get() as Record<string, unknown> | undefined;
  return {
    base_url: (r?.base_url as string) ?? null, username: (r?.username as string) ?? null,
    user_field: (r?.user_field as string) ?? "description", enabled: !!(r?.enabled),
    last_sync_at: (r?.last_sync_at as string) ?? null, last_error: (r?.last_error as string) ?? null,
    consecutive_errors: (r?.consecutive_errors as number) ?? 0,
  };
}
export function getMdmCreds(): { baseUrl: string; username: string; password: string } | null {
  const r = db().prepare(`SELECT base_url, username, password_encrypted FROM mdm_config WHERE id=1`).get() as Record<string, unknown> | undefined;
  if (!r?.base_url || !r?.username || !r?.password_encrypted) return null;
  const pwd = safeDecrypt(r.password_encrypted as string);
  if (pwd == null) return null;
  return { baseUrl: r.base_url as string, username: r.username as string, password: pwd };
}
export function saveMdmConfig(input: { base_url: string; username: string; password?: string; user_field?: string; enabled?: boolean }): void {
  const conn = db();
  const existing = conn.prepare(`SELECT password_encrypted FROM mdm_config WHERE id=1`).get() as { password_encrypted?: string } | undefined;
  const enc = input.password ? encrypt(input.password) : (existing?.password_encrypted ?? null);
  conn.prepare(
    `INSERT INTO mdm_config (id, base_url, username, password_encrypted, user_field, enabled)
     VALUES (1, @base_url, @username, @enc, @user_field, @enabled)
     ON CONFLICT(id) DO UPDATE SET base_url=@base_url, username=@username,
       password_encrypted=@enc, user_field=@user_field, enabled=@enabled`
  ).run({ base_url: input.base_url, username: input.username, enc,
    user_field: input.user_field ?? "description", enabled: input.enabled ? 1 : 0 });
}
export function recordSync(ok: boolean, error?: string): void {
  const conn = db();
  if (ok) {
    conn.prepare(`UPDATE mdm_config SET last_sync_at=datetime('now'), last_error=NULL, consecutive_errors=0 WHERE id=1`).run();
  } else {
    conn.prepare(`UPDATE mdm_config SET last_sync_at=datetime('now'), last_error=?, consecutive_errors=consecutive_errors+1 WHERE id=1`).run(error ?? "error");
    conn.prepare(`UPDATE mdm_config SET enabled=0 WHERE id=1 AND consecutive_errors>=5`).run();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/integrations/__tests__/mdm-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/mdm-config.ts src/lib/integrations/__tests__/mdm-config.test.ts
git commit -m "feat(mdm): tenant config helper (encrypted creds, auto-disable)"
```

---

### Task 4: mdm-sync — map + dedup + diff/history + host merge

**Files:**
- Create: `src/lib/integrations/mdm-sync.ts`
- Test: `src/lib/integrations/__tests__/mdm-sync.test.ts`

**Interfaces:**
- Consumes: `DeviceView`/`DeviceInfoView` (hmdm-client), `upsertHost`/`getHostByMac` analogues (db-tenant), `getMdmConfig` (mdm-config).
- Produces:
  - `applyDevice(dv: DeviceView, di: DeviceInfoView | null): { deviceId: number; deduped: boolean; changes: number; hostId: number | null }`
  - `getMobileDetailByHost(hostId: number): { device; inventory; apps; history } | null`

> Pure mapping/persistence; runs inside a `withTenant` context. Network is the caller's job (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/integrations/__tests__/mdm-sync.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase } from "@/lib/db-tenant";
import { applyDevice, getMobileDetailByHost } from "../mdm-sync";

const T = "TESTMDMSYNC";
after(() => deleteTenantDatabase(T));

const dv = (over = {}) => ({ number: "A1", serial: "RZ8", imei: "35", phone: null, androidVersion: "15",
  description: "mario.rossi", custom1: null, custom2: null, custom3: null,
  lastUpdate: 1719400000000, enrollTime: 1719000000000, info: "{}", statusCode: "GREEN", ...over });
const di = (apps: string[], model = "Pixel 8", os = "15") => ({ model, serial: "RZ8", imei: "35",
  androidVersion: os, batteryLevel: 80, cpu: "arm64",
  applications: apps.map((p) => ({ applicationName: p, applicationPkg: p, versionInstalled: "1.0" })) });

test("apply device: insert, dedup, diff, host merge", () => {
  withTenant(T, () => {
    const r1 = applyDevice(dv(), di(["com.whatsapp", "com.android.chrome"]));
    assert.equal(r1.deduped, false);
    assert.ok(r1.hostId);

    const r2 = applyDevice(dv(), di(["com.whatsapp", "com.android.chrome"]));
    assert.equal(r2.deduped, true);

    const r3 = applyDevice(dv(), di(["com.whatsapp", "com.new"], "Pixel 8", "16")); // os change + app add/remove
    assert.equal(r3.deduped, false);

    const detail = getMobileDetailByHost(r1.hostId!)!;
    assert.equal(detail.inventory.os_version, "16");
    assert.equal(detail.inventory.os_family, "android");
    const types = detail.history.map((h: { change_type: string }) => h.change_type);
    assert.ok(types.includes("os_update"));
    assert.ok(types.includes("app_added"));
    assert.ok(types.includes("app_removed"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/integrations/__tests__/mdm-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/integrations/mdm-sync.ts
import crypto from "node:crypto";
import { getTenantDb, getCurrentTenantCode, upsertHost } from "@/lib/db-tenant";
import { getMdmConfig } from "./mdm-config";
import type { DeviceView, DeviceInfoView } from "./hmdm-client";

function db() { const c = getCurrentTenantCode(); if (!c) throw new Error("mdm-sync: no tenant"); return getTenantDb(c); }
function isoFromMillis(ms: number | null): string | null { return ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : null; }
function pickUser(dv: DeviceView, field: string): string | null {
  const map: Record<string, string | null> = { description: dv.description, custom1: dv.custom1, custom2: dv.custom2, custom3: dv.custom3 };
  return map[field] ?? dv.description ?? null;
}

export function applyDevice(dv: DeviceView, di: DeviceInfoView | null): { deviceId: number; deduped: boolean; changes: number; hostId: number | null } {
  const conn = db();
  const cfg = getMdmConfig();
  const model = di?.model ?? null;
  const apps = di?.applications ?? [];
  const snapshot = crypto.createHash("sha256").update(JSON.stringify({
    serial: dv.serial, model, os: dv.androidVersion, user: pickUser(dv, cfg.user_field),
    apps: apps.map((a) => `${a.applicationPkg}@${a.versionInstalled}`).sort(),
  })).digest("hex");

  const tx = conn.transaction(() => {
    let dev = conn.prepare(`SELECT id, host_id FROM mobile_devices WHERE hmdm_device_id=?`).get(dv.number) as { id: number; host_id: number | null } | undefined;
    if (!dev) {
      const r = conn.prepare(`INSERT INTO mobile_devices (hmdm_device_id, label, created_at) VALUES (?,?,datetime('now'))`).run(dv.number, model ?? dv.number);
      dev = { id: Number(r.lastInsertRowid), host_id: null };
    }
    const deviceId = dev.id;
    const prev = conn.prepare(`SELECT * FROM mobile_device_inventory WHERE device_id=?`).get(deviceId) as Record<string, unknown> | undefined;

    if (prev && prev.snapshot_sha256 === snapshot) {
      conn.prepare(`UPDATE mobile_devices SET last_seen_at=?, last_sync_at=datetime('now') WHERE id=?`).run(isoFromMillis(dv.lastUpdate), deviceId);
      return { deviceId, deduped: true, changes: 0, hostId: dev.host_id };
    }
    let changes = 0;
    const log = (t: string, f: string | null, o: unknown, n: unknown) => { conn.prepare(`INSERT INTO mobile_inventory_history (device_id, change_type, field, old_value, new_value) VALUES (?,?,?,?,?)`).run(deviceId, t, f, o == null ? null : String(o), n == null ? null : String(n)); changes++; };

    const user = pickUser(dv, cfg.user_field);
    if (prev) {
      if ((prev.os_version ?? null) !== (dv.androidVersion ?? null)) log("os_update", "os_version", prev.os_version, dv.androidVersion);
      if ((prev.user_profile ?? null) !== (user ?? null)) log("user_change", "user_profile", prev.user_profile, user);
      if ((prev.model ?? null) !== (model ?? null)) log("field_change", "model", prev.model, model);
      if ((prev.serial ?? null) !== (dv.serial ?? null)) log("field_change", "serial", prev.serial, dv.serial);
    }

    conn.prepare(
      `INSERT INTO mobile_device_inventory (device_id, serial, model, os_family, os_version, user_profile, imei, phone, cpu, battery_level, snapshot_sha256, last_inventory_at)
       VALUES (@device_id,@serial,@model,'android',@os,@user,@imei,@phone,@cpu,@batt,@snap, datetime('now'))
       ON CONFLICT(device_id) DO UPDATE SET serial=@serial, model=@model, os_family='android', os_version=@os,
         user_profile=@user, imei=@imei, phone=@phone, cpu=@cpu, battery_level=@batt, snapshot_sha256=@snap, last_inventory_at=datetime('now')`
    ).run({ device_id: deviceId, serial: dv.serial, model, os: dv.androidVersion, user, imei: dv.imei, phone: dv.phone,
      cpu: di?.cpu ?? null, batt: di?.batteryLevel ?? null, snap: snapshot });

    // apps diff
    const prevApps = conn.prepare(`SELECT package_name, version_name FROM mobile_device_apps WHERE device_id=?`).all(deviceId) as Array<{ package_name: string; version_name: string | null }>;
    const prevSet = new Set(prevApps.map((a) => a.package_name));
    const nextSet = new Set(apps.map((a) => a.applicationPkg));
    for (const a of apps) {
      conn.prepare(`INSERT INTO mobile_device_apps (device_id, package_name, app_name, version_name, first_seen, last_seen)
        VALUES (?,?,?,?, datetime('now'), datetime('now'))
        ON CONFLICT(device_id, package_name) DO UPDATE SET app_name=excluded.app_name, version_name=excluded.version_name, last_seen=datetime('now')`)
        .run(deviceId, a.applicationPkg, a.applicationName, a.versionInstalled);
      if (!prevSet.has(a.applicationPkg)) log("app_added", a.applicationPkg, null, a.versionInstalled);
    }
    for (const a of prevApps) if (!nextSet.has(a.package_name)) {
      conn.prepare(`DELETE FROM mobile_device_apps WHERE device_id=? AND package_name=?`).run(deviceId, a.package_name);
      log("app_removed", a.package_name, a.version_name, null);
    }

    // host merge by serial -> imei -> number
    let hostId = dev.host_id;
    const host = upsertHost({ ip: "", mac: "", hostname: model ?? dv.number,
      os_info: `Android ${dv.androidVersion ?? ""}`.trim(), serial_number: dv.serial ?? undefined,
      model: model ?? undefined, status: "online", preserve_existing: true } as never);
    if (host) hostId = host.id;
    conn.prepare(`UPDATE mobile_devices SET host_id=?, last_seen_at=?, last_sync_at=datetime('now') WHERE id=?`).run(hostId, isoFromMillis(dv.lastUpdate), deviceId);
    return { deviceId, deduped: false, changes, hostId };
  });
  return tx();
}

export function getMobileDetailByHost(hostId: number) {
  const conn = db();
  const device = conn.prepare(`SELECT * FROM mobile_devices WHERE host_id=? ORDER BY id DESC LIMIT 1`).get(hostId) as { id: number } | undefined;
  if (!device) return null;
  const inventory = conn.prepare(`SELECT * FROM mobile_device_inventory WHERE device_id=?`).get(device.id);
  const apps = conn.prepare(`SELECT * FROM mobile_device_apps WHERE device_id=? ORDER BY app_name`).all(device.id);
  const history = conn.prepare(`SELECT * FROM mobile_inventory_history WHERE device_id=? ORDER BY changed_at DESC, id DESC LIMIT 500`).all(device.id);
  return { device, inventory, apps, history };
}
```

> NOTE: confirm `upsertHost` accepts an empty `ip`/`mac` and merges by `serial_number`. If it requires a non-empty IP or merges only by MAC, first look up an existing host by serial (`getHostBySerial` or a query on `hosts.serial_number`) and `updateHost`; create with a placeholder IP only if none exists. The merge key per the contract is serial → imei → number, NOT MAC.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/integrations/__tests__/mdm-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/mdm-sync.ts src/lib/integrations/__tests__/mdm-sync.test.ts
git commit -m "feat(mdm): device mapper (dedup, diff/history, host merge by serial)"
```

---

### Task 5: Sync orchestrator (network + config glue)

**Files:**
- Create: `src/lib/integrations/mdm-runner.ts`

**Interfaces:**
- Consumes: `getMdmConfig`/`getMdmCreds`/`recordSync` (mdm-config), `loginJwt`/`searchDevices`/`getDeviceInfo` (hmdm-client), `applyDevice` (mdm-sync).
- Produces: `runMdmSync(): Promise<{ devices: number; changed: number; error?: string }>` — runs inside a `withTenant` context.

- [ ] **Step 1: Implement the runner**

```ts
// src/lib/integrations/mdm-runner.ts
import { getMdmConfig, getMdmCreds, recordSync } from "./mdm-config";
import { loginJwt, searchDevices, getDeviceInfo } from "./hmdm-client";
import { applyDevice } from "./mdm-sync";

export async function runMdmSync(): Promise<{ devices: number; changed: number; error?: string }> {
  const cfg = getMdmConfig();
  if (!cfg.enabled) return { devices: 0, changed: 0, error: "disabled" };
  const creds = getMdmCreds();
  if (!creds) { recordSync(false, "no credentials"); return { devices: 0, changed: 0, error: "no credentials" }; }
  try {
    const jwt = await loginJwt(creds);
    let page = 1; const pageSize = 50; let total = 0; let changed = 0;   // hmdm pageNum is 1-based (0 → 500 OFFSET error)
    for (;;) {
      const batch = await searchDevices(creds.baseUrl, jwt, page, pageSize);
      if (batch.length === 0) break;
      for (const dv of batch) {
        const di = await getDeviceInfo(creds.baseUrl, jwt, dv.number).catch(() => null);
        const r = applyDevice(dv, di);
        total++; if (!r.deduped) changed += r.changes;
      }
      if (batch.length < pageSize) break;
      page++;
    }
    recordSync(true);
    return { devices: total, changed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync error";
    recordSync(false, msg);
    return { devices: 0, changed: 0, error: msg };
  }
}
```

> Note: `applyDevice`/`recordSync` touch the tenant DB; callers must wrap `runMdmSync()` in `withTenant(code, () => runMdmSync())`. Since `runMdmSync` is async and `withTenant` is sync, capture creds/config inside the tenant context or use the async tenant pattern already used by other integrations (check `wazuh-sync.ts` for how it bridges async network + tenant DB writes; mirror it).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors (except `.next/...`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/mdm-runner.ts
git commit -m "feat(mdm): sync orchestrator (paginated pull + per-device enrich)"
```

---

### Task 6: API endpoints (config / sync / by-host)

**Files:**
- Create: `src/app/api/mdm/config/route.ts` (GET + PUT, admin)
- Create: `src/app/api/mdm/sync/route.ts` (POST manual trigger, admin)
- Create: `src/app/api/mdm/by-host/[hostId]/route.ts` (GET, auth)

**Interfaces:**
- Consumes: `requireAuth`/`requireAdmin`, `withTenantFromSession`, `getMdmConfig`/`saveMdmConfig`, `runMdmSync`, `getMobileDetailByHost`.

- [ ] **Step 1: config route**

```ts
// src/app/api/mdm/config/route.ts
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMdmConfig, saveMdmConfig } from "@/lib/integrations/mdm-config";
import { z } from "zod";

export async function GET() {
  const a = await requireAdmin(); if (a instanceof Response) return a;
  return Response.json({ config: await withTenantFromSession(() => getMdmConfig()) });
}
const schema = z.object({ base_url: z.string().url(), username: z.string().min(1),
  password: z.string().optional(), user_field: z.enum(["description","custom1","custom2","custom3"]).optional(),
  enabled: z.boolean().optional() });
export async function PUT(req: Request) {
  const a = await requireAdmin(); if (a instanceof Response) return a;
  let body: unknown; try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const p = schema.safeParse(body); if (!p.success) return Response.json({ error: p.error.issues }, { status: 400 });
  await withTenantFromSession(() => saveMdmConfig(p.data));
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: sync route**

```ts
// src/app/api/mdm/sync/route.ts
import { requireAdmin } from "@/lib/api-auth";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { runMdmSync } from "@/lib/integrations/mdm-runner";

export async function POST() {
  const a = await requireAdmin(); if (a instanceof Response) return a;
  const code = await getServerTenantCode();
  // bridge async network + tenant context (mirror wazuh-sync trigger route)
  const result = await withTenant(code, () => runMdmSync());
  return Response.json(result);
}
```

> If `withTenant` (sync) cannot wrap an async fn cleanly, copy the exact bridging used by the Wazuh sync trigger route (`src/app/api/.../wazuh/sync/route.ts`).

- [ ] **Step 3: by-host route**

```ts
// src/app/api/mdm/by-host/[hostId]/route.ts
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMobileDetailByHost } from "@/lib/integrations/mdm-sync";

export async function GET(_req: Request, { params }: { params: Promise<{ hostId: string }> }) {
  const a = await requireAuth(); if (a instanceof Response) return a;
  const { hostId } = await params;
  const detail = await withTenantFromSession(() => getMobileDetailByHost(Number(hostId)));
  return Response.json({ detail });
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect 0 errors).
```bash
git add src/app/api/mdm
git commit -m "feat(mdm): config/sync/by-host API endpoints"
```

---

### Task 7: Scheduled job (staggered cron)

**Files:**
- Modify: scheduler registration (find it: grep `scheduled_jobs` + the node-cron registration, e.g. `src/lib/scheduler*.ts`; mirror how `wazuh`/`librenms` sync jobs are registered + staggered).

**Interfaces:**
- Produces: a `mdm_sync` scheduled job that calls `withTenant(code, () => runMdmSync())` per enabled tenant, staggered (jitter) like LibreNMS/Wazuh.

- [ ] **Step 1: Register the job**

Add an `mdm_sync` entry to the scheduler with a default interval (e.g. every 15 min), guarded by `getMdmConfig().enabled`, with the same staggering/jitter pattern used by the Wazuh/LibreNMS sync jobs. Do NOT add a raw `setInterval`; use the existing `scheduled_jobs` + node-cron mechanism (see memory: in-memory scheduler trap — toggling requires the job API/restart, not a bare SQL update).

- [ ] **Step 2: Verify the job appears**

Run the app (`npm run dev`), open `/settings/updates` or the scheduled-jobs view, confirm `mdm_sync` is listed.
Expected: job present, runs without throwing when MDM disabled (early-returns).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mdm): staggered scheduled sync job"
```

---

### Task 8: Live smoke against the test hmdm instance

**Files:**
- Create: `scripts/test-mdm-connector.ts`

**Pre-req (runtime, document in the script header):**
- Headwind test instance reachable at `http://192.168.99.50:8088` (already installed).
- A known admin account on that instance + the **deviceinfo plugin enabled**. If admin creds are unknown, create one via the hmdm panel / SQL, and (ideally) enroll one test/emulator device so `search` returns ≥1 row. Without an enrolled device the script still validates login + empty search shape.

- [ ] **Step 1: Write the script**

```ts
// scripts/test-mdm-connector.ts
// Usage: HMDM_URL=http://192.168.99.50:8088 HMDM_USER=admin HMDM_PASS=... node --import tsx scripts/test-mdm-connector.ts
import { loginJwt, searchDevices, getDeviceInfo } from "../src/lib/integrations/hmdm-client";

async function main() {
  const baseUrl = process.env.HMDM_URL!, username = process.env.HMDM_USER!, password = process.env.HMDM_PASS!;
  const jwt = await loginJwt({ baseUrl, username, password });
  console.log("login OK, jwt len", jwt.length);
  const devices = await searchDevices(baseUrl, jwt, 1, 50); // 1-based
  console.log("devices:", devices.length, devices.map((d) => d.number));
  if (devices[0]) {
    const di = await getDeviceInfo(baseUrl, jwt, devices[0].number);
    console.log("deviceinfo[0]:", JSON.stringify({ model: di?.model, apps: di?.applications.length }, null, 2));
  }
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
```

- [ ] **Step 2: Run it (confirms login + real response shapes)**

Run: `HMDM_URL=http://192.168.99.50:8088 HMDM_USER=<admin> HMDM_PASS=<pass> node --import tsx scripts/test-mdm-connector.ts`
Expected: `login OK`; prints device list. **If the printed JSON shape differs from `parseDeviceSearchResponse` assumptions, fix the parser in `hmdm-client.ts` (Task 2) to match, then re-run.** This is the moment the response-shape NOTE from Task 2 gets resolved against reality.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-mdm-connector.ts src/lib/integrations/hmdm-client.ts
git commit -m "test(mdm): live smoke against Headwind; align parser to real response shape"
```

---

### Task 9: UI — /settings/mdm config

**Files:**
- Create: `src/app/(dashboard)/settings/mdm/page.tsx`
- Create: `src/app/(dashboard)/settings/mdm/MdmSettingsClient.tsx`

- [ ] **Step 1: Server page**

```tsx
// src/app/(dashboard)/settings/mdm/page.tsx
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMdmConfig } from "@/lib/integrations/mdm-config";
import { MdmSettingsClient } from "./MdmSettingsClient";

export default async function Page() {
  const config = await withTenantFromSession(() => getMdmConfig());
  return <MdmSettingsClient initialConfig={config} />;
}
```

- [ ] **Step 2: Client component**

Implement a form (base_url, username, password [write-only], user_field select, enabled toggle) that PUTs `/api/mdm/config`, a "Sincronizza ora" button that POSTs `/api/mdm/sync` and shows `{devices, changed}`, and a status line (`last_sync_at`, `last_error`, `consecutive_errors`) plus an external link to the Headwind panel (`<base_url>`). After mutations call `router.refresh()`. Follow an existing `settings/` sibling page's styling.

- [ ] **Step 3: Verify in browser**

Open `/settings/mdm`, save config pointing at `http://192.168.99.50:8088`, click "Sincronizza ora".
Expected: status updates; on valid creds devices are pulled.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/settings/mdm"
git commit -m "feat(mdm): settings UI (config + manual sync + status)"
```

---

### Task 10: UI — host-detail mobile profile + timeline

**Files:**
- Create: `src/components/mobile/MobileProfilePanel.tsx`
- Modify: host-detail page (grep for `hosts/[id]/page.tsx` or the host detail route) to mount the panel when `os_family` is Android/iOS.

- [ ] **Step 1: Panel component**

Create `MobileProfilePanel.tsx` (client) that fetches `/api/mdm/by-host/<hostId>`; when `detail` is present render: serial/model/os_version/user_profile/battery, the **full app list** (table from `detail.apps`), and a **timeline** from `detail.history` (icon per `change_type`, `changed_at`, `field`, old→new). Match existing host-detail panel styling.

- [ ] **Step 2: Mount on host detail**

In the host-detail page, render `<MobileProfilePanel hostId={host.id} />` only when `host.os_family` is `Android` or `iOS`.

- [ ] **Step 3: Verify in browser**

After a successful sync with ≥1 device, open that device's host. Confirm the profile, app list, and timeline render.

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile "src/app/**/hosts/[id]/page.tsx"
git commit -m "feat(mdm): host-detail mobile profile panel + change timeline"
```

---

### Task 11: Full verification + release

- [ ] **Step 1: Unit tests**

Run: `node --import tsx --test src/lib/integrations/__tests__/hmdm-client.test.ts src/lib/integrations/__tests__/mdm-config.test.ts src/lib/integrations/__tests__/mdm-sync.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && rm -rf .next && npm run build`
Expected: 0 lint errors, 0 type errors, build OK.

- [ ] **Step 3: Release**

Run: `npm run version:release` (patch bump + `release: vX.Y.Z` on `dev`).

---

## Self-Review

**Spec coverage:**
- §4.1 config → Task 3, Task 6, Task 9.
- §4.2 auth (JWT) → Task 2 (`loginJwt`).
- §4.3 pull (search + deviceinfo) → Tasks 2, 5.
- §4.4 data model (mdm_config + 4 tables, os_family) → Task 1.
- §4.5 ingest (dedup/diff/history/host merge) → Task 4.
- §4.6 UI (settings + host profile + timeline) → Tasks 9, 10.
- §5 error handling (try/catch, Zod .issues, auto-disable, withTenant, safeDecrypt) → Tasks 3, 6.
- §6 testing → Tasks 2/3/4 (unit) + Task 8 (live).
- §7 sequence → tasks ordered accordingly.

**Open items flagged for implementation (not blockers):**
- hmdm response wrapper shape (`data.devices.items` vs `data.items`) — resolved in Task 8 against the live instance; parser kept tolerant.
- `loginJwt` token field name (`data.authToken` vs `authToken`/`token`) — resolved in Task 8.
- `upsertHost` empty-ip/mac + merge-by-serial behaviour — Task 4 NOTE; adjust to the real signature.
- async/`withTenant` bridging — mirror `wazuh-sync` (Tasks 5, 6/7).

**Placeholder scan:** none — code steps contain full code; UI Tasks 9/10 step 2 reference existing sibling-page styling (acceptable).

**Type consistency:** `DeviceView`/`DeviceInfoView`/`DeviceInfoApplication` consistent across Tasks 2/4/5/8. `applyDevice` return `{ deviceId, deduped, changes, hostId }` consistent across Tasks 4/5. `getMdmConfig`/`getMdmCreds`/`recordSync` consistent across Tasks 3/5/6.
```

> The Deploy-Appliance Docker module (component A) is a separate plan in the Deploy-Appliance repo; this plan develops/tests against the already-running test instance at `192.168.99.50:8088`.
