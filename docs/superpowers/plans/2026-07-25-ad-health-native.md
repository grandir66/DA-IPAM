# AD Health nativo (PingCastle-like) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Da UI Active Directory di DA-IPAM, lanciare un healthcheck LDAP Domarc (14 rule + score 4 assi), persistire i findings e esportare JSON ingestibile da DA-Vul-can come `domarc-ad-health`, senza PingCastle e senza dipendere da Scanner-Edge.

**Architecture:** Motore TypeScript puro in `src/lib/ad/health/` che (1) opzionalmente refresh `ad_sync`, (2) carica cache SQLite + query LDAP extra, (3) esegue rule pure → findings aggregati, (4) calcola score, (5) persiste run/findings. API + UI su DA-IPAM; ingest hub in DA-Vul-can (Task 10, repo separato).

**Tech Stack:** TypeScript · Next.js App Router · better-sqlite3 · ldapts (già in IPAM) · Node 22 `node:test` · Zod · nessun nuovo binary.

**Spec:** [`DA-Vul-can/docs/superpowers/specs/2026-07-25-ad-health-edge-design.md`](../../../DA-Vul-can/docs/superpowers/specs/2026-07-25-ad-health-edge-design.md) (v3 approvata, home = DA-IPAM).

## Global Constraints

- **Node 22 LTS.** Branch lavoro DA-IPAM: `dev` (mai push `main`).
- **Rule ID** solo `DA-{S|P|T|A}-*`. Mai RiskId/testi PingCastle.
- **Edge non obbligatorio** in MVP.
- **1 finding aggregato per rule** (count + sample max 50 DN/sAMAccountName).
- **Auth API:** `requireAdmin()` su POST; GET autenticato come altre route `/api/ad/*`.
- **Data dir:** `resolveDataDir()` / pattern tenant DB esistente. Mai path hard-coded `data/`.
- **Test:** `node --import tsx --test <file>` (script `npm test`).
- **ENGINE_VERSION** costante `"0.1.0"`.
- Comunicazione UI: “AD Health Domarc (LDAP) — non è PingCastle”.

---

## File Structure

```
DA-IPAM/
  src/lib/ad/health/
    types.ts                 # Finding, Run, Score, RuleContext, RuleDef
    uac.ts                   # bit flags UAC
    score.ts                 # severityFromPoints, aggregateScores
    obsolete-os.ts           # match OS string
    thresholds.ts            # 90/365/180/5
    rules/
      index.ts               # ALL_RULES: RuleDef[]
      stale.ts               # DA-S-*
      privileged.ts          # DA-P-*
      trust.ts               # DA-T-*
      anomaly.ts             # DA-A-* (no DomainScore)
    ldap-extras.ts           # query UAC bits, SPN, trusts, krbtgt, guest, recycle bin
    engine.ts                # runAdHealthcheck(integrationId)
    persist.ts               # schema + insert run/findings
    export.ts                # toHubExport(runId) → ParserResult-like JSON
    __tests__/
      score.test.ts
      obsolete-os.test.ts
      rules-stale.test.ts
      rules-privileged.test.ts
      rules-anomaly.test.ts
      persist.test.ts
      export.test.ts
  src/lib/ad/ad-client.ts    # lastLogonTimestamp su users
  src/lib/db-tenant-schema.ts / migrazioni runtime job_type
  src/lib/cron/jobs.ts       # case ad_healthcheck (opz.)
  src/app/api/ad/healthcheck/route.ts
  src/app/api/ad/healthcheck/export/route.ts
  src/app/(dashboard)/active-directory/page.tsx  # UI section

DA-Vul-can/  (Task 10)
  src/lib/assessments/kind.ts
  src/lib/parser/domarc-ad-health.ts (+ detect)
  src/app/api/reports/upload/route.ts
  enrichment orchestrator namespace domarc-ad
```

---

### Task 1: Tipi, UAC, soglie, score, obsolete-os

**Files:**
- Create: `src/lib/ad/health/types.ts`
- Create: `src/lib/ad/health/uac.ts`
- Create: `src/lib/ad/health/thresholds.ts`
- Create: `src/lib/ad/health/score.ts`
- Create: `src/lib/ad/health/obsolete-os.ts`
- Test: `src/lib/ad/health/__tests__/score.test.ts`
- Test: `src/lib/ad/health/__tests__/obsolete-os.test.ts`

