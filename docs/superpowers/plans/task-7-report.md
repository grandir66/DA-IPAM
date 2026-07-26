# Task 7 Report — Export hub JSON

**Status:** DONE · **Branch:** `feat/ad-health-native` · **SHA:** `adc760d`

## Delivered

- `src/lib/ad/health/export.ts` — `toHubExport()` → `HubHealthExport`
- `source: "domarc-ad-health"`; `nvt_oid` = ruleId (`DA-*`)
- DomainScore → `risk_indicator` + cvss `global/10`; other rules → `ad_misconfig` + severity CVSS map
- `__tests__/export.test.ts` — keys snapshot + oid/source_kind

## Tests

- export 2/2; suite health 37/37

## Next

Task 8 — API routes (+ job opzionale).
