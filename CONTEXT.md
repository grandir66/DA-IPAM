# DA-IPAM — Context per onboarding agente / sviluppatore

Documento di **passaggio di consegne**: leggilo per primo, poi [CLAUDE.md](CLAUDE.md) per le regole tecniche vincolanti. Mappa ecosistema → `~/Progetti/Domarc/README.md`.

Versione corrente: vedi `package.json` / ultimo commit `release: vX.Y.Z` (non scriverla qui: va stale). Creato 2026-07-25 dall'analisi post-spostamento in `~/Progetti/Domarc/`.

> **Manutenzione**: aggiorna questo file quando cambia architettura, moduli, flusso di rilascio o stato prod — non per ogni release. Le voci datate portano la data.

## 1. Cos'è

**DA-INVENT** (alias DA-IPAM): IPAM/inventario **multi-tenant** per appliance cliente Domarc + hub di **9 moduli** security/network. Next.js 16 App Router + React 19 + TS strict, custom server [server.ts](server.ts) (tsx) che ospita lo scheduler node-cron. better-sqlite3 WAL, NextAuth v5 beta, Tailwind v4 + shadcn v4 (`@base-ui/react`), Zod v4.

- **Hub + spoke**: un DB SQLite per tenant (`data/tenants/<CODE>.db`) + `data/hub.db` (utenti, registry tenant, settings globali, profili template). Facade: `src/lib/db.ts` → `db-tenant.ts` / `db-hub.ts`; contesto tenant via `withTenantFromSession()` (`src/lib/api-tenant.ts`, ~65 route).
- **Nessun framework migrazioni**: `ALTER TABLE` idempotente inline negli `*-schema.ts`.
- UI: 33 route in `src/app/(dashboard)/`; API in `src/app/api/`.
- `agent/`: pacchetto Python `da_invent_agent` con versioning indipendente (`agent-vX.Y.Z`).

## 2. I 9 moduli (sorgente di verità: `src/lib/modules/registry.ts`)

`edge · patch_management · network_services · librenms · graylog · wazuh · meshcentral · inventory_agent · nis2_inventory` — ciascuno con `access: native` (UI dentro DA-IPAM) o `external` (dashboard esterna). Gating menu via `/api/modules` ← `resolveModules()`. Doc per-modulo: `docs/modules/`.

**Salute moduli**: `src/lib/modules/health.ts` (cache 60s) sonda solo i 7 moduli con servizio esterno/probe — `inventory_agent` e `nis2_inventory` sono toggle locali, **di proposito** senza probe né repair (la route `/api/modules/[key]/repair` li rifiuta).

## 3. Flusso di rilascio (CRITICO — non violare)

- Branch di lavoro: **`dev`** (unico pushabile). `main` avanza SOLO via **promote in-app**: `src/app/api/system/promote/route.ts` (merge `--no-ff origin/dev` + push, PAT cifrato in `hub.settings`). `main` indietro di ~100+ commit su dev = **fisiologico**: le appliance cliente pullano `main`.
- Canale update appliance: `src/app/api/system/update-channel/route.ts` → `DA_INVENT_BRANCH` in `.env.local`, consumato da `da-invent-update.service`.
- Ogni modifica: `npm run version:release` + `git push origin dev` (vedi skill `release`).
- Prod ufficiale hub: **VM 533, `192.168.4.8`**, `/opt/da-invent`, `da-invent.service`; dopo `git pull` sempre `npm run build` (skill `deploy-prod`).

## 4. Integrazione cross-repo (loose-coupled HTTP)