**Produces:**
- `HealthAxis`, `HealthFinding`, `HealthScore`, `RuleContext`, `RuleDef`
- `severityFromPoints(points: number): "Critical"|"High"|"Medium"|"Low"`
- `aggregateScores(findings: HealthFinding[]): HealthScore`
- `isObsoleteOs(os: string | null): boolean`
- `UAC` bit constants + `hasFlag(uac: number, bit: number): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/ad/health/__tests__/score.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { severityFromPoints, aggregateScores } from "../score";
import type { HealthFinding } from "../types";

test("severityFromPoints thresholds", () => {
  assert.equal(severityFromPoints(30), "Critical");
  assert.equal(severityFromPoints(20), "High");
  assert.equal(severityFromPoints(10), "Medium");
  assert.equal(severityFromPoints(1), "Low");
  assert.equal(severityFromPoints(0), "Low");
});

test("aggregateScores takes max axis and caps at 100", () => {
  const findings: HealthFinding[] = [
    { ruleId: "DA-S-X", axis: "stale", points: 60, severity: "Critical", title: "t", description: "d", objectCount: 1, sampleDns: [] },
    { ruleId: "DA-S-Y", axis: "stale", points: 50, severity: "Critical", title: "t", description: "d", objectCount: 1, sampleDns: [] },
    { ruleId: "DA-P-X", axis: "privileged", points: 30, severity: "Critical", title: "t", description: "d", objectCount: 1, sampleDns: [] },
  ];
  const s = aggregateScores(findings);
  assert.equal(s.stale, 100); // 60+50 capped
  assert.equal(s.privileged, 30);
  assert.equal(s.trust, 0);
  assert.equal(s.anomaly, 0);
  assert.equal(s.global, 100);
});
```

```ts
// src/lib/ad/health/__tests__/obsolete-os.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isObsoleteOs } from "../obsolete-os";

test("detects obsolete OS substrings", () => {
  assert.equal(isObsoleteOs("Windows 7 Professional"), true);
  assert.equal(isObsoleteOs("Windows Server 2012 R2"), true);
  assert.equal(isObsoleteOs("Windows Server 2019"), false);
  assert.equal(isObsoleteOs(null), false);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
node --import tsx --test src/lib/ad/health/__tests__/score.test.ts src/lib/ad/health/__tests__/obsolete-os.test.ts
```

Expected: FAIL module not found.

- [ ] **Step 3: Implement modules**

```ts
// types.ts — export:
export type HealthAxis = "stale" | "privileged" | "trust" | "anomaly" | "score";
export type HealthSeverity = "Critical" | "High" | "Medium" | "Low";

export interface HealthFinding {
  ruleId: string;
  axis: HealthAxis;
  points: number;
  severity: HealthSeverity;
  title: string;
  description: string;
  objectCount: number;
  sampleDns: string[]; // max 50
  raw?: Record<string, unknown>;
}

export interface HealthScore {
  global: number;
  stale: number;
  privileged: number;
  trust: number;
  anomaly: number;
}

export interface AdUserRow {
  samAccountName: string;
  distinguishedName: string;
  enabled: boolean;
  lastLogonAt: string | null;
  passwordLastSetAt: string | null;
  uac: number | null;
  servicePrincipalNames: string[];
  memberOfDns: string[];
}

export interface AdComputerRow {
  samAccountName: string;
  distinguishedName: string;
  enabled: boolean;
  lastLogonAt: string | null;
  operatingSystem: string | null;
  uac: number | null;
  isDomainController: boolean;
}

export interface AdGroupRow {
  samAccountName: string;
  distinguishedName: string;
  memberDns: string[];
}

export interface AdTrustRow {
  name: string;
  trustDirection: number | null;
  trustType: number | null;
  trustAttributes: number | null;
}

export interface RuleContext {
  now: Date;
  domainFqdn: string;
  users: AdUserRow[];
  computers: AdComputerRow[];
  groups: AdGroupRow[];
  trusts: AdTrustRow[];
  krbtgtPasswordLastSetAt: string | null;
  guestEnabled: boolean | null;
  recycleBinEnabled: boolean | null;
}

export interface RuleDef {
  id: string;
  axis: Exclude<HealthAxis, "score">;
  points: number;
  title: string;
  run: (ctx: RuleContext) => HealthFinding | null; // null = no match
}

export const ENGINE_VERSION = "0.1.0";
export const SAMPLE_CAP = 50;
```

