# DA-IPAM — Context per onboarding agente / sviluppatore

Documento di **passaggio di consegne**: leggilo per primo, poi [CLAUDE.md](CLAUDE.md) per le regole tecniche vincolanti. Mappa ecosistema → `~/Progetti/Domarc/README.md`.

Versione corrente: vedi `package.json` / ultimo commit `release: vX.Y.Z` (non scriverla qui: va stale). Creato 2026-07-25 dall'analisi post-spostamento in `~/Progetti/Domarc/`.

> **Manutenzione**: aggiorna questo file quando cambia architettura, moduli, flusso di rilascio o stato prod — non per ogni release. Le voci datate portano la data.

## 1. Cos'è

> **Decisione 2026-10-12 (Riccardo) — non riaprire: la logica multi-tenant è morta, un'installazione = un cliente.** Il codice resta a tenant (hub + un DB per tenant) e `withTenantFromSession` resta obbligatorio, perché senza contesto si scrive in `DEFAULT.db` e i dati spariscono. Ma il tenant **non è un confine di sicurezza**: passaggi di un utente fra tenant, dati di un cliente visibili a un altro, Wazuh o LibreNMS condivisi fra clienti **non sono difetti da correggere**.

**DA-INVENT** (alias DA-IPAM): IPAM/inventario per appliance cliente Domarc (nato multi-tenant, vedi decisione sopra) + hub di **9 moduli** security/network. Next.js 16 App Router + React 19 + TS strict, custom server [server.ts](server.ts) (tsx) che ospita lo scheduler node-cron. better-sqlite3 WAL, NextAuth v5 beta, Tailwind v4 + shadcn v4 (`@base-ui/react`), Zod v4.

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
- Prod ufficiale hub: **VM 533, `192.168.4.8`**, `/opt/da-invent`, `da-invent.service`; dopo `git pull` sempre `npm run build` (skill `deploy-prod`). **L'hub segue il ramo `dev`**, non `main` (verificato 2026-10-12: v0.3.258, gira con `tsx server.ts`); `main` è il canale delle appliance cliente.
- **ATTENZIONE — `dev` arriva anche a DTS** (verificato 2026-10-12): l'appliance DTS (`DTS-Inventory`, 172.16.0.2, tenant 71734, `/opt/da-ipam`, servizio `da-ipam`) segue **`dev`** con `da-ipam-update.timer` ogni 15 minuti (`scripts/auto-update.sh` → git pull + npm install + setup-winrm-venv + build + restart). Quindi **un push di codice su `dev` è un rilascio al cliente DTS** (build + riavvio entro 15 minuti): su `dev` solo codice pronto per la produzione. Un commit di soli `docs/` o `.md` aggiorna i file senza riavviare (dalla v0.3.267). Riparato il 12/10 (v0.3.265-267): venv WinRM senza pip, restart che cercava solo `da-invent`, «Aggiorna» dall'interfaccia che lasciava l'app spenta. **Mai `npm run build` a mano senza riavviare subito dopo**: Next carica i file della build a richiesta e il processo acceso smette di funzionare. Proxmox di DTS: 172.16.1.141, .142, .144.

## 4. Integrazione cross-repo (loose-coupled HTTP)

