# Task 8 Report — API routes AD Healthcheck

**Status:** DONE · **Branch:** `feat/ad-health-native` · **SHA:** `1de2ae8`

## Delivered

- `GET/POST /api/ad/healthcheck` — Zod body/query; POST `requireAdmin`; conflict → 409
- `GET /api/ad/healthcheck/export?runId=` — `toHubExport` + `Content-Disposition` attachment
- `getRunById` in `persist.ts` (export lookup)

## Skipped

- Cron `job_type=ad_healthcheck` + CHECK migration — YAGNI (large schema change)

## Next

Task 9 — UI Active Directory (Health section).
