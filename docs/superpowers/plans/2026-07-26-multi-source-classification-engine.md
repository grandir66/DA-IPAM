# Multi-source classification engine (Fase B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre in DA-IPAM una facade di classificazione a evidence/scoring sopra la cascata esistente, con persistenza ibrida, policy di update, UI explain minima, e naabu come pre-pass TCP opzionale prima di Nmap.

**Architecture:** Dopo fingerprint/cascade, `src/lib/classification/*` normalizza i segnali in `evidence[]`, calcola score per slug IPAM, produce `classification_reason`, applica policy (manual lock / upgrade se score ≥ corrente / conflict window), scrive `classification_json` + riuso `inferred_confidence`, e history solo su cambio/conflitto. Naabu (fail-soft) alimenta `open_ports` prima dello scan Nmap mirato.

**Tech Stack:** TypeScript strict · Next.js 16 · better-sqlite3 (tenant DB) · Node 22 `node:test` + tsx · execFile per naabu/nmap · Zod dove già usato in settings.

**Spec:** [`docs/superpowers/specs/2026-07-26-multi-source-classification-engine-design.md`](../specs/2026-07-26-multi-source-classification-engine-design.md)

## Global Constraints

- **Node 22 LTS.** Branch lavoro: `dev` (mai push `main`; promote solo via UI).
- **Slug:** solo `DEVICE_CLASSIFICATIONS` / custom esistenti — nessuna nuova tassonomia.
- **Runtime:** solo appliance DA-IPAM; zero Scanner-Edge in questo piano.
- **Confidence overall:** riusare colonna `hosts.inferred_confidence` (0–100); non creare `classification_confidence`.
- **Naabu:** opzionale; assente/fail → fallback Nmap-only; default `port_discovery=nmap`.
- **Policy update:** se `classification_manual=1` non toccare `classification`; altrimenti upgrade solo se `score_new >= score_current`; conflict se Δ&lt;10 e slug diversi.
- **Test:** `node --import tsx --test <file>` (o `npm test` scoped). Path assoluti / `cd` esplicito su DA-IPAM.
- **ENGINE_VERSION:** costante stringa `"0.1.0"` in `types.ts`.
- **Fase A (unificazione regole) fuori da questo piano** — solo nota a fine documento.

---

## File Structure

```
DA-IPAM/
  src/lib/classification/
    types.ts                 # Evidence, Decision, Conflict, ENGINE_VERSION, pesi default
    normalize.ts             # raw signals + cascade → ClassificationEvidence[]
    engine.ts                # score, reason, policy, decideClassification()
    persist.ts               # write summary + conditional history
    weights.ts               # SOURCE_WEIGHTS + attribute overrides
    __tests__/
      normalize.test.ts
      engine.test.ts
      persist.test.ts
  src/lib/scanner/naabu.ts   # isNaabuAvailable, runNaabuTcpPorts
  src/lib/scanner/__tests__/naabu.test.ts
  src/lib/db-tenant-schema.ts          # hosts cols + host_classification_history
  src/lib/db-tenant.ts                 # ALTER runtime + helpers history
  src/types/index.ts                   # Host fields opzionali
  src/lib/scanner/discovery.ts         # wire post-fingerprint + naabu pre-pass
  src/lib/cron/jobs.ts                 # (se path nmap dedicato) pre-pass
  src/app/api/networks/[id]/apply-classifications/route.ts
  src/app/api/networks/[id]/refresh/route.ts
  src/app/(dashboard)/objects/[id]/page.tsx   # reason + evidence panel
  src/components/shared/classification-evidence-panel.tsx
  src/components/settings/scan-config-tab.tsx  # naabu toggle/path/status
  README.md                            # dipendenza opzionale naabu
```

---

### Task 1: Tipi e pesi fonte

**Files:**
- Create: `src/lib/classification/types.ts`
- Create: `src/lib/classification/weights.ts`
- Test: `src/lib/classification/__tests__/normalize.test.ts` (solo import tipi/pesi inizialmente; esteso in Task 2)

