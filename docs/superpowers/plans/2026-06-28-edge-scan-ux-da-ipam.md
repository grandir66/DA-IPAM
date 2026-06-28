# Edge Scan UX (DA-IPAM) Implementation Plan — sub-project B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DA-IPAM edge-scan panel explicit and clear: relabeled scope options, a frequency-based schedule builder (daily/weekly/monthly + time + day) that emits a cron, and auto+editable slug names for jobs and returned reports.

**Architecture:** A pure `cron-builder` module turns builder inputs into a 5-field cron + Italian preview + a safe slug name. The schedule config is persisted in a new tenant table `edge_scan_schedules` and sent to the edge (`cron_expr` + network `label`). The panel UI replaces the interval dropdown with the builder and adds a name field. Returned reports derive a clear display name at runtime from the saved job name + start date.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, better-sqlite3 (tenant DB), Zod v4, `node --import tsx --test`.

## Global Constraints

- Develop on `dev`, never push `main` directly. End with `npm run version:release`.
- Tenant DB access only inside `withTenant`/`withTenantFromSession`.
- Scope values are UNCHANGED enum (`full_subnet`|`found_ips`|`populated_24`); only labels/descriptions change.
- Names have NO spaces: tokens joined by `_`, inner words by `-`, CIDR `/`→`-`, strip to `[A-Za-z0-9._-]`.
- Cron is 5-field (min hour dom month dow), evaluated in the edge appliance local timezone.
- Edge cron support depends on sub-project A. If the edge rejects `cron_expr` (HTTP 400), DA-IPAM degrades to the nearest interval preset and surfaces a warning (never silent).
- `req.json()` in try/catch → 400; Zod `.issues`.
- Test command: `node --import tsx --test <file>`.

---

## File Structure

- Create `src/lib/vuln/cron-builder.ts` — `buildCron`, `describeCron`, `slugifyJobName`, `nearestIntervalForFrequency` (pure).
- Modify `src/lib/db-tenant-schema.ts` — add `edge_scan_schedules` table.
- Create `src/lib/vuln/edge-schedule-store.ts` — tenant DB get/save helpers for the builder config.
- Modify `src/lib/vuln/edge-subnet-bridge.ts` — `saveEdgeSubnetSchedule` accepts cron/jobName/label, sends to edge, persists, falls back.
- Modify `src/app/api/networks/[id]/edge-scan/route.ts` — PUT schema (builder fields) + GET returns saved config.
- Create `src/components/networks/schedule-builder.tsx` — frequency builder UI.
- Modify `src/components/networks/subnet-edge-scan-panel.tsx` — scope descriptions, mount builder, name field.
- Modify report listing (display name) — `src/lib/vuln/sync-job.ts` or the runs query helper.
- Tests under `src/lib/vuln/__tests__/`.

---

### Task 1: cron-builder (pure module)

**Files:**
- Create: `src/lib/vuln/cron-builder.ts`
- Test: `src/lib/vuln/__tests__/cron-builder.test.ts`

**Interfaces:**
- Produces:
  - `type Frequency = "daily" | "weekly" | "monthly"`
  - `interface ScheduleInput { frequency: Frequency; at: string; daysOfWeek?: number[]; dayOfMonth?: number }` (`at`="HH:MM", dow 0–6 Sun–Sat, dom 1–28)
  - `buildCron(s: ScheduleInput): string`
  - `describeCron(s: ScheduleInput): string` (Italian preview)
  - `slugifyJobName(parts: string[]): string`
  - `nearestIntervalForFrequency(f: Frequency): number` (daily→1440, weekly→10080, monthly→10080)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/vuln/__tests__/cron-builder.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCron, describeCron, slugifyJobName, nearestIntervalForFrequency } from "@/lib/vuln/cron-builder";

