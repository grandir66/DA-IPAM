# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Versioning (OBBLIGATORIO)

**Ogni modifica al codice deve incrementare la patch version.** Dopo aver completato modifiche:
1. Esegui `npm run version:bump` oppure incrementa manualmente `version` in `package.json`
2. Aggiorna anche `version` in `package-lock.json` se necessario

Versione attuale: vedi `package.json`.

## Project Overview

DA-INVENT is a full-stack IP Address Management web application built with Next.js 16. It manages networks, scans hosts (ICMP ping, nmap), acquires MAC addresses from routers (ARP tables), maps switch ports, and provides scheduled monitoring with cron jobs.

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
- **Palette:** Primary #00A7E7, Navy #0D2537, Gold #FFD400, BG #EDEDED (Domarc / domarc.it)

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

## Debug e Quality Assurance

### Regole anti-regressione

1. **MAI inserire codice di debug/telemetry** (fetch a endpoint locali, console.log temporanei, `#region agent log`). Se necessario per investigare, usare `console.warn("[DEBUG]")` e rimuoverlo prima del commit.
2. **MAI JSON.parse senza try-catch** in codice server-side (cron jobs, API routes). Un JSON malformato non deve crashare il processo.
3. **Tutti gli endpoint API devono avere auth check**. Per GET: `requireAuth()`. Per POST/PUT/DELETE: `requireAdmin()` da `src/lib/api-auth.ts`. Eccezioni senza auth: `/api/auth/*`, `/api/setup`, `/api/health`, `/api/version`.
4. **Endpoint di test** (`/api/test-snmp`, `/api/test-arp`) devono richiedere autenticazione in produzione.
5. **decrypt() mai senza protezione**: usare `safeDecrypt()` da `src/lib/crypto.ts` nei path non-critici. `decrypt()` nudo solo dove il fallimento deve propagarsi.
6. **CIDR overlap**: `createNetwork()` verifica automaticamente overlap con reti esistenti. Non bypassare.

### Performance Database (SQLite)

Le seguenti PRAGMA sono configurate in `src/lib/db.ts` e **non devono essere rimosse**:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;     -- Bilanciamento sicurezza/velocità (non FULL)
PRAGMA cache_size = -64000;      -- ~64MB di cache in RAM
PRAGMA temp_store = MEMORY;      -- Tabelle temporanee in RAM
PRAGMA mmap_size = 268435456;    -- 256MB memory-mapped I/O
```

### Pattern da evitare

- **N+1 query**: MAI chiamare `getXxxById()` in un `.map()` o `for` loop. Creare sempre una funzione con JOIN (es. `getHostsByNetworkWithDevices()` in db.ts).
- **DELETE fuori transazione**: Se un'operazione fa DELETE + INSERT, entrambi devono stare nella stessa `db.transaction()` (es. `upsertArpEntries`).
- **setInterval senza cleanup**: Ogni `setInterval` in un componente React deve avere un `useRef` + `useEffect` cleanup per evitare memory leak al cambio pagina.
- **Result set senza LIMIT**: Le query che ritornano liste per l'UI dovrebbero avere un LIMIT ragionevole o paginazione per dataset grandi.

### Indici Database

Gli indici compositi per le query più frequenti sono definiti in `src/lib/db-schema.ts`. Quando si aggiunge una nuova query con WHERE/JOIN su colonne non indicizzate, aggiungere l'indice corrispondente nello schema.

Indici critici per performance:

- `idx_hosts_network_ip` — lookup host per rete+IP (upsertHost)
- `idx_network_devices_host` — lookup device per IP (getNetworkDeviceByHost)
- `idx_arp_entries_mac_timestamp` — risoluzione MAC con ordinamento temporale
- `idx_mac_port_entries_device_mac` — subquery correlate nella vista porte switch

### Sicurezza API

- **Rate limiting**: `src/lib/rate-limit.ts` fornisce `checkRateLimit(key, max, windowMs)`. Applicato al login (5 tentativi/15min per username). Usare per nuovi endpoint sensibili.
- **RBAC**: `src/lib/api-auth.ts` fornisce `requireAuth()` e `requireAdmin()`. Ogni POST/PUT/DELETE deve usare `requireAdmin()`. I GET usano `requireAuth()` se contengono dati sensibili.
- **Health check**: `/api/health` disponibile senza auth per monitoring.

### Componenti UI condivisi

- `src/components/shared/pagination.tsx` — Controlli paginazione (Pagina X di Y, prev/next)
- `src/components/shared/skeleton-table.tsx` — Skeleton loading per tabelle
- `src/components/shared/global-search.tsx` — Ricerca globale con Cmd+K e navigazione tastiera
- `src/app/(dashboard)/error.tsx` — Error boundary dashboard

### Checklist pre-commit

1. `npm run lint` — nessun errore
2. `npm run build` — build completa senza errori
3. Verificare che nessun `fetch('http://127.0.0.1:...')` o `console.log` di debug sia rimasto nel codice
4. Verificare che ogni nuovo endpoint API abbia `requireAdmin()` (POST/PUT/DELETE) o `requireAuth()` (GET sensibili)
5. Verificare che ogni `JSON.parse` abbia try-catch
6. Verificare che ogni `setInterval` in componenti client abbia cleanup
7. Verificare che le liste usino paginazione (`getXxxPaginated()`) per dataset potenzialmente grandi