```ts
// uac.ts
export const UAC = {
  ACCOUNTDISABLE: 0x0002,
  PASSWD_NOTREQD: 0x0020,
  DONT_EXPIRE_PASSWORD: 0x10000,
  TRUSTED_FOR_DELEGATION: 0x80000,
  DONT_REQ_PREAUTH: 0x400000,
} as const;

export function hasFlag(uac: number | null | undefined, bit: number): boolean {
  if (uac == null || Number.isNaN(uac)) return false;
  return (uac & bit) !== 0;
}
```

```ts
// thresholds.ts
export const THRESHOLDS = {
  inactiveDays: 90,
  adminPwdMaxDays: 365,
  krbtgtMaxDays: 180,
  domainAdminsWarnAbove: 5,
} as const;
```

```ts
// score.ts — implement severityFromPoints + aggregateScores per test
// obsolete-os.ts — lista substring da spec, toLowerCase includes
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --import tsx --test src/lib/ad/health/__tests__/score.test.ts src/lib/ad/health/__tests__/obsolete-os.test.ts
```

- [ ] **Step 5: Commit** (solo se l’utente ha chiesto commit in sessione; altrimenti stop e segnalare)

```bash
git add src/lib/ad/health/
git commit -m "$(cat <<'EOF'
feat(ad-health): add types, UAC flags, score and obsolete-OS helpers

EOF
)"
```

---

### Task 2: Rule Stale (DA-S-*)

**Files:**
- Create: `src/lib/ad/health/rules/stale.ts`
- Create: `src/lib/ad/health/rules/helpers.ts` — `daysSince(iso, now)`, `sample(list)`, `aggFinding(...)`
- Test: `src/lib/ad/health/__tests__/rules-stale.test.ts`

**Consumes:** `RuleContext`, `THRESHOLDS`, `UAC`, `isObsoleteOs`, `severityFromPoints`  
**Produces:** `staleRules: RuleDef[]` con id:
`DA-S-InactiveUser`, `DA-S-InactiveComputer`, `DA-S-ObsoleteOS`,
`DA-S-PwdNeverExpires`, `DA-S-PwdNotRequired`, `DA-S-NoPreAuth`

- [ ] **Step 1: Write failing tests** con `RuleContext` minimale (2 user inattivi, 1 OS obsolete, 1 UAC flag ciascuno). Assert `run(ctx)?.objectCount` e `ruleId`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** `helpers.ts` + `stale.ts`. Per ogni rule: se zero match → `null`; altrimenti finding con `points` da tabella spec, `sampleDns` ≤ 50.

Logica:
- Inactive*: `enabled && (lastLogonAt == null || daysSince >= 90)`
- ObsoleteOS: `isObsoleteOs(operatingSystem)` su computer enabled
- UAC flags: `enabled && hasFlag(uac, BIT)` (skip se `uac == null` → non matchare; ldap-extras deve popolare uac)

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** (se richiesto)

---

### Task 3: Rule Privileged + Trust + Anomaly

**Files:**
- Create: `src/lib/ad/health/rules/privileged.ts`
- Create: `src/lib/ad/health/rules/trust.ts`
- Create: `src/lib/ad/health/rules/anomaly.ts`
- Create: `src/lib/ad/health/rules/index.ts`
- Test: `src/lib/ad/health/__tests__/rules-privileged.test.ts`
- Test: `src/lib/ad/health/__tests__/rules-anomaly.test.ts`

**Produces:** `ALL_RULES: RuleDef[]` (14 rule, senza DomainScore — quello lo fa `engine`/`export`)

