# CLAUDE.md

DA-INVENT (alias DA-IPAM): IPAM multi-tenant Next.js 16. Gestisce reti, scansioni host (ICMP/nmap), ARP da router, mapping porte switch e monitoring schedulato. Architettura **hub + spoke**: un DB SQLite per tenant + un hub condiviso.
**Non è:** un sistema single-tenant, e non condivide schema/dati con altri prodotti Domarc.

## Pointer

- Dettaglio narrativo legacy: [docs/CLAUDE-legacy-20260511.md](docs/CLAUDE-legacy-20260511.md)
- Skills (workflow): [.claude/skills/release/](.claude/skills/release/SKILL.md), [.claude/skills/deploy-prod/](.claude/skills/deploy-prod/SKILL.md), [.claude/skills/winrm-kerberos/](.claude/skills/winrm-kerberos/SKILL.md)
- Rules file-scoped: [.claude/rules/](.claude/rules/)
- ADR: [docs/adr/](docs/adr/) (template: `0000-template.md`)
- Manuali: [docs/MANUALE-SVILUPPATORE.md](docs/MANUALE-SVILUPPATORE.md), [docs/MANUALE-UTENTE.md](docs/MANUALE-UTENTE.md)

## Stack vincolante

Next.js 16 / React 19 / TS strict · better-sqlite3 (WAL) · NextAuth v5 beta · Tailwind v4 + shadcn/ui v4 (**@base-ui/react**, non @radix-ui) · Zod v4 (`.issues` non `.errors`) · node-cron via `server.ts`. **Node 20.x o 22.x LTS** — Node ≥25 rompe `better-sqlite3` ("module factory not available"). shadcn v4: niente `asChild`, usare `render={<Component />}`.

## Comandi essenziali

```bash
npm run dev               # Next.js dev su :3001 (no scheduler)
npm run dev:server        # tsx watch server.ts (con cron)
npm run lint              # ESLint
npx tsc --noEmit          # type-check (manuale, non c'è script dedicato)
npm run build             # build produzione
npm run version:release   # bump patch + commit "release: vX.Y.Z" (OBBLIGATORIO post-modifica)
git push origin <branch>  # senza push, il server in produzione non vede la nuova versione
```

## Regole anti-regressione (CRITICHE)

1. **Versioning obbligatorio**: ogni modifica al codice → `npm run version:release` + `git push`. Nessun commit "wip" senza bump.
2. **Auth check su ogni endpoint**: GET sensibili → `requireAuth()`; POST/PUT/DELETE → `requireAdmin()` da `src/lib/api-auth.ts`. Eccezioni: `/api/auth/*`, `/api/setup`, `/api/health`, `/api/version`.
3. **Mai `decrypt()` nudo nei path non-critici**: usare `safeDecrypt()` da `src/lib/crypto.ts`.
4. **JSON.parse SEMPRE in try-catch** in codice server-side (cron, API).
5. **Niente debug code committato**: no `console.log`, no `fetch('http://127.0.0.1:...')`, no `#region agent log`. Usare `console.warn("[DEBUG]")` temporaneo e rimuovere.
6. **No N+1**: mai `getXxxById()` dentro `.map()`/loop. Creare funzione con JOIN in `db.ts`/`db-tenant.ts`.
7. **DELETE+INSERT sempre in `db.transaction()`** (es. `upsertArpEntries`).
8. **`setInterval` in componenti React → cleanup via `useEffect`+`useRef`** obbligatorio.
9. **Liste UI → LIMIT/paginazione** (`getXxxPaginated()`). Mai full table scan al frontend.
10. **Schema DB**: nessun framework migrazioni. Modifiche schema → editare `db-hub-schema.ts`/`db-tenant-schema.ts` + `ALTER TABLE` inline idempotente nello stesso file. Mai DROP/ALTER ad-hoc.
11. **Hub vs Tenant**: dati specifici cliente → DB tenant. Hub contiene solo utenti, registry tenant, settings globali, profili template. Vedi tabella in [docs/CLAUDE-legacy-20260511.md](docs/CLAUDE-legacy-20260511.md).
12. **Triplica le funzioni DB**: modifiche a una funzione DB verificare presenza in `db-tenant.ts`, `db.ts`, `db-legacy.ts` (facade backward-compat). Non lasciare divergenze.

## Verifica obbligatoria post-modifica

```bash
npm run lint && npx tsc --noEmit && npm run build
```

Se cambia codice → poi `npm run version:release && git push`.

## File critici (non rompere senza migration esplicita)

| File | Perché |
|------|--------|
| `src/lib/db-hub-schema.ts` | Schema hub: tenants, users, settings, profili SNMP/fingerprint/nmap |
| `src/lib/db-tenant-schema.ts` | Schema tenant (35 tabelle operative) — include `host_credentials`, `device_credential_bindings` |
| `src/lib/db.ts` | Facade backward-compat che fa fallback a DEFAULT tenant |
| `src/lib/auth.ts` | JWT tenant-aware (`tenantCode`, `tenants[]`, ruoli) |
| `src/lib/api-tenant.ts` | `withTenantFromSession()` — usato da ~65 API routes |
| `server.ts` | Custom server con scheduler node-cron — prod usa `npm start` |

## Convenzioni

- TypeScript strict, **no `any`**. Functional components, named exports.
- Tutto il testo UI/errori **in italiano**.
- Server Components per letture; client fetch + `router.refresh()` per mutazioni.
- Palette Domarc: Primary `#00A7E7`, Navy `#0D2537`, Gold `#FFD400`, BG `#EDEDED`.

## Debug in produzione

Container LXC `333` sul nodo Proxmox `192.168.40.4` (DA-PX-04), app in `/opt/da-invent`, servizio `systemctl status da-invent`. Per comandi non distruttivi (SSH, `pct exec`, sqlite read-only, restart servizio, push file fixato) **procedere senza chiedere conferma**. Per modifiche DB hub, DROP, distruzione container, push su `main`, credenziali in chiaro → chiedere prima. Vedi [.claude/skills/deploy-prod/SKILL.md](.claude/skills/deploy-prod/SKILL.md) e [.claude/skills/winrm-kerberos/SKILL.md](.claude/skills/winrm-kerberos/SKILL.md).

## Loop di apprendimento (fine sessione)

Prima di chiudere, valuta:
- **Pattern emerso e riutilizzabile?** → nuovo file in `.claude/rules/` (scope file-type) o `.claude/skills/` (workflow)
- **Errore commesso 2+ volte?** → nuova regola anti-regressione qui sopra
- **Decisione architetturale?** → ADR in `docs/adr/` (template `0000-template.md`)
- **Fatto nuovo sul progetto?** → aggiorna `docs/CLAUDE-legacy-20260511.md` o crea CONTEXT.md
- **Dopo 2 correzioni fallite sullo stesso punto**: `/clear` e riformula il prompt invece di insistere

## Setup nuovo dev

```bash
git clone https://github.com/grandir66/DA-IPAM.git && cd DA-IPAM
nvm use 22 && npm install
cp .env.example .env.local   # popolare ENCRYPTION_KEY, DOMARC_USERNAME/PASSWORD
npm run db:empty             # rigenera template ipam.empty.db se serve
npm run dev:server           # custom server con scheduler
```