**Interfaces:**
- Produces:
  - `ENGINE_VERSION = "0.1.0"`
  - `EvidenceSource`, `ClassificationEvidence`, `ClassificationConflict`, `ClassificationDecision`, `ClassificationJson`
  - `SOURCE_WEIGHTS: Record<EvidenceSource, number>`
  - `CONFLICT_WINDOW = 10`, `MIN_APPLY_CONFIDENCE = 56`, `MAX_EVIDENCE_KEPT = 20`, `HISTORY_CONFIDENCE_DELTA = 5`

- [ ] **Step 1: Write types + weights**

```ts
// src/lib/classification/types.ts
export const ENGINE_VERSION = "0.1.0";
export const CONFLICT_WINDOW = 10;
export const MIN_APPLY_CONFIDENCE = 56;
export const MAX_EVIDENCE_KEPT = 20;
export const HISTORY_CONFIDENCE_DELTA = 5;

export type EvidenceSource =
  | "naabu" | "nmap" | "snmp" | "http" | "ssh" | "smb"
  | "mac_oui" | "dns" | "ttl" | "rule";

export interface ClassificationEvidence {
  source: EvidenceSource;
  attribute: string;
  value: string;
  weight: number;
  confidence: number;
  observed: boolean;
  timestamp: string;
  votes_for?: string;
}

export interface ClassificationConflict {
  a: string;
  b: string;
  score_a: number;
  score_b: number;
  delta: number;
}

export interface ClassificationDecision {
  classification: string; // slug or "unknown"
  confidence: number;     // 0-100
  reason: string;
  evidence: ClassificationEvidence[];
  conflicts: ClassificationConflict[];
  fingerprint_hash: string;
  engine_version: string;
  sources: EvidenceSource[];
}

export interface ClassificationJson {
  evidence: ClassificationEvidence[];
  conflicts?: ClassificationConflict[];
  fingerprint_hash: string;
  engine_version: string;
  sources: EvidenceSource[];
}
```

```ts
// src/lib/classification/weights.ts
import type { EvidenceSource } from "./types";

/** Pesi default 0–1 (spec §6.2). */
export const SOURCE_WEIGHTS: Record<EvidenceSource, number> = {
  snmp: 0.95,
  http: 0.9,
  smb: 0.75,
  ssh: 0.55,
  mac_oui: 0.4,
  nmap: 0.45,
  dns: 0.35,
  ttl: 0.25,
  naabu: 0.2,
  rule: 0.7,
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
git add src/lib/classification/types.ts src/lib/classification/weights.ts
git commit -m "$(cat <<'EOF'
feat(classification): add engine types and default source weights

EOF
)"
```

---

### Task 2: `normalize` — segnali → evidence

**Files:**
- Create: `src/lib/classification/normalize.ts`
- Test: `src/lib/classification/__tests__/normalize.test.ts`

**Interfaces:**
- Consumes: `ClassificationEvidence`, `SOURCE_WEIGHTS`, `DeviceFingerprintSnapshot` from `@/types`
- Produces:
  - `NormalizeInput` (ip, hostname, vendor, os_info, open_ports, detection snap, snmp fields, naabu_ports?, cascade_slug?, cascade_method?)
  - `normalizeToEvidence(input: NormalizeInput, nowIso?: string): ClassificationEvidence[]`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/classification/__tests__/normalize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToEvidence } from "../normalize";

test("SNMP sysObjectID produces high-weight snmp evidence voting cascade slug", () => {
  const ev = normalizeToEvidence({
    ip: "192.0.2.1",
    hostname: null,
    vendor: null,
    os_info: null,
    open_ports: [],
    snmp_sysdescr: "Cisco IOS",
    snmp_sysobjectid: "1.3.6.1.4.1.9.1.1234",
    detection: null,
    naabu_ports: null,
    cascade_slug: "switch",
    cascade_method: "oid",
  }, "2026-07-26T00:00:00Z");
  const oid = ev.find((e) => e.attribute === "sysObjectID");
  assert.ok(oid);
  assert.equal(oid!.source, "snmp");
  assert.equal(oid!.votes_for, "switch");
  assert.ok(oid!.weight >= 0.9);
  assert.equal(oid!.observed, true);
});

