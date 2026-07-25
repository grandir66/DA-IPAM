# AD Health Fase 2 — Rule pack ADPulse-inspired + LDAP probe

> **For agentic workers:** execute task-by-task on worktree  
> `/Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health` only.  
> Do NOT modify `/Users/riccardo/Progetti/Domarc/DA-IPAM` (`dev`).

**Goal:** Espandere il motore AD Health con controlli ispirati ad **ADPulse** (MIT, LDAP read-only) e probe LDAP/LDAPS (idee LDAP-Security-Tester), reimplementati come rule `DA-*` Domarc — nessun fork/binary esterno.

**Architecture:** Estendere `LdapExtras` + `RuleContext` con attributi aggiuntivi; nuove rule in `rules/phase2.ts` (o sparse in privileged/anomaly); bump `ENGINE_VERSION` a `0.2.0`.

**Sources (idee only):** ADPulse checklist; ADcheck control list (GPL → no code); LDAP-Security-Tester (C# → probe ldapts).

## Global Constraints

- Worktree isolato `feat/ad-health-native` only.
- Rule ID `DA-*` only; no PingCastle/ADPulse RiskId.
- 1 finding aggregato per rule; points da tabella sotto.
- TDD dove pratico; suite `src/lib/ad/health/__tests__` deve restare green.
- Non integrare ADscan / AssessmentKit / ORADAD.

## Nuove rule (congelate)

| ID | Axis | Points | Match quando |
|---|---|---|---|
| `DA-A-PwdPolicy` | anomaly | 20 | minPwdLength &lt; 12 **oppure** lockoutThreshold == 0 (se leggibili) |
| `DA-A-LapsCoverage` | anomaly | 15 | schema LAPS assente **oppure** &gt;25% computer non-DC senza password LAPS |
| `DA-P-ConstrainedDelegation` | privileged | 20 | user/computer con `msDS-AllowedToDelegateTo` non vuoto (esclusi DC per computer) |
| `DA-P-ProtocolTransition` | privileged | 25 | UAC `TRUSTED_TO_AUTH_FOR_DELEGATION` (0x1000000) |
| `DA-P-RBCD` | privileged | 30 | `msDS-AllowedToActOnBehalfOfOtherIdentity` su computer (soprattutto DC) o domain |
| `DA-A-SidHistory` | anomaly | 15 | account con `sIDHistory` valorizzato |
| `DA-P-AdminCountOrphan` | privileged | 15 | `adminCount=1` su user enabled non membro di DA/EA/Schema Admins (approx) |
| `DA-A-PwdInDescription` | anomaly | 25 | description matcha `(?i)(password\|pwd\|passw\|passwd)\s*[:=]` |
| `DA-A-PreWin2000` | anomaly | 30 | gruppo Pre-Windows 2000 Compatible Access contiene Everyone o Anonymous Logon |
| `DA-A-MachineAccountQuota` | anomaly | 10 | `ms-DS-MachineAccountQuota` &gt; 0 |
| `DA-A-LdapsNotUsed` | anomaly | 15 | integrazione AD con `use_ssl=0` (LDAPS non forzato a livello Domarc) |
| `DA-P-ProtectedUsersGap` | privileged | 10 | ≥1 Domain Admin enabled non in Protected Users |

## Tasks

### Task A — Extend types + LdapExtras collect

Extend `RuleContext` / `LdapExtras` / `AdUserRow` / `AdComputerRow` with fields needed. Collect via LDAP in `ldap-extras.ts`:

- Domain base attrs: `minPwdLength`, `lockoutThreshold`, `ms-DS-MachineAccountQuota`, `msDS-Behavior-Version` (optional)
- Users: `adminCount`, `description`, `sIDHistory`, `msDS-AllowedToDelegateTo`
- Computers: `msDS-AllowedToDelegateTo`, `msDS-AllowedToActOnBehalfOfOtherIdentity`, LAPS attrs `ms-Mcs-AdmPwd` / `msLAPS-Password` (presence only — may be ACL-denied → treat as unknown)
- Groups: resolve Pre-Windows 2000 Compatible Access + Protected Users members
- `integrationUseSsl: boolean` passed into context from integration row (not LDAP)

UAC add: `TRUSTED_TO_AUTH_FOR_DELEGATION = 0x1000000`

### Task B — Implement phase2 rules + tests

Create `rules/phase2.ts` + `__tests__/rules-phase2.test.ts`. Wire into `ALL_RULES`. Update any test that asserts `ALL_RULES.length === 14` → `14 + 12 = 26`.

### Task C — Engine wiring + ENGINE_VERSION 0.2.0

Map extras → context in `engine.ts`. Bump version. Full health test suite green. Commit.

### Task D — Docs

Short note in plan/spec pointer: Fase 2 landed; ADPulse inspiration documented. No hub changes required (`DA-*` already ingested).