Rule:
- `DA-P-DomainAdminsCount` — risolvi gruppo `Domain Admins` (sAMAccountName o CN); espandi `memberDns` fino a 2 livelli (gruppi annidati via `groups` map DN→members); conta user enabled; match se count > 5
- `DA-P-AdminPwdAge` — stessi membri DA; pwdLastSet null o days > 365
- `DA-P-UnconstrainedDelegation` — user/computer con flag; **escludi** `isDomainController === true`
- `DA-P-Kerberoastable` — user enabled con `servicePrincipalNames.length > 0`
- `DA-T-TrustInventory` — match se esiste almeno un trust (MVP: qualsiasi trust = informativo points 5); description elenca nomi
- `DA-A-KrbtgtAge` — `krbtgtPasswordLastSetAt` null o days > 180
- `DA-A-GuestEnabled` — `guestEnabled === true`
- `DA-A-RecycleBin` — `recycleBinEnabled === false` (se `null` = skip/no match: dato non raccolto)

- [ ] **Step 1–4:** TDD come Task 2 (fixture nested group, krbtgt vecchio, guest on, recycle off).

- [ ] **Step 5:** `index.ts` esporta `ALL_RULES = [...staleRules, ...privilegedRules, ...trustRules, ...anomalyRules]` e assert in test `ALL_RULES.length === 14` e id unici.

---

### Task 4: Persistenza schema + DB helpers

**Files:**
- Create: `src/lib/ad/health/persist.ts`
- Modify: `src/lib/db-tenant-schema.ts` — aggiungere DDL tabelle (o solo migrazione runtime in persist, coerente con pattern meshcentral `applyMcSchemaMigrations`)
- Preferito: `ensureAdHealthSchema(db)` chiamato da engine/API (idempotente), come meshcentral
- Test: `src/lib/ad/health/__tests__/persist.test.ts`

**Produces:**
- `ensureAdHealthSchema(db: Database): void`
- `insertRun(...)`, `finishRun(...)`, `insertFindings(runId, findings)`
- `getLatestRun(integrationId)`, `getFindings(runId)`

Schema SQL esatto dalla spec §5 (`ad_health_runs`, `ad_health_findings` + indici).

- [ ] **Step 1:** Test in-memory: create schema twice; insert run+findings; getLatest.

- [ ] **Step 2–4:** Implement + PASS.

- [ ] **Step 5:** Commit se richiesto.

**Nota job_type:** se si aggiunge cron in Task 8, estendere CHECK `job_type` con migrazione runtime (pattern già in `db-tenant.ts` per `wazuh_sync`).

---

### Task 5: LDAP extras + lastLogonTimestamp sync

**Files:**
- Create: `src/lib/ad/health/ldap-extras.ts`
- Modify: `src/lib/ad/ad-client.ts` — users search attributes + prefer `lastLogonTimestamp` per `last_logon_at`
- Test: unit su parsing helper puri in `ldap-extras` (FILETIME → ISO) se estratti; sync change covered da test piccolo se esiste harness, altrimenti review manuale

**Produces:**
```ts
export async function collectLdapExtras(integrationId: number): Promise<{
  userUacBySam: Map<string, number>;
  userSpnBySam: Map<string, string[]>;
  computerUacBySam: Map<string, number>;
  computerIsDcBySam: Map<string, boolean>;
  trusts: AdTrustRow[];
  krbtgtPasswordLastSetAt: string | null;
  guestEnabled: boolean | null;
  recycleBinEnabled: boolean | null;
  groupMembersByDn: Map<string, string[]>; // refresh members if needed
}>
```

Implementazione:
- Riusare `connectLdap` pattern da `ad-client.ts` (estrarre `connectLdap`/`ldapTimestampToIso` come export se oggi sono private — **exportare** le helper necessarie da `ad-client.ts` o spostarle in `ad/ldap-utils.ts` senza cambiare comportamento sync).
- Query users: `userAccountControl`, `servicePrincipalName`, `pwdLastSet`, `lastLogonTimestamp`, `memberOf`
- Query computers: UAC, `userAccountControl`, OS, `primaryGroupID` o memberOf Domain Controllers
- Trusts: search base `CN=System,{baseDn}` filter `(objectClass=trustedDomain)` attrs `name`, `trustDirection`, `trustType`, `trustAttributes`
- krbtgt: filter `(sAMAccountName=krbtgt)` → `pwdLastSet`
- Guest: `(sAMAccountName=Guest)` → UAC disable bit
- Recycle Bin: leggere `msDS-EnabledFeature` / optional feature DN (implementazione: search Configuration partition `CN=Optional Features,CN=Directory Service,CN=Windows NT,CN=Services,CN=Configuration,{forestRoot}` — se troppo fragile in lab, usare atributo su domain `msDS-EnabledFeatureBL` / documentare fallback `null`)