test("HTTP banner ESXi votes hypervisor; nmap linux votes server_linux", () => {
  const ev = normalizeToEvidence({
    ip: "192.0.2.10",
    hostname: "esx01",
    vendor: null,
    os_info: null,
    open_ports: [22, 443, 902],
    snmp_sysdescr: null,
    snmp_sysobjectid: null,
    detection: {
      ip: "192.0.2.10",
      open_ports: [22, 443, 902],
      matches: [],
      banner_http: "VMware ESXi",
      nmap_os: "Linux 5.x",
      detection_sources: ["banner_http", "nmap_os"],
      generated_at: "2026-07-26T00:00:00Z",
      final_device: "VMware ESXi",
      final_confidence: 0.9,
    },
    naabu_ports: [22, 443, 902],
    cascade_slug: "hypervisor",
    cascade_method: "text",
  }, "2026-07-26T00:00:00Z");
  assert.ok(ev.some((e) => e.source === "http" && e.votes_for === "hypervisor"));
  assert.ok(ev.some((e) => e.source === "nmap" && e.attribute === "os_guess"));
  assert.ok(ev.some((e) => e.source === "naabu" && e.attribute === "tcp_ports"));
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
node --import tsx --test src/lib/classification/__tests__/normalize.test.ts
```

Expected: FAIL (module not found / export missing)

- [ ] **Step 3: Implement `normalize.ts`**

Mappare almeno:
- `snmp_sysobjectid` / `snmp_sysdescr` → `source=snmp`, `votes_for=cascade_slug` se method oid/text
- `detection.banner_http` → `http` (se match /esxi|idrac|ilo|proxmox|synology|qnap/i alza votes_for dedicato)
- `detection.banner_ssh` → `ssh`
- `detection.nmap_os` → `nmap` / `os_guess` (votes_for euristica: linux→`server_linux`, windows→`server_windows`, altrimenti cascade o undefined)
- `detection.ttl` / `os_hint` → `ttl`
- `vendor` → `mac_oui`
- `hostname` → `dns`
- `naabu_ports` → `naabu`/`tcp_ports` (niente `votes_for` se solo porte)
- `detection.final_device` + `final_confidence` → `rule` con `votes_for=cascade_slug` se presente

Usare `SOURCE_WEIGHTS[source]` come `weight`; `confidence` da signal strength (snmp oid 0.95, banner management 0.95, nmap_os clamp `final_confidence` o 0.5).

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --import tsx --test src/lib/classification/__tests__/normalize.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/classification/normalize.ts src/lib/classification/__tests__/normalize.test.ts
git commit -m "$(cat <<'EOF'
feat(classification): normalize multi-source signals into evidence

EOF
)"
```

---

### Task 3: `engine` — score, reason, policy

**Files:**
- Create: `src/lib/classification/engine.ts`
- Test: `src/lib/classification/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: evidence[], constants from types
- Produces:
  - `scoreByClassification(evidence): Map<string, number>` (raw sum weight×confidence)
  - `normalizeOverall(rawMax: number): number` → 0–100
  - `detectConflicts(scores: Map<string,number>): ClassificationConflict[]`
  - `buildReason(best, evidence, conflicts): string`
  - `decideClassification(evidence, opts): ClassificationDecision`
  - `shouldTouchClassification(prev, decision, manual): { apply: boolean; reason: string }`
  - `createFingerprintHash(evidence): string` (sha256 of stable JSON of source|attribute|value)

```ts
interface DecideOpts {
  cascade_slug?: string | null;
  previous_classification?: string | null;
  previous_confidence?: number | null; // inferred_confidence
  classification_manual?: boolean;
}
```

- [ ] **Step 1: Write failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideClassification, shouldTouchClassification } from "../engine";
import type { ClassificationEvidence } from "../types";

function ev(partial: Partial<ClassificationEvidence> & Pick<ClassificationEvidence, "source" | "attribute" | "value">): ClassificationEvidence {
  return {
    weight: 0.9,
    confidence: 0.95,
    observed: true,
    timestamp: "2026-07-26T00:00:00Z",
    ...partial,
  };
}

test("ESXi http evidence beats nmap linux for best slug", () => {
  const decision = decideClassification([
    ev({ source: "http", attribute: "title", value: "VMware ESXi", votes_for: "hypervisor", weight: 0.9, confidence: 0.95 }),
    ev({ source: "nmap", attribute: "os_guess", value: "Linux 5.x", votes_for: "server_linux", weight: 0.45, confidence: 0.62 }),
  ], { cascade_slug: "hypervisor" });
  assert.equal(decision.classification, "hypervisor");
  assert.ok(decision.confidence >= 56);
  assert.match(decision.reason, /ESXi|hypervisor|overrides/i);
});

test("manual lock: shouldTouchClassification.apply = false", () => {
  const decision = decideClassification([
    ev({ source: "snmp", attribute: "sysObjectID", value: "1.2.3", votes_for: "switch" }),
  ], { cascade_slug: "switch" });
  const r = shouldTouchClassification(
    { classification: "workstation", confidence: 40 },
    decision,
    true,
  );
  assert.equal(r.apply, false);
});

test("upgrade only when new confidence >= previous", () => {
  const decision = decideClassification([
    ev({ source: "snmp", attribute: "sysObjectID", value: "1.2.3", votes_for: "switch", weight: 0.95, confidence: 0.9 }),
  ], { cascade_slug: "switch" });
  assert.equal(
    shouldTouchClassification({ classification: "unknown", confidence: 10 }, decision, false).apply,
    true,
  );
  assert.equal(
    shouldTouchClassification({ classification: "switch", confidence: 99 }, decision, false).apply,
    decision.confidence >= 99,
  );
});

test("near scores different slugs produce conflict", () => {
  const decision = decideClassification([
    ev({ source: "http", attribute: "title", value: "a", votes_for: "storage", weight: 0.8, confidence: 0.8 }),
    ev({ source: "smb", attribute: "os", value: "Windows", votes_for: "server_windows", weight: 0.75, confidence: 0.85 }),
  ], {});
  assert.ok(decision.conflicts.length >= 1 || decision.classification !== "unknown");
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --import tsx --test src/lib/classification/__tests__/engine.test.ts
```

- [ ] **Step 3: Implement `engine.ts`**

Logica:
1. Sommare `weight*confidence` per `votes_for`.
2. Se nessun voto ma `cascade_slug`, usare cascade come best con confidence da evidence `rule` o floor basso.
3. `normalizeOverall`: `Math.min(100, Math.round(raw * 100))` (raw già ~0–1 tipicamente; se somma &gt;1 clamp).
4. Se overall &lt; `MIN_APPLY_CONFIDENCE` → `classification = "unknown"` (o slug generico solo se cascade era già generico — preferire `unknown`).
5. Conflicts: top2 slug con Δ overall &lt; `CONFLICT_WINDOW`.
6. Reason: menzionare top evidence observed + se override nmap generico.
7. `shouldTouchClassification`: manual → false; else `decision.confidence >= (previous.confidence ?? 0)` e decision.classification !== unknown (oppure unknown solo se previous era unknown); se conflict e previous confidence ≥ decision → false ma caller persiste conflicts.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/classification/engine.ts src/lib/classification/__tests__/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(classification): scoring engine with update policy and conflicts

EOF
)"
```

---

### Task 4: Schema tenant — colonne + history

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (CREATE hosts + nuova tabella)
- Modify: `src/lib/db-tenant.ts` (ALTER idempotenti su init tenant, come altre colonne)
- Modify: `src/types/index.ts` (`Host` opzionale `classification_reason`, `classification_json`)

**Interfaces:**
- Produces table `host_classification_history` e colonne `hosts.classification_reason`, `hosts.classification_json`

- [ ] **Step 1: Add to `TENANT_SCHEMA_SQL` / hosts CREATE**

Su `hosts` (dopo `classification_manual` o in coda colonne non-generated):

```sql
classification_reason TEXT,
classification_json TEXT,
```

Nuova tabella:

```sql
CREATE TABLE IF NOT EXISTS host_classification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  classification TEXT,
  confidence INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  evidence_json TEXT,
  conflicts_json TEXT,
  trigger TEXT NOT NULL CHECK(trigger IN ('scan','apply','manual','backfill'))
);
CREATE INDEX IF NOT EXISTS idx_host_class_hist_host ON host_classification_history(host_id, at DESC);
```

- [ ] **Step 2: Runtime ALTER in `initializeTenantDb` (o punto migrazioni esistente)**

Pattern già usato (~riga 815 `inferred_confidence`):

```ts
{ name: "classification_reason", sql: "ALTER TABLE hosts ADD COLUMN classification_reason TEXT" },
{ name: "classification_json", sql: "ALTER TABLE hosts ADD COLUMN classification_json TEXT" },
```

+ `exec` CREATE TABLE history IF NOT EXISTS.

- [ ] **Step 3: Extend `Host` in `src/types/index.ts`**

```ts
classification_reason?: string | null;
classification_json?: string | null;
```

- [ ] **Step 4: Smoke — typecheck**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
npx tsc --noEmit 2>&1 | head -40
```

