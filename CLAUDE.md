# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DA-IPAM is a full-stack IP Address Management web application built with Next.js 16. It manages networks, scans hosts (ICMP ping, nmap), acquires MAC addresses from routers (ARP tables), maps switch ports, and provides scheduled monitoring with cron jobs.

## Commands

```bash
npm run dev          # Start dev server (Next.js only)
npm run dev:server   # Start custom server with cron scheduler (tsx watch server.ts)
npm run build        # Production build
npm run start        # Production start with cron scheduler
npm run lint         # Lint check
```

## Stack

- **Framework:** Next.js 16 (App Router), TypeScript strict
- **UI:** Tailwind CSS v4, shadcn/ui v4 (uses @base-ui/react, NOT @radix-ui), framer-motion, Recharts
- **Database:** SQLite via better-sqlite3 (WAL mode, file at `data/ipam.db`)
- **Auth:** NextAuth v5 (beta) with Credentials provider, JWT in HttpOnly cookies
- **Validation:** Zod v4 (uses `.issues` not `.errors`)
- **Font:** Signika (Google Fonts) via `next/font/google`
- **Scanning:** child_process for ping/nmap, Node.js `dns` builtin
- **Device integration:** ssh2 (SSH), net-snmp (SNMP), fetch (REST API)
- **Scheduling:** node-cron via custom server (`server.ts`)
- **Palette:** Primary #00A7E7, Navy #0D2537, Gold #FFD400, BG #EDEDED (domarc.it colors)

## Architecture

### Route Groups

- `src/app/(dashboard)/` — All authenticated pages (uses `AppShell` layout with sidebar)
- `src/app/login/` and `src/app/setup/` — Public pages (no sidebar)

### Key Directories

- `src/lib/db.ts` — SQLite singleton, all query functions. 9 tables: users, networks, hosts, scan_history, network_devices, arp_entries, mac_port_entries, scheduled_jobs, status_history
- `src/lib/scanner/` — ping.ts, nmap.ts, dns.ts, mac-vendor.ts, discovery.ts (orchestrator with in-memory progress tracking)
- `src/lib/devices/` — router-client.ts and switch-client.ts with vendor-specific implementations (MikroTik, Cisco, Ubiquiti, HP, Omada)
- `src/lib/cron/` — scheduler.ts (node-cron task management), jobs.ts (ping_sweep, nmap_scan, arp_poll, dns_resolve, cleanup)
- `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt for device credentials
- `src/components/shared/` — sidebar, app-shell, ip-grid, status-badge, scan-progress, global-search, theme-toggle, page-transition, online-chart, uptime-timeline

### Runtime Separation

- **Middleware** (`src/middleware.ts`) runs in Edge runtime — imports only `auth.config.ts` (no Node.js APIs)
- **auth.ts** uses dynamic imports for `db` and `bcrypt` to stay Node.js-only
- `next.config.ts` has `serverExternalPackages` for native modules: better-sqlite3, ssh2, net-snmp, bcrypt, oui

### shadcn/ui v4 Differences

- Uses `@base-ui/react` instead of `@radix-ui`
- No `asChild` prop — use `render={<Component />}` instead (e.g., `<DialogTrigger render={<Button />}>`)

### Zod v4 Differences

- Error messages: `parsed.error.issues` (not `.errors`)
- `z.record()` requires two args: `z.record(z.string(), z.unknown())`
- `.nullable()` produces `T | null | undefined` — TypeScript types must match

## Code Conventions

- TypeScript strict mode, no `any`
- Functional components with named exports
- Tailwind CSS utility classes (custom palette defined in globals.css CSS variables)
- Server Components for direct DB reads; client fetch + `router.refresh()` for mutations
- All text in Italian (UI labels, error messages)