- **DA-Vul-can / Scanner-Edge**: gestione findings nativa in `/vulnerabilities`; connessione = sola config (tabella tenant `vuln_scanners`); pin SPKI del cert edge al primo Test connessione. Sync: `src/lib/vuln/sync-job.ts` (`runVulnSync`). Health-check hub: `/api/system-credentials/[id]/test` → `/scanner-edge-version`. Vault credenziali condiviso: `src/lib/credentials-vault.ts`.
- L'edge parla con DA-IPAM via `infra/scanner-edge/.../routes/api_v1_ipam.py` (lato DA-Vul-can): ensure-network, sync host, trigger Greenbone.
- **Deploy-Appliance**: installa DA-IPAM via git clone (`main`); punti di contatto locali: `scripts/appliance-*.sh|ts`, `src/lib/integrations/meshcentral/install.ts`, `.env.example` (variabili iniettate dall'installer).

## 5. Tooling

- `.claude/`: hook PostToolUse (tsc incrementale) + PreToolUse (blocca force-push main e `--no-verify`); skill `release`, `deploy-prod`, `winrm-kerberos`; rules `api-routes`, `client-components`, `db-access`.
- Test: `npm test` (node test runner, **1.440 test verdi** il 2026-10-12 sera, v0.3.272). Lanciarli con `DA_INVENT_DATA_DIR` puntato a una cartella temporanea: alcuni test aprono hub/tenant DB. Type-check: `npx tsc --noEmit` (pulito). Lint: 0 errori, 81 avvisi.
- CI `.github/workflows/ci.yml`: Node 22, lint advisory, type-check, test, build, pytest agente. **Nessun test di interfaccia né di autorizzazione delle API.**

## 6. Stato & igiene (fotografia 2026-10-12)

- **Piano di miglioramento (2026-10-12 sera) — leggere prima di toccare moduli, edge, installazione o UniFi**: nove tappe in `docs/superpowers/specs/2026-10-12-piano-miglioramento-design.md` (stato nel suo §9), decisioni in `docs/adr/0004-da-ipam-appliance-edge-guidato.md` (DA-IPAM è l'appliance; edge guidato con canale verso DA-Vul-can invariato; controller UniFi/Omada che creano oggetti). Il piano UniFi è la tappa 2, con dieci correzioni in testa. In bacheca: `lavori piano-miglioramento-da-ipam`.
- **Integrazione controller UniFi (2026-10-12, ramo `tappa2/unifi`, non ancora in `dev`)**: legge `stat/device` in sola lettura e scrive apparati, porte e vicini LLDP nel tenant (`src/lib/integrations/unifi-*.ts`, scelte in `docs/adr/0005-unifi-controller-integration.md`). **Nasce spenta**: si accende da Impostazioni → Moduli → «Controller UniFi» (modalità `external`, solo self-hosted), «Prova connessione» fissa il certificato, «Sincronizza ora» scrive; nessun job `unifi_sync` si crea da solo. Fixture: `src/lib/integrations/__tests__/fixtures/unifi-stat-device.json`, risposta vera del controller DTS presa il 12/10 con un account di sola lettura, ridotta a 4 apparati e anonimizzata (nomi, MAC, IP, seriali, SSID; commit `398b39e`). LLDP sta sull'apparato, mai nelle porte: le prove si scrivono su quella. Prima sync su DTS: prima su una copia del DB del tenant, contando prima e dopo. Revisione del ramo (12/10 sera): corretti offline, abbinamento per seriale, password al cambio d'indirizzo, prova in POST; tre limiti lasciati aperti e scritti nell'ADR 0005 (uplink non usato, due scrittori su porte e vicini, configurazione non legata a un tenant).
- **Nuovo (2026-10-12, ramo `feat/topology-map`, v0.3.259)**: feature **mappa topologia** interattiva (`/topology`) — React Flow + dagre, logica pura in `src/lib/topology/` (match/stato/grafo/layout, TDD), tabella tenant `topology_position`, API `GET/PUT /api/topology[/positions]`, stato a 4 livelli dal monitoraggio (host/LibreNMS/anomalie). Spec/piano/ADR in `docs/superpowers/{specs,plans}/2026-10-12-topology-map*` e `docs/adr/0003-topology-map.md`. **Da mergiare in `dev`.** Fase 2 (export drawio, collector API controller UniFi multi-backend) = piano separato.
- Rami remoti già interamente in `dev`, da potare: `auth/accesso-domarc`, `feat/ad-health-native`, `feature/attribution-fase-3-probe`, `fix/probe-real-world`. `claude/project-thread-7swirj` ha 18 commit non in `dev`: da rivedere prima di toccarlo. Worktree orfani e stash del 07/25: non ci sono più.
- Produzione: in `data/tenants/` oltre ai tenant registrati (`70791`, `70791a`) ci sono `DEFAULT.db` (orfano, vedi §7) e un `.db` di 0 byte senza nome (apertura con codice tenant vuoto).
- Doc superata: gli audit di maggio-luglio (`docs/audit-bug-sintesi.md`, `docs/audit/`, `WAVE-0-report.md`, `auth-matrix.md`, `db-drift.md`) — lo stato attuale di ogni loro punto è nell'analisi del §8. `scripts/verify-bug-report.ts` è rotto (cerca una rotta rimossa). `ROADMAP-EVOLUZIONE.md` superata; `CHANGELOG.md` non rispecchia le release recenti. `docs/CLAUDE-legacy-20260511.md` = narrativa storica intenzionale.

## 8. Analisi di sistema (2026-10-12)

Analisi completa — architettura, difetti per area con codici (`SEC`, `NUC`, `DB`, `INV`, `MOD`, `UI`, `IG`), cosa è solido, piano a blocchi — in **`docs/analisi-sistema.md`**. È **solo locale** (escluso da git con `.git/info/exclude`) perché contiene dettagli di sicurezza e il repo GitHub è pubblico: se manca su questa macchina, chiederla sul MacBook. Le trappole che chi tocca il codice deve sapere subito:

- **Corretti il 12/10 (v0.3.261-263), da non reintrodurre**: il wrapper `Select` (`components/ui/select.tsx`) ricava `items` dalle `SelectItem`, altrimenti base-ui mostra il valore grezzo; **le date del DB si leggono con `parseDbDate`** (`lib/db-date.ts`), mai `new Date(x)`, perché SQLite salva UTC senza fuso; nelle pagine rese sul server si aggiunge `timeZone: FUSO_UTENTI`; **un caricamento usa `fetchJson` + `LoadError`**, così un errore non diventa «lista vuota». Regole anche in `.claude/rules/client-components.md`.
- **`db.ts` e `db-tenant.ts` divergono** (~43 funzioni): prima di correggere una funzione DB, guardare **da quale dei due** la importa il chiamante.
- **Le scansioni non sono attese dallo scheduler** (`discoverNetwork` ritorna subito): il job risulta riuscito prima di finire e le scansioni si accavallano.
- **Crescita del DB**: niente retention sugli storici; `mac_ip_history` registra un "cambio" ogni volta che un MAC con più IP viene visto con l'altro IP (~31.000 righe/giorno sul tenant 70791, 2,1 GB in tutto).

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
- **Rapporto dell'intervento** (sede unica, si aggiorna — non scriverne uno nuovo
  accanto, vedi `~/Progetti/CLAUDE.md` §«I rapporti si integrano»):
  <https://claude.ai/code/artifact/722a75ac-e824-4828-8e8a-0f20bb8c5b50>

**Igiene nota**: `data/tenants/DEFAULT.db` esiste ma `DEFAULT` **non è un tenant
registrato** nel hub (ci sono solo `70791` e `70791a`), quindi è un file orfano:
i 179 host contaminati non sono raggiungibili da alcuna interfaccia. Il fallback
silenzioso a DEFAULT in `db.ts` resta il motivo per cui una scrittura fuori
contesto non fa rumore da sola.