Expected: nessun errore nuovo su questi file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(db): classification_reason/json and host_classification_history

EOF
)"
```

---

### Task 5: `persist` — summary + history condizionale

**Files:**
- Create: `src/lib/classification/persist.ts`
- Test: `src/lib/classification/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: `ClassificationDecision`, `shouldTouchClassification`, sqlite db-like
- Produces:
  - `applyClassificationDecision(db, hostId, decision, ctx): { touchedClassification: boolean; historyAppended: boolean }`
  - `ctx: { classification_manual: boolean; previous_classification: string | null; previous_confidence: number | null; trigger: "scan"|"apply"|"manual"|"backfill"; force?: boolean }`

Comportamento:
1. Trim evidence a `MAX_EVIDENCE_KEPT` (per score desc / timestamp).
2. Sempre UPDATE: `classification_json`, `classification_reason`, `inferred_confidence = decision.confidence` (e opz. merge `inferred_reasons` con reason).
3. Se `force` o `shouldTouchClassification.apply` → UPDATE `classification`; se `force` e manual → `classification_manual=0`.
4. History se: touched classification OR `|Δconf| >= HISTORY_CONFIDENCE_DELTA` OR `decision.conflicts.length > 0`.

- [ ] **Step 1: Write failing test with in-memory sqlite**

