# AD Health Phase 2 — Report

**Date:** 2026-07-25  
**Branch:** `feat/ad-health-native` (worktree `.worktrees/DA-IPAM-ad-health`)  
**ENGINE_VERSION:** `0.2.0`

## Status

Landed. Twelve ADPulse-inspired `DA-*` rules added; LDAP collect extended; suite green.

## Deliverables

| Item | Path |
|---|---|
| Types + `ENGINE_VERSION` | `src/lib/ad/health/types.ts` |
| UAC `TRUSTED_TO_AUTH_FOR_DELEGATION` | `src/lib/ad/health/uac.ts` |
| LDAP extras collect | `src/lib/ad/health/ldap-extras.ts` |
| Phase 2 rules | `src/lib/ad/health/rules/phase2.ts` |
| `ALL_RULES` wire-up | `src/lib/ad/health/rules/index.ts` (26 rules) |
| Engine mapping | `src/lib/ad/health/engine.ts` |
| Tests | `src/lib/ad/health/__tests__/rules-phase2.test.ts` |
| Plan | `docs/superpowers/plans/2026-07-25-ad-health-phase2-adpulse.md` |

## Rule IDs (12)

`DA-A-PwdPolicy`, `DA-A-LapsCoverage`, `DA-P-ConstrainedDelegation`, `DA-P-ProtocolTransition`, `DA-P-RBCD`, `DA-A-SidHistory`, `DA-P-AdminCountOrphan`, `DA-A-PwdInDescription`, `DA-A-PreWin2000`, `DA-A-MachineAccountQuota`, `DA-A-LdapsNotUsed`, `DA-P-ProtectedUsersGap`.

## Tests

```text
node --import tsx --test src/lib/ad/health/__tests__/*.test.ts
# tests 54  # pass 54  # fail 0
```

## Hub / appliance

No hub changes required — findings already use `DA-*` OIDs ingested by existing export path.

## Concerns

1. **LAPS ACL:** If the bind account cannot read `ms-Mcs-AdmPwd` / `msLAPS-Password`, AD often returns empty attrs (not an error). That can look like “schema absent / 0% coverage” and fire `DA-A-LapsCoverage`. True insufficient-access search failures set `lapsSchemaPresent=null` and skip.
2. **Pre-Win2000 / Protected Users:** Depend on groups being present in the Domarc AD cache + LDAP `member` extras. Missing cache group → rule skips (no false positive).
3. **AdminCount orphan:** Approx membership via nested ≤2 expansion of Domain/Enterprise/Schema Admins (+ primaryGroup RID); deep nesting beyond that may false-positive orphans.