- [ ] **Step 1:** Export `connectLdap` + timestamp helpers (o `ldap-utils.ts`).

- [ ] **Step 2:** Users sync: aggiungi `"lastLogonTimestamp"` agli attributes;  
  `const lastLogonAt = ldapTimestampToIso(entry.lastLogonTimestamp as string) ?? ldapTimestampToIso(entry.lastLogon as string);`

- [ ] **Step 3:** Implement `collectLdapExtras`.

- [ ] **Step 4:** Smoke manuale opzionale su lab AD; unit su `ldapTimestampToIso` se spostato.

- [ ] **Step 5:** Commit se richiesto.

---

### Task 6: Engine + DomainScore finding

**Files:**
- Create: `src/lib/ad/health/engine.ts`
- Test: `src/lib/ad/health/__tests__/engine.test.ts` (mock ctx builder, no LDAP)

**Produces:**
```ts
export async function runAdHealthcheck(
  integrationId: number,
  opts?: { refreshSync?: boolean }
): Promise<{ runId: number; score: HealthScore; findings: HealthFinding[] }>
```

Flusso:
1. `ensureAdHealthSchema`
2. Se esiste run `status=running` per integration → throw conflict error
3. Insert run `running`
4. Se `refreshSync !== false` (default true): `await syncActiveDirectory(integrationId)` (best-effort: errori sync in `stats_json`, non abort se cache non vuota)
5. Load users/computers/groups da DB tenant (`listAdUsers` etc. esistenti)
6. `collectLdapExtras` → merge in `RuleContext` (uac, spn, dc flag, trusts, …)
7. `findings = ALL_RULES.map(r => r.run(ctx)).filter(Boolean)`
8. `score = aggregateScores(findings)`
9. Append finding sintetico:
   - `ruleId: "DA-A-DomainScore"`, `axis: "score"`, `points: score.global`, severity da points, description con 4 assi + domain
10. Persist findings; finish run `ok` (o `error` in catch)
11. Return

- [ ] **Step 1–4:** TDD con stub di load/collect iniettabili **oppure** test solo della funzione pura `buildFindingsFromContext(ctx)` estratta da engine (preferito YAGNI: esporta `evaluateContext(ctx): { score, findings }` e testa quella; `runAdHealthcheck` thin wrapper).

```ts
export function evaluateContext(ctx: RuleContext): { score: HealthScore; findings: HealthFinding[] }
```

- [ ] **Step 5:** Commit se richiesto.

---

### Task 7: Export hub JSON

**Files:**
- Create: `src/lib/ad/health/export.ts`
- Test: `src/lib/ad/health/__tests__/export.test.ts`

**Produces:**
```ts
export interface HubHealthExport {
  source: "domarc-ad-health";
  domain_fqdn: string;
  engine_version: string;
  generated_at: string;
  scores: HealthScore;
  findings: Array<{
    ip: null;
    hostname: string;
    severity: string;
    cvss_score: number;
    nvt_oid: string;
    nvt_name: string;
    description: string;
    source_kind: "ad_misconfig" | "risk_indicator";
    raw_json: string;
  }>;
}

export function toHubExport(args: {
  domainFqdn: string;
  score: HealthScore;
  findings: HealthFinding[];
  generatedAt?: Date;
}): HubHealthExport
```

Mapping:
- `DA-A-DomainScore` → `source_kind: "risk_indicator"`, altri → `ad_misconfig`
- `cvss_score`: allinea a `parse_pingcastle` spirit — `min(10, points/10)` per DomainScore usare `global/10`; per rule `min(10, points/10)` oppure mappa severity→cvss fissa (Critical 9.5, High 8, Medium 5.5, Low 3)

- [ ] **Step 1–4:** Snapshot test JSON keys + oid prefix `DA-`.