Usare `better-sqlite3` Database `:memory:` con schema minimo hosts + history (come altri test tenant nel repo). Se pattern locale manca, creare tabella minima nel test.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyClassificationDecision } from "../persist";
import type { ClassificationDecision } from "../types";
import { ENGINE_VERSION } from "../types";

function memDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE hosts (
      id INTEGER PRIMARY KEY,
      classification TEXT,
      classification_manual INTEGER DEFAULT 0,
      inferred_confidence INTEGER DEFAULT 0,
      classification_reason TEXT,
      classification_json TEXT
    );
    CREATE TABLE host_classification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      classification TEXT,
      confidence INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      evidence_json TEXT,
      conflicts_json TEXT,
      trigger TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO hosts (id, classification, inferred_confidence) VALUES (1, 'unknown', 0)").run();
  return db;
}

test("persist upgrades classification and writes history", () => {
  const db = memDb();
  const decision: ClassificationDecision = {
    classification: "hypervisor",
    confidence: 93,
    reason: "ESXi UI",
    evidence: [],
    conflicts: [],
    fingerprint_hash: "abc",
    engine_version: ENGINE_VERSION,
    sources: ["http"],
  };
  const r = applyClassificationDecision(db, 1, decision, {
    classification_manual: false,
    previous_classification: "unknown",
    previous_confidence: 0,
    trigger: "scan",
  });
  assert.equal(r.touchedClassification, true);
  assert.equal(r.historyAppended, true);
  const row = db.prepare("SELECT classification, inferred_confidence, classification_reason FROM hosts WHERE id=1").get() as {
    classification: string; inferred_confidence: number; classification_reason: string;
  };
  assert.equal(row.classification, "hypervisor");
  assert.equal(row.inferred_confidence, 93);
  assert.equal(row.classification_reason, "ESXi UI");
});