- **DA-Vul-can / Scanner-Edge**: gestione findings nativa in `/vulnerabilities`; connessione = sola config (tabella tenant `vuln_scanners`); pin SPKI del cert edge al primo Test connessione. Sync: `src/lib/vuln/sync-job.ts` (`runVulnSync`). Health-check hub: `/api/system-credentials/[id]/test` → `/scanner-edge-version`. Vault credenziali condiviso: `src/lib/credentials-vault.ts`.
- L'edge parla con DA-IPAM via `infra/scanner-edge/.../routes/api_v1_ipam.py` (lato DA-Vul-can): ensure-network, sync host, trigger Greenbone.
- **Deploy-Appliance**: installa DA-IPAM via git clone (`main`); punti di contatto locali: `scripts/appliance-*.sh|ts`, `src/lib/integrations/meshcentral/install.ts`, `.env.example` (variabili iniettate dall'installer).

## 5. Tooling

- `.claude/`: hook PostToolUse (tsc incrementale) + PreToolUse (blocca force-push main e `--no-verify`); skill `release`, `deploy-prod`, `winrm-kerberos`; rules `api-routes`, `client-components`, `db-access`.
- Test: `npm test` (node test runner, ~25 file in `src/lib/**/__tests__/`). Type-check: `npx tsc --noEmit` (nessuno script dedicato).
- CI `.github/workflows/ci.yml`: Node 22, lint advisory (~900 issue di debito), type-check, build.

## 6. Stato & igiene (fotografia 2026-07-25)

- Branch remoti potabili: `bugfix/code-audit-20260426-*`, `claude/flamboyant-proskuriakova`, `feature/remote-agents` (tutti confluiti/morti). Ref orfano `refs/remotes/github/dev` (remote `github` non esiste più).
- Zombie su disco (gitignored): `backups/` 125M (snapshot 2026-05-26), `data/.before-restore-*` e `data/.backup-before-pull-*` (marzo, pre-multitenant), 3-4 worktree orfani in `.claude/worktrees/`, 1 stash su branch morto (`feature/edge-tls` — "preservare" nel messaggio), 9 tag `pre-*`/`backup/*`.
- Doc storica con path pre-Domarc o stale: `docs/superpowers/plans/2026-06-29-rmm-meshcentral.md`, `docs/audit/audit-2026-05-26.md`, `ROADMAP-EVOLUZIONE.md` (mar 2026), `CHANGELOG.md` (fermo a mag 2026). `docs/CLAUDE-legacy-20260511.md` = narrativa storica intenzionale.

## 7. Trappola: `db-tenant` e le due istanze sotto `tsx` (2026-09-02)

L'appliance esegue `tsx server.ts`, cioè **dai sorgenti**, mentre i build Next
deduplicano i moduli. Conseguenza: **`await import()` di `db-tenant` restituisce
una SECONDA istanza** del modulo, con la propria `AsyncLocalStorage` vuota — e da
quel momento anche il `require()` del facade `db.ts` risolve su quella, quindi il
contesto tenant è perso per **tutto il processo** fino al riavvio.

Il difetto è **invisibile in produzione sui build Next** (DTS, appliance cliente):
si manifesta solo dove si gira da sorgente. Costo reale: 340 job falliti in 4h40
sul tenant 70791, con il messaggio fuorviante `Job #N non trovato` (il facade
ripiegava in silenzio sul tenant DEFAULT, che quei job non li ha), e 179 host del
tenant scritti dentro `DEFAULT.db` dai `fast_scan` già in corso.

- **Regola**: `db-tenant` si importa **staticamente**. Presidiata dal test
  invariante `src/lib/__tests__/no-dynamic-db-tenant-import.test.ts`.
- Restano leciti `require("./db-tenant")` e `typeof import(...)` (tipo, cancellato
  a compile-time). Importare dinamicamente **altri** moduli è sano, anche se
  quelli importano `db-tenant` staticamente — verificato sull'appliance.
- **Difese aggiunte**: guardia `assertTenantContext()` in `cron/scheduler.ts` (via
  `currentFacadeTenant()` di `db.ts`: interroga la risoluzione del facade, non il
  proprio import statico — quello vede sempre il contesto giusto e darebbe un
  falso "tutto bene"); tracker dei fallimenti in serie
  `src/lib/health/job-failure-tracker.ts`; allarme via
  `src/lib/health/scheduler-health-notify.ts`.
- Dettaglio e alternative scartate: [ADR 0002](docs/adr/0002-static-db-tenant-import.md).

**Igiene nota**: `data/tenants/DEFAULT.db` esiste ma `DEFAULT` **non è un tenant
registrato** nel hub (ci sono solo `70791` e `70791a`), quindi è un file orfano:
i 179 host contaminati non sono raggiungibili da alcuna interfaccia. Il fallback
silenzioso a DEFAULT in `db.ts` resta il motivo per cui una scrittura fuori
contesto non fa rumore da sola.
