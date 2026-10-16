# Task 6 Report — Engine + DomainScore finding

**Status:** DONE · **Branch:** `feat/ad-health-native` · **SHA:** `7959a06`

## Delivered

- `src/lib/ad/health/engine.ts` — `evaluateContext(ctx)` pure; `runAdHealthcheck(id, opts?)`; `AdHealthConflictError`
- DomainScore finding `DA-A-DomainScore` (axis `score`, points = global)
- Wrapper: schema → conflict if running → sync (default) → `getAdUsers/Computers/Groups` + `collectLdapExtras` → evaluate → persist
- `persist.getRunningRun` for conflict check
- `__tests__/engine.test.ts` — 3 tests on evaluateContext

## Tests

- engine 3/3; suite health 35/35

## Next

Task 7 — Export hub JSON.