- [ ] **Step 5:** Commit se richiesto.

---

### Task 8: API routes (+ job opzionale)

**Files:**
- Create: `src/app/api/ad/healthcheck/route.ts`
- Create: `src/app/api/ad/healthcheck/export/route.ts`
- Modify: `src/lib/cron/jobs.ts` — opzionale `case "ad_healthcheck"`
- Modify: `src/lib/db-tenant.ts` / schema CHECK se si aggiunge job_type

**API:**

`POST /api/ad/healthcheck`  
- `requireAdmin()`  
- body Zod: `{ integrationId: z.number().int().positive(), refreshSync: z.boolean().optional() }`  
- chiama `runAdHealthcheck`  
- conflict → 409  
- success → 200 `{ runId, score, findings }`

`GET /api/ad/healthcheck?integrationId=`  
- auth come GET ad (stesso helper delle altre route AD list)  
- latest run + findings

`GET /api/ad/healthcheck/export?runId=`  
- admin o auth  
- `Content-Disposition: attachment; filename="ad-health-{domain}-{runId}.json"`

- [ ] **Step 1:** Implement routes (pattern da `src/app/api/ad/[id]/sync/route.ts`).

- [ ] **Step 2:** Smoke con `curl` locale se server up; altrimenti review code.

- [ ] **Step 3:** Commit se richiesto.

---

### Task 9: UI Active Directory

**Files:**
- Modify: `src/app/(dashboard)/active-directory/page.tsx`

**UI (sezione nuova sotto integrazioni / tab dedicato “Health”):**
- Disclaimer testo fisso
- Score cards: Global, Stale, Privileged, Trust, Anomaly
- Button “Esegui healthcheck” → POST; loading state; toast error/success
- Tabella findings: ruleId, severity Badge, title, objectCount; expand sample
- Button “Esporta JSON” → window open export URL

- [ ] **Step 1:** Aggiungere state `healthRun`, `healthLoading`, fetch on integration select.

- [ ] **Step 2:** Manual UI check.

- [ ] **Step 3:** Commit se richiesto.

---

### Task 10: Hub DA-Vul-can ingest (repo separato)

**Files (DA-Vul-can):**
- Modify: `src/lib/assessments/kind.ts` — `"domarc-ad-health": "AD"`
- Create: `src/lib/parser/domarc-ad-health.ts` — parse JSON HubHealthExport → `ParserResult`
- Modify: `src/app/api/reports/upload/route.ts` — detect `.json` con `source===domarc-ad-health"` oppure header
- Modify: `src/lib/enrichment/orchestrator.ts` + enrich route — `source === "domarc-ad-health"` → mode `ad`, namespace **`domarc-ad`**
- Test: `src/lib/assessments/__tests__/kind.test.ts` o nuovo test kind
- Test: parser unit su fixture JSON da Task 7

- [ ] **Step 1:** `kindFromSource("domarc-ad-health") === "AD"` test.

- [ ] **Step 2:** Parser + upload path.

- [ ] **Step 3:** Enrichment namespace `domarc-ad` (cache keys separate da pingcastle).

- [ ] **Step 4:** Commit su branch corrente DA-Vul-can (se richiesto).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Runtime DA-IPAM, no edge obbligatorio | 6–9 |
| 14 rule + DomainScore | 2, 3, 6 |
| Score 4 assi + globale max | 1, 6 |
| Tabelle ad_health_* | 4 |
| API + UI | 8, 9 |
| Export hub / source domarc-ad-health | 7, 10 |
| lastLogonTimestamp | 5 |
| No PingCastle IDs | Global + rule ids |
| Disclaimer UI | 9 |

## Placeholder scan

Nessun TBD lasciato nei task; Recycle Bin ha fallback `null` → no match documentato in Task 3/5.

---

## Execution handoff

Piano salvato in [`DA-IPAM/docs/superpowers/plans/2026-07-25-ad-health-native.md`](2026-07-25-ad-health-native.md).

**Due opzioni di esecuzione:**

1. **Subagent-Driven (consigliato)** — un subagent fresco per task, review tra i task  
2. **Inline Execution** — eseguo i task in questa sessione a batch con checkpoint  

Quale preferisci?