test("manual lock updates reason/json but not classification", () => {
  const db = memDb();
  db.prepare("UPDATE hosts SET classification='workstation', classification_manual=1, inferred_confidence=80 WHERE id=1").run();
  const decision: ClassificationDecision = {
    classification: "switch",
    confidence: 95,
    reason: "SNMP",
    evidence: [],
    conflicts: [],
    fingerprint_hash: "x",
    engine_version: ENGINE_VERSION,
    sources: ["snmp"],
  };
  const r = applyClassificationDecision(db, 1, decision, {
    classification_manual: true,
    previous_classification: "workstation",
    previous_confidence: 80,
    trigger: "scan",
  });
  assert.equal(r.touchedClassification, false);
  const row = db.prepare("SELECT classification FROM hosts WHERE id=1").get() as { classification: string };
  assert.equal(row.classification, "workstation");
});
```

- [ ] **Step 2: Run — FAIL then implement `persist.ts` — PASS**

- [ ] **Step 3: Commit**

```bash
git add src/lib/classification/persist.ts src/lib/classification/__tests__/persist.test.ts
git commit -m "$(cat <<'EOF'
feat(classification): persist decision summary and conditional history

EOF
)"
```

---

### Task 6: Wire post-cascade (discovery + apply/refresh)

**Files:**
- Create: `src/lib/classification/run.ts` — orchestrator `runClassificationEngineForHost(...)`
- Modify: `src/lib/scanner/discovery.ts` (dopo `buildDeviceFingerprint` / prima o dopo upsert detection_json)
- Modify: `src/app/api/networks/[id]/apply-classifications/route.ts`
- Modify: `src/app/api/networks/[id]/refresh/route.ts`

**Interfaces:**
- Produces:
```ts
export async function runClassificationEngineForHost(args: {
  db: SqliteDbLike;
  hostId: number;
  ip: string;
  hostname?: string | null;
  vendor?: string | null;
  os_info?: string | null;
  open_ports?: Array<{ port: number }> | number[] | null;
  detection: DeviceFingerprintSnapshot | null;
  snmp_sysdescr?: string | null;
  snmp_sysobjectid?: string | null;
  naabu_ports?: number[] | null;
  cascade_slug?: string | null;
  cascade_method?: string | null;
  classification_manual: boolean;
  previous_classification: string | null;
  previous_confidence: number | null;
  trigger: "scan" | "apply" | "manual" | "backfill";
  force?: boolean;
}): Promise<ClassificationDecision>
```

Implementazione: `normalize` → `decideClassification` → `applyClassificationDecision`.

- [ ] **Step 1: Add `run.ts` e chiamarlo da apply-classifications**

Dopo aver calcolato `newClassification = fromFingerprint ?? fromRules`, invece del solo UPDATE classification:

```ts
import { runClassificationEngineForHost } from "@/lib/classification/run";

