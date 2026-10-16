# AD Health Phase 4 — ACL Collect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BloodHound-style LDAP `nTSecurityDescriptor` acquisition with selective interesting-ACE persistence and DCSync/AdminSDHolder/DangerousAcl rules (ENGINE 0.4.0).

**Architecture:** Pure TS security-descriptor parser + ldapts SD_FLAGS control; paged collect over domain/AdminSDHolder/OU/user/group/computer; filter to interesting ACEs; wire into RuleContext + Health UI; best-effort (run stays ok if ACL unavailable).

**Tech Stack:** TypeScript, ldapts `Control`, node:test, existing `src/lib/ad/health/*` patterns.

## Global Constraints

- Worktree only: `/Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health` on `feat/ad-health-native`
- Do NOT modify `/Users/riccardo/Progetti/Domarc/DA-IPAM` (`dev`)
- Spec: `docs/superpowers/specs/2026-07-26-ad-health-acl-collect-design.md`
- ENGINE_VERSION → `0.4.0`
- Rule IDs: `DA-P-DCSyncRights`, `DA-A-AdminSDHolderAce`, `DA-P-DangerousAcl`, `DA-A-AclCollectPartial`
- No GPL code dumps; no Impacket; parser in-repo
- Cap 15_000 SD, timeout 120s, max 500 interesting ACEs in stats
- ACL failure → best-effort, not run error

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/ad/health/acl/sid.ts` | SID binary ↔ `S-1-5-…` |
| `src/lib/ad/health/acl/sd-flags-control.ts` | BER flags=7 Control |
| `src/lib/ad/health/acl/security-descriptor.ts` | Parse SR_SECURITY_DESCRIPTOR |
| `src/lib/ad/health/acl/well-known-sids.ts` | Expected trustees |
| `src/lib/ad/health/acl/interesting-ace.ts` | Classify + filter |
| `src/lib/ad/health/acl/acl-collect.ts` | LDAP collect + sid map |
| `src/lib/ad/health/acl/types.ts` | AclExtras, InterestingAce, meta |
| `src/lib/ad/health/rules/phase4.ts` | New rules |
| Modify `types.ts`, `engine.ts`, `rules/index.ts`, API/UI | Wire + display |

---

### Task 1: SID + SD_FLAGS control + SD parser (TDD)

**Files:**
- Create: `src/lib/ad/health/acl/{sid,sd-flags-control,security-descriptor,types}.ts`
- Test: `src/lib/ad/health/__tests__/acl-parser.test.ts`

**Produces:**
- `sidToString(buf: Buffer): string`
- `parseSid(buf: Buffer): { revision, subAuthorities: number[] }`
- `sdFlagsControl(flags?: number): Control` → value `30 03 02 01 07` for 7
- `parseSecurityDescriptor(buf: Buffer): { ownerSid, groupSid, aces: ParsedAce[] }`

- [ ] Write failing tests for SID string, control bytes, minimal SD with one ACCESS_ALLOWED_OBJECT_ACE (DCSync GUID)
- [ ] Implement until green
- [ ] Commit

### Task 2: Interesting ACE filter + well-known SIDs

**Files:**
- Create: `interesting-ace.ts`, `well-known-sids.ts`
- Test: `acl-interesting.test.ts`

**Produces:**
- `classifyAce(ace, objectKind): string[]` rights labels
- `isExpectedDomainTrustee(sid, domainSid?): boolean`
- `filterInterestingAces(...): InterestingAce[]`

- [ ] Tests: expected DA SID skipped on domain DCSync; unexpected kept; AdminSDHolder non-default kept
- [ ] Implement + commit

### Task 3: ACL LDAP collect

**Files:**
- Create: `acl-collect.ts`
- Modify: `engine.ts` to call collect best-effort

**Produces:**
- `collectAclExtras(integrationId): Promise<AclExtras>`

- [ ] Implement paged searches with SD_FLAGS control + caps/timeout
- [ ] Unit-test pure helpers (limit/truncate) if extractable; collect itself integration-light
- [ ] Commit

### Task 4: Phase4 rules + ENGINE 0.4.0

**Files:**
- Create: `rules/phase4.ts`, `__tests__/rules-phase4.test.ts`
- Modify: `rules/index.ts`, `types.ts` (RuleContext.acl, ENGINE_VERSION)

- [ ] Failing tests for 4 rules
- [ ] Implement + ALL_RULES count 36
- [ ] Commit

### Task 5: API + UI ACL block

**Files:**
- Modify: `engine.ts` stats.acl, `route.ts` return acl, `page.tsx` ACL section

- [ ] Surface acl meta + top ACE table
- [ ] Commit

### Task 6: Deploy note / verify tests

- [ ] Run full health test suite
- [ ] Push branch; deploy to 192.168.4.8 only if user asks (or if already pattern — user said proceed so deploy after green)