test("buildCron daily/weekly/monthly", () => {
  assert.equal(buildCron({ frequency: "daily", at: "10:00" }), "0 10 * * *");
  assert.equal(buildCron({ frequency: "weekly", at: "09:30", daysOfWeek: [1, 3, 5] }), "30 9 * * 1,3,5");
  assert.equal(buildCron({ frequency: "monthly", at: "10:00", dayOfMonth: 15 }), "0 10 15 * *");
});

test("describeCron Italian preview", () => {
  assert.match(describeCron({ frequency: "monthly", at: "10:00", dayOfMonth: 15 }), /15 del mese.*10:00/);
  assert.match(describeCron({ frequency: "daily", at: "02:00" }), /ogni giorno.*02:00/i);
});

test("slugifyJobName: no spaces, safe chars, slash->dash, non-empty", () => {
  assert.equal(slugifyJobName(["ACME", "Sede MI", "10.0.0.0/24", "IP attivi", "mensile"]),
    "ACME_Sede-MI_10.0.0.0-24_IP-attivi_mensile");
  assert.equal(slugifyJobName(["Caffè", "réte!"]), "Caffe_rete");
  assert.equal(slugifyJobName(["", "  "]).length > 0, true); // fallback non-empty
});

test("nearestIntervalForFrequency", () => {
  assert.equal(nearestIntervalForFrequency("daily"), 1440);
  assert.equal(nearestIntervalForFrequency("weekly"), 10080);
  assert.equal(nearestIntervalForFrequency("monthly"), 10080);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/vuln/__tests__/cron-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/vuln/cron-builder.ts
export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduleInput {
  frequency: Frequency;
  at: string; // "HH:MM"
  daysOfWeek?: number[]; // 0=Sun..6=Sat
  dayOfMonth?: number; // 1..28
}

function hhmm(at: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!match) throw new Error(`orario non valido: ${at}`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error(`orario fuori range: ${at}`);
  return { h, m };
}

export function buildCron(s: ScheduleInput): string {
  const { h, m } = hhmm(s.at);
  if (s.frequency === "daily") return `${m} ${h} * * *`;
  if (s.frequency === "weekly") {
    const dows = (s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [1]).slice().sort((a, b) => a - b);
    return `${m} ${h} * * ${dows.join(",")}`;
  }
  const dom = s.dayOfMonth && s.dayOfMonth >= 1 && s.dayOfMonth <= 28 ? s.dayOfMonth : 1;
  return `${m} ${h} ${dom} * *`;
}

const DOW_IT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

export function describeCron(s: ScheduleInput): string {
  const at = s.at.trim();
  if (s.frequency === "daily") return `Ogni giorno alle ${at}`;
  if (s.frequency === "weekly") {
    const days = (s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [1]).map((d) => DOW_IT[d]).join("/");
    return `Ogni ${days} alle ${at}`;
  }
  return `Ogni ${s.dayOfMonth ?? 1} del mese alle ${at}`;
}

export function slugifyJobName(parts: string[]): string {
  const slug = parts
    .map((p) =>
      (p ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "") // strip accents
        .trim()
        .replace(/\//g, "-")
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._-]/g, ""),
    )
    .filter((p) => p.length > 0)
    .join("_");
  return slug.length > 0 ? slug : "scan";
}

export function nearestIntervalForFrequency(f: Frequency): number {
  if (f === "daily") return 1440;
  return 10080; // weekly + monthly fallback to weekly preset when edge has no cron support
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/vuln/__tests__/cron-builder.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vuln/cron-builder.ts src/lib/vuln/__tests__/cron-builder.test.ts
git commit -m "feat(edge-ux): pure cron-builder (buildCron/describeCron/slugifyJobName)"
```

---

### Task 2: edge_scan_schedules tenant table + store

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (`TENANT_SCHEMA_SQL`)
- Create: `src/lib/vuln/edge-schedule-store.ts`
- Test: `src/lib/vuln/__tests__/edge-schedule-store.test.ts`

**Interfaces:**
- Consumes: `getTenantDb`/`getCurrentTenantCode` from `@/lib/db-tenant`.
- Produces:
  - `interface EdgeScheduleConfig { network_id: number; job_name: string|null; frequency: string|null; at_time: string|null; days_of_week: string|null; day_of_month: number|null; cron_expr: string|null; profile: string|null; targeting_mode: string|null; enabled: boolean }`
  - `getEdgeSchedule(networkId: number): EdgeScheduleConfig | null`
  - `saveEdgeSchedule(c: EdgeScheduleConfig): void`
  - `deleteEdgeSchedule(networkId: number): void`

- [ ] **Step 1: Add the table to `TENANT_SCHEMA_SQL`**

Append inside `TENANT_SCHEMA_SQL` (before its closing backtick):

```sql
CREATE TABLE IF NOT EXISTS edge_scan_schedules (
  network_id INTEGER PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  job_name TEXT,
  frequency TEXT,
  at_time TEXT,
  days_of_week TEXT,
  day_of_month INTEGER,
  cron_expr TEXT,
  profile TEXT,
  targeting_mode TEXT,
  enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/vuln/__tests__/edge-schedule-store.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { getEdgeSchedule, saveEdgeSchedule, deleteEdgeSchedule } from "@/lib/vuln/edge-schedule-store";

const T = "TESTEDGESCHED";
after(() => deleteTenantDatabase(T));

test("save/get/delete edge schedule", () => {
  withTenant(T, () => {
    getTenantDb(T).prepare("INSERT INTO networks(name,cidr) VALUES('n','10.0.0.0/24')").run();
    assert.equal(getEdgeSchedule(1), null);
    saveEdgeSchedule({ network_id: 1, job_name: "ACME_n_10.0.0.0-24_ip-attivi_mensile",
      frequency: "monthly", at_time: "10:00", days_of_week: null, day_of_month: 15,
      cron_expr: "0 10 15 * *", profile: "balanced", targeting_mode: "found_ips", enabled: true });
    const c = getEdgeSchedule(1)!;
    assert.equal(c.cron_expr, "0 10 15 * *");
    assert.equal(c.enabled, true);
    assert.equal(c.day_of_month, 15);
    deleteEdgeSchedule(1);
    assert.equal(getEdgeSchedule(1), null);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test src/lib/vuln/__tests__/edge-schedule-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/vuln/edge-schedule-store.ts
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";

export interface EdgeScheduleConfig {
  network_id: number;
  job_name: string | null;
  frequency: string | null;
  at_time: string | null;
  days_of_week: string | null;
  day_of_month: number | null;
  cron_expr: string | null;
  profile: string | null;
  targeting_mode: string | null;
  enabled: boolean;
}

function db() {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("edge-schedule-store: no tenant context");
  return getTenantDb(c);
}

export function getEdgeSchedule(networkId: number): EdgeScheduleConfig | null {
  const r = db().prepare(`SELECT * FROM edge_scan_schedules WHERE network_id=?`).get(networkId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    network_id: r.network_id as number,
    job_name: (r.job_name as string) ?? null,
    frequency: (r.frequency as string) ?? null,
    at_time: (r.at_time as string) ?? null,
    days_of_week: (r.days_of_week as string) ?? null,
    day_of_month: (r.day_of_month as number) ?? null,
    cron_expr: (r.cron_expr as string) ?? null,
    profile: (r.profile as string) ?? null,
    targeting_mode: (r.targeting_mode as string) ?? null,
    enabled: !!r.enabled,
  };
}

export function saveEdgeSchedule(c: EdgeScheduleConfig): void {
  db()
    .prepare(
      `INSERT INTO edge_scan_schedules
         (network_id, job_name, frequency, at_time, days_of_week, day_of_month, cron_expr, profile, targeting_mode, enabled, updated_at)
       VALUES (@network_id,@job_name,@frequency,@at_time,@days_of_week,@day_of_month,@cron_expr,@profile,@targeting_mode,@enabled, datetime('now'))
       ON CONFLICT(network_id) DO UPDATE SET job_name=@job_name, frequency=@frequency, at_time=@at_time,
         days_of_week=@days_of_week, day_of_month=@day_of_month, cron_expr=@cron_expr, profile=@profile,
         targeting_mode=@targeting_mode, enabled=@enabled, updated_at=datetime('now')`,
    )
    .run({ ...c, enabled: c.enabled ? 1 : 0 });
}

export function deleteEdgeSchedule(networkId: number): void {
  db().prepare(`DELETE FROM edge_scan_schedules WHERE network_id=?`).run(networkId);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test src/lib/vuln/__tests__/edge-schedule-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/vuln/edge-schedule-store.ts src/lib/vuln/__tests__/edge-schedule-store.test.ts
git commit -m "feat(edge-ux): edge_scan_schedules tenant table + store"
```

---

### Task 3: saveEdgeSubnetSchedule — cron + label + persist + fallback

**Files:**
- Modify: `src/lib/vuln/edge-subnet-bridge.ts` (`saveEdgeSubnetSchedule`, ~lines 299-345; `buildEdgeEnsureBody` label ~line 150)

**Interfaces:**
- Consumes: `saveEdgeSchedule`/`deleteEdgeSchedule` (Task 2), `nearestIntervalForFrequency` (Task 1).
- Produces: updated signature
  `saveEdgeSubnetSchedule(networkId, opts: { enabled; profile; targetingMode?; cronExpr: string; jobName: string; frequency: "daily"|"weekly"|"monthly"; atTime: string; daysOfWeek?: number[]; dayOfMonth?: number }): Promise<{ ok: boolean; error?: string; degraded?: boolean; warning?: string }>`

- [ ] **Step 1: Replace the function body**

Replace `saveEdgeSubnetSchedule` with (keeping imports; add `import { saveEdgeSchedule } from "./edge-schedule-store"` and `import { nearestIntervalForFrequency, type Frequency } from "./cron-builder"`):

```ts
export async function saveEdgeSubnetSchedule(
  networkId: number,
  opts: {
    enabled: boolean;
    profile: EdgeScanProfile;
    targetingMode?: EdgeTargetingMode;
    cronExpr: string;
    jobName: string;
    frequency: Frequency;
    atTime: string;
    daysOfWeek?: number[];
    dayOfMonth?: number;
  },
): Promise<{ ok: boolean; error?: string; degraded?: boolean; warning?: string }> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) {
    return { ok: false, error: "Scanner-Edge non configurato o disabilitato" };
  }
  const network = getNetworkById(networkId);
  if (!network) return { ok: false, error: "Rete non trovata" };

  try {
    const ensured = await edgeApiPost<{ ok: boolean; network_id: number }>(
      scanner,
      "/api/v1/networks/ensure",
      buildEdgeEnsureBody(networkId, {
        syncHosts: false,
        syncCredentials: true,
        targetingMode: opts.targetingMode,
        label: opts.jobName, // nome leggibile lato edge
      }),
      { timeoutMs: 120000 },
    );

    let degraded = false;
    let warning: string | undefined;
    try {
      await edgeApiPut(
        scanner,
        `/api/v1/networks/${ensured.network_id}/schedule`,
        {
          enabled: opts.enabled,
          cron_expr: opts.cronExpr,
          profile: opts.profile,
          ...(opts.targetingMode != null ? { targeting_mode: opts.targetingMode } : {}),
        },
        { timeoutMs: 30000 },
      );
    } catch (e) {
      // Edge senza supporto cron (sub-progetto A non ancora deployato): fallback a intervallo.
      if (e instanceof EdgeClientError && e.status === 400) {
        degraded = true;
        warning =
          "Edge non supporta ancora la pianificazione cron: applicato l'intervallo più vicino. Aggiorna l'edge per orari/giorni precisi.";
        await edgeApiPut(
          scanner,
          `/api/v1/networks/${ensured.network_id}/schedule`,
          {
            enabled: opts.enabled,
            interval_minutes: nearestIntervalForFrequency(opts.frequency),
            profile: opts.profile,
            ...(opts.targetingMode != null ? { targeting_mode: opts.targetingMode } : {}),
          },
          { timeoutMs: 30000 },
        );
      } else {
        throw e;
      }
    }

    if (opts.targetingMode != null) setNetworkTargetingMode(networkId, opts.targetingMode);

    saveEdgeSchedule({
      network_id: networkId,
      job_name: opts.jobName,
      frequency: opts.frequency,
      at_time: opts.atTime,
      days_of_week: opts.daysOfWeek?.length ? opts.daysOfWeek.join(",") : null,
      day_of_month: opts.dayOfMonth ?? null,
      cron_expr: opts.cronExpr,
      profile: opts.profile,
      targeting_mode: opts.targetingMode ?? null,
      enabled: opts.enabled,
    });

    return { ok: true, degraded, warning };
  } catch (e) {
    const msg = e instanceof EdgeClientError ? e.message : e instanceof Error ? e.message : "Errore salvataggio schedule";
    return { ok: false, error: msg };
  }
}
```

- [ ] **Step 2: Extend `buildEdgeEnsureBody` to accept a label override**

At `buildEdgeEnsureBody` (~line 150), add `label` to its options and prefer it:

```ts
// options param: { syncHosts; syncCredentials; targetingMode?; label?: string }
label: opts.label ?? network.name || network.description || `IPAM #${network.id}`,
```

(Find the existing `label:` line and replace it with the above; add `label?: string` to the options type.)

- [ ] **Step 3: Verify EdgeClientError exposes `.status`**

Read `EdgeClientError` in `src/lib/vuln/scanner-edge-client.ts`. If it has a numeric `status` property, the `e.status === 400` check works. If the property has another name (e.g. `httpStatus`), adjust the check in Step 1 to match. (Do not guess — read the class.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep edge-subnet-bridge`
Expected: no output (0 errors in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vuln/edge-subnet-bridge.ts
git commit -m "feat(edge-ux): send cron_expr + label, persist schedule, interval fallback"
```

---

### Task 4: API route PUT/GET

**Files:**
- Modify: `src/app/api/networks/[id]/edge-scan/route.ts` (`scheduleSchema`, PUT handler ~line 82-105; GET handler to also return saved config)

**Interfaces:**
- Consumes: `saveEdgeSubnetSchedule` (Task 3), `getEdgeSchedule` (Task 2), `buildCron` (Task 1).

- [ ] **Step 1: Replace `scheduleSchema`**

```ts
const scheduleSchema = z.object({
  enabled: z.boolean(),
  profile: z.enum(["fast", "balanced", "deep"]),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]).optional(),
  job_name: z.string().min(1).max(120),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  at_time: z.string().regex(/^\d{1,2}:\d{2}$/),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  day_of_month: z.number().int().min(1).max(28).optional(),
});
```

- [ ] **Step 2: Update the PUT handler body**

Replace the `saveEdgeSubnetSchedule` call block with cron building from the validated body:

```ts
import { buildCron } from "@/lib/vuln/cron-builder";
// ...
    const cronExpr = buildCron({
      frequency: body.frequency,
      at: body.at_time,
      daysOfWeek: body.days_of_week,
      dayOfMonth: body.day_of_month,
    });
    const result = await saveEdgeSubnetSchedule(networkId, {
      enabled: body.enabled,
      profile: body.profile,
      targetingMode: body.targeting_mode,
      cronExpr,
      jobName: body.job_name,
      frequency: body.frequency,
      atTime: body.at_time,
      daysOfWeek: body.days_of_week,
      dayOfMonth: body.day_of_month,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
    return Response.json({ ok: true, degraded: result.degraded ?? false, warning: result.warning });
```

- [ ] **Step 3: GET returns the saved builder config**

In the GET handler, add the saved schedule config to the response so the panel can rebuild the builder:

```ts
import { getEdgeSchedule } from "@/lib/vuln/edge-schedule-store";
// inside GET, after computing existing status, add to the returned JSON:
//   savedSchedule: getEdgeSchedule(networkId)
```
Add `savedSchedule: getEdgeSchedule(networkId)` to the GET response object.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "edge-scan/route"` (expect no output)
```bash
git add "src/app/api/networks/[id]/edge-scan/route.ts"
git commit -m "feat(edge-ux): PUT accepts builder fields → cron; GET returns saved schedule"
```

---

### Task 5: UI — scope descriptions, schedule builder, name field

**Files:**
- Create: `src/components/networks/schedule-builder.tsx`
- Modify: `src/components/networks/subnet-edge-scan-panel.tsx`

**Interfaces:**
- Consumes: `describeCron`, `slugifyJobName`, `Frequency` (cron-builder); PUT/GET `/api/networks/{id}/edge-scan`.

- [ ] **Step 1: ScheduleBuilder component**

Create `schedule-builder.tsx` (client) with props:
```ts
export interface ScheduleBuilderValue { frequency: Frequency; at: string; daysOfWeek: number[]; dayOfMonth: number }
export function ScheduleBuilder({ value, onChange }: { value: ScheduleBuilderValue; onChange: (v: ScheduleBuilderValue) => void }): JSX.Element
```
Render: a Frequency select (Giornaliera/Settimanale/Mensile); a time input (`type="time"`, bound to `at`); when weekly, 7 day toggles (Lun–Dom mapping to 1..6,0); when monthly, a day-of-month number input (1–28). Below, a read-only preview line using `describeCron(value)` plus the note "(ora locale dell'appliance edge)". Match the styling of the existing panel controls (look at the profile/targeting radios in `subnet-edge-scan-panel.tsx`).

- [ ] **Step 2: Enrich scope labels with descriptions**

In `subnet-edge-scan-panel.tsx`, replace `TARGETING_MODE_LABELS` with an object carrying label + description and render the description under each radio:

```ts
const TARGETING_MODE_LABELS: Record<EdgeTargetingMode, { label: string; desc: string }> = {
  full_subnet: { label: "Tutto il CIDR", desc: "Ogni indirizzo del range nominale della subnet." },
  populated_24: { label: "Solo /24 popolati", desc: "Solo i blocchi /24 con almeno un host noto." },
  found_ips: { label: "Solo IP che rispondono", desc: "Solo host online dalla discovery IPAM." },
};
```
Update the radio render (~line 338) to show `.label` and `.desc` (the existing live IP count stays).

- [ ] **Step 3: Replace interval dropdown with the builder + name field**

Remove `VA_INTERVAL_OPTIONS` usage in the schedule section (~lines 478-569). Add state: `frequency`, `atTime`, `daysOfWeek`, `dayOfMonth`, `jobName`. Mount `<ScheduleBuilder>`. Add a text input for `jobName`. Prefill `jobName` (when empty) from `slugifyJobName([tenantName, networkName, cidr, scopeSlug, freqLabel])` — derive `tenantName` from a prop or existing context (if not readily available, use networkName + cidr + scope + freq and note it). On save, PUT the new body `{ enabled, profile, targeting_mode, job_name, frequency, at_time, days_of_week, day_of_month }`; show `warning` from the response (degraded mode) as a non-blocking notice. On load, hydrate state from `savedSchedule` in the GET response.

- [ ] **Step 4: Verify in browser**

Run `npm run dev`, open a subnet, open the edge-scan dialog. Confirm: scope shows descriptions; builder lets you pick Mensile + day 15 + 10:00 with a correct preview; name auto-fills as a slug and is editable; saving succeeds (or shows the degraded warning if the edge lacks cron support).
Expected: builder works; PUT returns 200.

- [ ] **Step 5: Commit**

```bash
git add src/components/networks/schedule-builder.tsx src/components/networks/subnet-edge-scan-panel.tsx
git commit -m "feat(edge-ux): scope descriptions + schedule builder + slug name field"
```

---

### Task 6: Report display name (returned reports)

**Files:**
- Modify: the scan-runs listing used by the vuln/report UI (find via `grep -rn "vuln_scan_runs" src/lib src/app`), and/or `src/lib/vuln/sync-job.ts`.

**Interfaces:**
- Consumes: `getEdgeSchedule` (Task 2) for `job_name`.

- [ ] **Step 1: Derive a display name at runtime**

Where scan runs are listed for the UI, compute a `display_name` per run from the network's saved `job_name` + the run `started_at` date, falling back to the network name + CIDR when no job_name exists:

```ts
// pseudo, adapt to the real query/struct:
import { getEdgeSchedule } from "@/lib/vuln/edge-schedule-store";
function runDisplayName(run: { network_id: number | null; started_at: string | null }, networkLabel: string): string {
  const base = run.network_id != null ? (getEdgeSchedule(run.network_id)?.job_name ?? networkLabel) : networkLabel;
  const date = (run.started_at ?? "").slice(0, 10);
  return date ? `${base}_${date}` : base;
}
```
Expose `display_name` in the runs API/struct consumed by the report list UI. Do NOT add a DB column (derived at runtime keeps it consistent with the current job name).

- [ ] **Step 2: Show it in the report/runs UI**

In the component listing scan runs, render `display_name` as the primary label (keep the edge scan id as secondary/tooltip). Match existing list styling.

- [ ] **Step 3: Typecheck + manual check + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "sync-job|vuln"` (expect no new errors)
```bash
git add -A
git commit -m "feat(edge-ux): readable report display name from job_name + start date"
```

---

### Task 7: Full verification + release

- [ ] **Step 1: Unit tests**

Run: `node --import tsx --test src/lib/vuln/__tests__/cron-builder.test.ts src/lib/vuln/__tests__/edge-schedule-store.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint (new files) + typecheck + build**

Run: `npx eslint src/lib/vuln/cron-builder.ts src/lib/vuln/edge-schedule-store.ts src/components/networks/schedule-builder.tsx && npx tsc --noEmit && rm -rf .next && npm run build`
Expected: new files lint clean, 0 type errors, build OK.

- [ ] **Step 3: Release**

Run: `npm run version:release` (patch bump + `release: vX.Y.Z` on `dev`).

---

## Self-Review

**Spec coverage:**
- §4 scope relabel → Task 5 step 2.
- §5 frequency builder → cron → Tasks 1, 5; persistence `edge_scan_schedules` → Task 2; send to edge + fallback → Task 3; PUT/GET → Task 4.
- §6 naming auto+editable, no spaces → Task 1 (`slugifyJobName`), Task 5 step 3; report naming → Task 6.
- §8 error handling (Zod, fallback warning) → Tasks 3, 4.
- §9 testing → Tasks 1, 2.
- §10 edge dependency / degrade → Task 3 fallback.

**Open items flagged (not blockers):**
- `EdgeClientError.status` property name — Task 3 Step 3 says read the class and adjust.
- `tenantName` source for the slug default — Task 5 Step 3: use available context or fall back to network+cidr+scope+freq.
- Exact scan-runs listing location — Task 6 Step 1 says grep `vuln_scan_runs`.

**Placeholder scan:** code steps contain full code; UI Task 5 references existing panel styling (acceptable — sibling-context dependent).

**Type consistency:** `Frequency`/`ScheduleInput` consistent across Tasks 1/3/4/5; `saveEdgeSubnetSchedule` new signature consistent Tasks 3/4; `EdgeScheduleConfig` consistent Tasks 2/3/6.