// ...
await runClassificationEngineForHost({
  db,
  hostId: host.id,
  ip: host.ip,
  hostname: host.hostname,
  vendor: host.vendor,
  os_info: host.os_info,
  open_ports: openPorts,
  detection: fpSnap,
  snmp_sysdescr: fpSnap?.snmp_sysdescr ?? null,
  snmp_sysobjectid: fpSnap?.snmp_vendor_oid ?? null,
  cascade_slug: newClassification ?? null,
  cascade_method: fromFingerprint ? "fingerprint" : "rules",
  classification_manual: classificationManual && !force,
  previous_classification: host.classification,
  previous_confidence: (host as { inferred_confidence?: number | null }).inferred_confidence ?? 0,
  trigger: "apply",
  force,
});
```

Mantenere skip custom-child (A3): se `currentIsCustomChildOfNew`, non chiamare engine con apply classification (o passare manual-equivalent skip).

- [ ] **Step 2: Stesso orchestrator in `refresh/route.ts`** (dryRun continua a proporre; persist solo dove già scriveva)

- [ ] **Step 3: In `discovery.ts`**, dopo aver costruito `fpSnap` e determinato classification candidata, chiamare `runClassificationEngineForHost` con `trigger: "scan"` sul `hostId` upsertato.

- [ ] **Step 4: Manual smoke**

```bash
node --import tsx --test src/lib/classification/__tests__/*.test.ts
npx tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/classification/run.ts src/lib/scanner/discovery.ts \
  src/app/api/networks/\[id\]/apply-classifications/route.ts \
  src/app/api/networks/\[id\]/refresh/route.ts
git commit -m "$(cat <<'EOF'
feat(classification): wire evidence engine after discovery and apply

EOF
)"
```

---

### Task 7: UI — reason, evidence, conflicts

**Files:**
- Create: `src/components/shared/classification-evidence-panel.tsx`
- Modify: `src/app/(dashboard)/objects/[id]/page.tsx` (zona confidence / fingerprint già presente ~riga 1249)

**Interfaces:**
- Panel props: `{ reason: string | null; confidence: number | null; classificationJson: string | null }`
- Parse `classification_json` → lista evidence + conflicts
- Mostrare reason come testo primario; evidence collassabile (pattern simile a `fingerprint-explanation-panel.tsx`)

- [ ] **Step 1: Implement panel client component** (no nuove dipendenze UI)

- [ ] **Step 2: Montare in object detail** sotto le info inferred/fingerprint esistenti

- [ ] **Step 3: Verifica visiva locale** (dev server se già su) — reason + lista fonti

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/classification-evidence-panel.tsx \
  src/app/\(dashboard\)/objects/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(ui): show classification reason and evidence on host detail

EOF
)"
```

---

### Task 8: Naabu wrapper (fail-soft)

**Files:**
- Create: `src/lib/scanner/naabu.ts`
- Test: `src/lib/scanner/__tests__/naabu.test.ts`

**Interfaces:**
- Produces:
  - `isNaabuAvailable(binPath?: string): Promise<boolean>`
  - `runNaabuTcpPorts(targets: string[], opts?: { binPath?: string; ports?: string; rate?: number; timeoutMs?: number }): Promise<Map<string, number[]>>`
  - Parse output JSONL/JSON di naabu (`-json`); se spawn fail → Map vuota (non throw)

- [ ] **Step 1: Failing test con mock** — estrarre parser puro:

```ts
// esporta parseNaabuJsonLine(line: string): { ip: string; port: number } | null
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNaabuJsonLine, mergeNaabuPortMap } from "../naabu";

test("parseNaabuJsonLine reads ip and port", () => {
  const r = parseNaabuJsonLine('{"ip":"192.0.2.1","port":443}');
  assert.deepEqual(r, { ip: "192.0.2.1", port: 443 });
});

test("mergeNaabuPortMap aggregates ports per ip", () => {
  const m = mergeNaabuPortMap([
    { ip: "192.0.2.1", port: 80 },
    { ip: "192.0.2.1", port: 443 },
  ]);
  assert.deepEqual(m.get("192.0.2.1"), [80, 443]);
});
```

- [ ] **Step 2: Implement `naabu.ts`** con `execFile(bin, ["-host", ..., "-p", ports, "-json", "-silent"], ...)`  
  Default ports string allineata spec livello 1: `22,80,443,445,3389,161,554,623,9100` (161 TCP rare — ok come hint; UDP resta nmap).

- [ ] **Step 3: Tests PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(scanner): add optional naabu TCP pre-pass wrapper

EOF
)"
```

---

### Task 9: Settings + wire naabu nel path scan

**Files:**
- Modify: hub settings keys (pattern esistente in `scan-config-tab.tsx` / API settings)
- Modify: `src/components/settings/scan-config-tab.tsx`
- Modify: `src/lib/scanner/discovery.ts` (o punto unico che lancia port scan rete)

**Settings keys (hub.settings):**
- `port_discovery` = `"nmap"` | `"naabu+nmap"` (default `nmap`)
- `naabu_bin_path` = stringa opzionale (default vuoto → `naabu` in PATH)

- [ ] **Step 1: UI** — toggle + path + badge “naabu: disponibile / non trovato” (chiamata API test o check server-side in GET settings)

- [ ] **Step 2: Prima del port scan Nmap su host up**, se `port_discovery===naabu+nmap` e `isNaabuAvailable`:
  1. `runNaabuTcpPorts(hosts)`
  2. merge porte in struttura usata da nmap mirato / `open_ports`
  3. passare `naabu_ports` a `runClassificationEngineForHost`
  4. Nmap `-sV` sulle union(naabu ports, always-useful ports)

Se naabu non disponibile: log `[naabu] unavailable, fallback nmap` e continua.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(scan): optional naabu+nmap port discovery setting

EOF
)"
```

---

### Task 10: Docs README + checklist B4

**Files:**
- Modify: `README.md` (sezione scansioni / dipendenze)
- Optional short note in spec “Implementazione” pointing to this plan

- [x] **Step 1: Documentare** install opzionale naabu (binary ProjectDiscovery), setting UI, fallback.

- [x] **Step 2: Aggiungere in fondo al plan checklist B4 validazione lab** (vedi [B4 Lab validation checklist](#b4-lab-validation-checklist)).

- [x] **Step 3: Commit docs**

```bash
git commit -m "$(cat <<'EOF'
docs: optional naabu and classification engine ops notes

EOF
)"
```

---

## Spec coverage (self-review)

| Spec § | Task |
|---|---|
| 3 Fase B facade | 1–6 |
| 5 modello dati / history | 4–5 |
| 6 scoring + policy A | 3, 5 |
| 7 naabu + probing L2 | 8–9 |
| 8 UI minima | 7 |
| 9 error handling fail-soft | 5, 8–9 |
| 10 test unit/fixture | 2, 3, 5, 8 |
| 11 B1–B3 | Tasks 1–9; B4 = Task 10 checklist |
| Fase A | **Non in questo piano** |

## Fuori scope (non implementare qui)

- Migrazione completa regole in un solo motore (Fase A)
- ML, passive/LLDP/mDNS, JA3 obbligatorio
- Nuovi slug BMC/camera dedicati
- Push `main` / release appliance senza promote UI

---

## Nota Fase A (piano futuro separato)

Dopo B4 su dataset reale: unificare `device-classifier` + fingerprint rules dentro `classification/engine`, pesi editabili in hub, thinning cascade. Aprire nuova spec/plan solo allora.

---

## B4 Lab validation checklist

Validazione su dataset reale etichettato (lab). Eseguire dopo B1–B3 deployati sull’appliance di test; ops notes Naabu in [README § Naabu (opzionale)](../../../README.md#naabu-opzionale).

- [ ] ESXi classificato `hypervisor` con reason che cita HTTP
- [ ] Synology non vira `server_windows` solo per 445
- [ ] Host senza segnali → `unknown` / bassa confidence
- [ ] Manual lock rispettato
- [ ] Naabu assente non rompe job
- [ ] Naabu presente riduce scope porte Nmap (log/timing)
