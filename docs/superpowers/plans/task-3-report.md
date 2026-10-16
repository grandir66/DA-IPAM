# Task 3 Report — Privileged + Trust + Anomaly + ALL_RULES

**Status:** DONE  
**Branch:** `feat/ad-health-native`  
**Worktree:** `/Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health`  
**Date:** 2026-07-25

## Commit

| SHA | Subject |
|---|---|
| `cd64675612301262f0372f0126982d0593d7d47e` | feat(ad-health): add privileged, trust, anomaly rules and ALL_RULES |

## Files created

| Path | Role |
|---|---|
| `src/lib/ad/health/rules/privileged.ts` | `privilegedRules` + `resolveDomainAdminUsers` (nested ≤2) |
| `src/lib/ad/health/rules/trust.ts` | `trustRules` (`DA-T-TrustInventory`) |
| `src/lib/ad/health/rules/anomaly.ts` | `anomalyRules` (no DomainScore) |
| `src/lib/ad/health/rules/index.ts` | `ALL_RULES` (14) |
| `src/lib/ad/health/__tests__/rules-privileged.test.ts` | DA nested fixture, trust, ALL_RULES |
| `src/lib/ad/health/__tests__/rules-anomaly.test.ts` | krbtgt / guest / recycle bin |

## TDD evidence

### RED

```bash
node --import tsx --test src/lib/ad/health/__tests__/rules-privileged.test.ts src/lib/ad/health/__tests__/rules-anomaly.test.ts
```

**Result:** FAIL — `MODULE_NOT_FOUND` for `../rules` (expected).

### GREEN

Same command after implementation.

**Result:**

```
# tests 12
# pass 12
# fail 0
```

Regression (`rules-stale` + `score` + `obsolete-os`): 11 pass / 0 fail.

## Rules implemented

| ID | Points | Match logic |
|---|---|---|
| `DA-P-DomainAdminsCount` | 15 | enabled DA members (nest ≤2) count > 5 |
| `DA-P-AdminPwdAge` | 20 | same members; pwdLastSet null or days > 365 |
| `DA-P-UnconstrainedDelegation` | 30 | TRUSTED_FOR_DELEGATION; DCs excluded |
| `DA-P-Kerberoastable` | 15 | enabled user with SPN(s) |
| `DA-T-TrustInventory` | 5 | ≥1 trust; description lists names |
| `DA-A-KrbtgtAge` | 25 | krbtgt pwd null or days > 180 |
| `DA-A-GuestEnabled` | 20 | `guestEnabled === true` |
| `DA-A-RecycleBin` | 15 | `recycleBinEnabled === false` (`null` → no match) |

`ALL_RULES.length === 14`, unique ids, no `DA-A-DomainScore`.

## Concerns

- Nested expansion: DA = depth 0; group members expanded only while depth < 2 (level-3 users like `TooDeep→deep` excluded). Confirm against real AD nesting if lab differs.
- UnconstrainedDelegation does not require `enabled` (plan only says flag + exclude DC).
- `task-1-report.md` still untracked (not in this commit).

## Next

Task 4 — Persistenza schema + DB helpers.
