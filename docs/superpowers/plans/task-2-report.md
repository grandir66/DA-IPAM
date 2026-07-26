# Task 2 Report — Rule Stale (DA-S-*)

**Status:** DONE  
**Branch:** `feat/ad-health-native`  
**Worktree:** `/Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health`  
**Date:** 2026-07-25

## Commit

| SHA | Subject |
|---|---|
| `aacb3939636fe7e00a482e4f48283b25a46ecde9` | feat(ad-health): add stale rules DA-S-* with helpers |

## Files created

| Path | Role |
|---|---|
| `src/lib/ad/health/rules/helpers.ts` | `daysSince`, `sample`, `aggFinding` |
| `src/lib/ad/health/rules/stale.ts` | `staleRules: RuleDef[]` (6 rules) |
| `src/lib/ad/health/__tests__/rules-stale.test.ts` | fixture RuleContext + per-rule asserts |

## TDD evidence

### RED

```bash
cd /Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health
node --import tsx --test src/lib/ad/health/__tests__/rules-stale.test.ts
```

**Result:** FAIL — `MODULE_NOT_FOUND` for `../rules/stale` (expected).

### GREEN

Same command after implementation.

**Result:**

```
# tests 8
# pass 8
# fail 0
```

## Rules implemented

| ID | Points | Match logic |
|---|---|---|
| `DA-S-InactiveUser` | 10 | enabled && (lastLogonAt null \|\| daysSince ≥ 90) |
| `DA-S-InactiveComputer` | 10 | same on computers |
| `DA-S-ObsoleteOS` | 20 | enabled && `isObsoleteOs(operatingSystem)` |
| `DA-S-PwdNeverExpires` | 10 | enabled && UAC `DONT_EXPIRE_PASSWORD` |
| `DA-S-PwdNotRequired` | 30 | enabled && UAC `PASSWD_NOTREQD` |
| `DA-S-NoPreAuth` | 20 | enabled && UAC `DONT_REQ_PREAUTH` |

Zero matches → `null`. Aggregated finding: full `objectCount`, `sampleDns` capped at `SAMPLE_CAP` (50). UAC rules skip when `uac == null` (`hasFlag` → false).

## Concerns

- `task-1-report.md` remains untracked from Task 1 (not included in this commit).
- Titles/descriptions are Domarc-authored (no PingCastle RiskId/copy); can refine later for UI polish.

## Next

Task 3 — Privileged + Trust + Anomaly + `ALL_RULES` index.
