# AGENTS.md — DA-IPAM (regole per agenti di codice)

File letto da Cursor, Codex e altri agenti. **Fonte di verità completa: [CLAUDE.md](CLAUDE.md)** +
[.claude/rules/](.claude/rules/) (api-routes, client-components, db-access) + [CONTEXT.md](CONTEXT.md)
per l'onboarding. Qui solo i vincoli non negoziabili, per non duplicare.

## Ambiente

- **Node 22 LTS obbligatorio.** Node ≥25 rompe `better-sqlite3` ("module factory not available").
- Branch di lavoro: **`dev`**. **MAI push su `main`** (avanza solo via promote dalla UI).
- Verifica prima di ogni commit: `npm run lint && npx tsc --noEmit && npm run build`.
- Test: `npm test` (`node --import tsx --test "src/**/*.test.ts"`), file in `src/lib/**/__tests__/`.

## Versioning (obbligatorio)

Ogni modifica al codice termina con `npm run version:release` (bump patch + commit `release: vX.Y.Z`)
e `git push origin dev`. Senza push, la produzione resta alla versione vecchia.
Se il working tree contiene lavoro altrui: `npm run version:release -- --staged-only`.

## Regole anti-regressione (violazione = bug latente)

1. **Auth su ogni endpoint**: GET sensibili `requireAuth()`, POST/PUT/DELETE `requireAdmin()` da
   `src/lib/api-auth.ts`. Eccezioni: `/api/auth/*`, `/api/setup`, `/api/health`, `/api/version`.
2. **Contesto tenant**: le route tenant-scoped passano da `withTenantFromSession()`
   (`src/lib/api-tenant.ts`). Mai `getDb()` diretto in route nuove — leak cross-tenant.
3. **`JSON.parse` server-side sempre in try-catch**; validazione input con **Zod v4** (`.issues`, non
   `.errors`).
4. **Mai `decrypt()` nudo** nei path non critici: usare `safeDecrypt()` da `src/lib/crypto.ts`.
5. **Schema DB**: nessun framework di migrazioni. Modifiche in `db-hub-schema.ts` /
   `db-tenant-schema.ts` + `ALTER TABLE` **idempotente inline**. Mai DROP/ALTER ad-hoc. I CHECK di
   SQLite non sono alterabili: serve ricostruzione tabella (idiom già presente nel repo).
6. **No N+1**: mai `getXxxById()` dentro `.map()`/loop — creare una funzione con JOIN.
7. **DELETE+INSERT logicamente atomici** sempre dentro `db.transaction(() => { ... })()`.
8. **`setInterval` nei client component** sempre con cleanup `useEffect` + `useRef`.
9. **Liste UI paginate** (`getXxxPaginated`): mai full table scan al frontend.
10. **Niente debug committato**: no `console.log`, no `fetch('http://127.0.0.1:...')`.
11. **TypeScript strict, no `any`.** Componenti funzionali, named export.
12. **Testo UI ed errori in italiano**; nomi di simboli e log tecnici in inglese.
13. **shadcn/ui v4** (`@base-ui/react`): niente `asChild`, usare `render={<Component />}`.

## Sicurezza

**Mai credenziali nel repo** (incident 2026-06-16). Il vault vive fuori da git. Nessun payload con
IP/hostname/utenti verso servizi AI esterni.

## Lavorare su un piano

I piani stanno in `docs/superpowers/plans/`, le spec in `docs/superpowers/specs/`. Un piano va
eseguito **task per task**: ogni task ha il proprio ciclo test → implementazione → test → commit.
Non accorpare i commit, non saltare gli step di verifica, non modificare le soglie dei test
preesistenti per farli passare — se un test storico cambia esito, aggiornalo spiegando il motivo
nel messaggio di commit.
