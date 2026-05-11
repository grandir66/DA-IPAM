# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Versioning (OBBLIGATORIO)

**Ogni modifica al codice deve incrementare la patch version** e finire in un **commit Git** con messaggio `release: vX.Y.Z`.

Dopo le modifiche:
1. **`npm run version:release`** — esegue `version:bump`, poi `git add -A` e commit `release: vX.Y.Z` (usa `version:commit` con `--no-bump` solo se il bump è già stato fatto a mano)
2. **`git push`** verso `origin`, altrimenti sul server `git pull` non vede la nuova versione

Versione attuale: vedi `package.json`.

## Project Overview

DA-INVENT is a full-stack IP Address Management **multi-tenant** web application built with Next.js 16. It manages networks, scans hosts (ICMP ping, nmap), acquires MAC addresses from routers (ARP tables), maps switch ports, and provides scheduled monitoring with cron jobs.

## Architettura Multi-Tenant (Hub + Spoke)

Il sistema usa **database SQLite separati** per ogni cliente (tenant):

```
data/
  hub.db                    ← Utenti, tenant registry, settings globali, profili SNMP/nmap/fingerprint
  tenants/
    CLIENTE-001.db          ← Reti, host, device, credenziali, inventario, scansioni del cliente
    CLIENTE-002.db
    ...
```

### File chiave multi-tenant

| File | Ruolo |
|------|-------|
| `src/lib/db-hub-schema.ts` | Schema hub DB (tenants, users, settings, profili) |
| `src/lib/db-hub.ts` | Modulo hub: singleton + ~30 funzioni (CRUD tenant, utenti, settings, profili SNMP/fingerprint/nmap) |
| `src/lib/db-tenant-schema.ts` | Schema tenant DB (35 tabelle operative) |
| `src/lib/db-tenant.ts` | Modulo tenant: AsyncLocalStorage context + LRU cache connessioni + ~210 funzioni |
| `src/lib/db.ts` | **Facade** backward-compatible: re-esporta da hub e tenant. `getDb()` usa il contesto tenant attivo o fallback a DEFAULT |
| `src/lib/api-tenant.ts` | Helper `withTenantFromSession()` e `getTenantMode()` per le API routes |
| `src/lib/auth.ts` | Login con tenant nel JWT: `tenantCode`, `tenants[]`, ruolo `superadmin` |

### Regola di separazione Hub vs Tenant

**Principio fondamentale:** ogni dato specifico del cliente va nel DB tenant, il DB hub contiene solo dati condivisi tra tutti i tenant.

| Hub DB (`hub.db`) | Tenant DB (`CLIENTE.db`) |
|---|---|
| Utenti e autenticazione | Reti, host, scan history |
| Registro tenant | Network devices, credenziali |
| Settings globali | ARP entries, MAC port entries |
| Profili SNMP/nmap/fingerprint (template) | DHCP leases, inventario |
| | Scheduled jobs, status history |
| | Tutti i dati operativi del cliente |

**Attenzione alla duplicazione:** `db.ts` è una facade backward-compatible che contiene **copie** delle funzioni di `db-tenant.ts` per il codice legacy. Quando si modifica una funzione DB, verificare se esiste in **tutti e 3** i file: `db-tenant.ts`, `db.ts`, `db-legacy.ts`. Le funzioni in `db.ts` usano `getDb()` (che fa fallback a DEFAULT), quelle in `db-tenant.ts` usano `db()` via AsyncLocalStorage.

### Contesto tenant nelle API

Tutte le ~65 API routes tenant-scoped usano `withTenantFromSession()` che:
1. Legge `tenantCode` dal JWT
2. Imposta il contesto `AsyncLocalStorage` con `withTenant(code, fn)`
3. Tutte le funzioni DB chiamano `db()` interno che usa il contesto per aprire il DB corretto

### Ruoli utente

| Ruolo | Scope |
|-------|-------|
| `superadmin` | Accede a tutti i tenant, gestisce clienti, tenantCode = `__ALL__` per vista aggregata |
| `admin` | Accede solo al suo tenant assegnato |
| `viewer` | Solo lettura nel suo tenant |

### Utente di servizio Domarc

Autenticazione via env var `DOMARC_USERNAME` + `DOMARC_PASSWORD` in `.env.local`. Accesso superadmin incondizionato, senza record nel DB.

### Migrazione da single-tenant

```bash
npm run migrate:multitenant    # Crea hub.db + data/tenants/DEFAULT.db da ipam.db
```

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
- **Database:** SQLite via better-sqlite3 (WAL mode, runtime file `data/ipam.db`; template vuoto versionato `data/ipam.empty.db`, rigenerabile con `npm run db:empty`)
- **Auth:** NextAuth v5 (beta) with Credentials provider, JWT in HttpOnly cookies
- **Validation:** Zod v4 (uses `.issues` not `.errors`)
- **Font:** Signika (Google Fonts) via `next/font/google`
- **Scanning:** child_process for ping/nmap, Node.js `dns` builtin
- **Device integration:** ssh2 (SSH), net-snmp (SNMP), fetch (REST API)
- **Scheduling:** node-cron via custom server (`server.ts`)
- **Palette:** Primary #00A7E7, Navy #0D2537, Gold #FFD400, BG #EDEDED (Domarc / domarc.it)
- **Node (produzione):** 20.x o 22.x LTS (`package.json` → `engines`). Evitare Node ≥25 per `better-sqlite3`: errori tipo *module factory is not available* → usare Node 22 o `npm rebuild better-sqlite3` dopo cambio versione Node.

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

## Produzione e debug remoto

### Accesso al sistema di produzione

DA-INVENT gira in un container LXC su un nodo Proxmox.

```text
Proxmox host: root@192.168.40.4   (DA-PX-04, pve-manager 9.1.x)
LXC ID:       333                  (nome: da-invent)
App path:     /opt/da-invent
Service:      systemctl status da-invent
DB tenant:    /opt/da-invent/data/tenants/<tenantId>.db   (es. 70791.db)
DB hub:       /opt/da-invent/data/hub.db
Encryption:   ENCRYPTION_KEY in /opt/da-invent/.env.local (scrypt-derivata)
Venv WinRM:   /root/.da-invent-venv  (pywinrm + gssapi/Kerberos)
```

Comandi tipici:

```bash
# Shell nel container
ssh root@192.168.40.4 "pct exec 333 -- bash -lc '<comando>'"

# Push file aggiornato nel container
scp file.py root@192.168.40.4:/tmp/x && ssh root@192.168.40.4 "pct push 333 /tmp/x /opt/da-invent/path/file.py"

# Test bridge WinRM con cred decrittate (chiave da .env.local, vedi sotto per dec.cjs)
echo '{"host":"...","port":5985,...}' | /root/.da-invent-venv/bin/python3 /opt/da-invent/src/lib/devices/winrm-bridge.py

# Aggiorna versione produzione
ssh root@192.168.40.4 "pct exec 333 -- bash -lc 'cd /opt/da-invent && git pull && npm run build && systemctl restart da-invent'"
```

**Regola operativa per debug in produzione:** quando l'utente chiede esplicitamente di debuggare il sistema 192.168.40.4 / PCT 333, **procedere senza chiedere conferma per ogni comando read-only o non distruttivo** (SSH, sqlite query, lettura file, restart servizio, push di un file fixato già testato in dev). Chiedere conferma solo per: modifiche al DB hub, drop tabelle, distruzione container, modifiche di rete, push su `main`, scrittura di credenziali in chiaro su disco.

### WinRM / Kerberos verso Active Directory

Catena di autenticazione del bridge ([src/lib/devices/winrm-bridge.py](src/lib/devices/winrm-bridge.py)): **Kerberos → NTLM → CredSSP → Basic**. NTLM funziona quasi sempre via SPNEGO; Kerberos richiede ticket + SPN registrato.

**Tre regole inviolabili (errori storici, vedi commit deb876f / v0.2.413):**

1. **Realm SEMPRE in UPPERCASE** nel principal Kerberos. AD rifiuta `user@dominio.it` con `KDC reply did not match expectations`. Quando si normalizza un username `user@realm` per kinit o per `winrm.Session(transport="kerberos")`, fare `user_part + "@" + realm.upper()`.

2. **MAI scrivere `kdc = <host_target>` in `/etc/krb5.conf`.** Lo scanner si connette per IP a host diversi: usare quell'IP come KDC corrompe Kerberos per tutte le scansioni successive (e MIT krb5 con `[realms]` esplicito ignora il DNS SRV). Il bridge genera un krb5.conf SOLO con `[libdefaults]` + `dns_lookup_kdc = true` + `[domain_realm]`, senza sezione `[realms]`. Il file è marcato col commento `# DA-INVENT-KRB5-DNS-SRV`. La rete del cliente DEVE avere i record SRV `_kerberos._tcp.<realm>` (verificabile con `host -t SRV _kerberos._tcp.<realm>`).

3. **Per Kerberos serve un FQDN, non un IP.** AD registra SPN come `HTTP/da-rdh.domarc.it`, non `HTTP/192.168.4.21`. Il bridge fa reverse-DNS automatico (`socket.gethostbyaddr`) quando il transport è Kerberos e l'host è un IP, e usa il FQDN risolto come endpoint. Se reverse-DNS fallisce → Kerberos viene saltato e la chain ricade su NTLM.

**Dipendenze sistema** (installate da [scripts/install.sh](scripts/install.sh) ≥ v0.2.412): `libkrb5-dev krb5-config krb5-user libffi-dev` per compilare `gssapi` nel venv. Senza queste, il pip install di `gssapi` fallisce con `Command 'krb5-config --libs gssapi' returned non-zero exit status 127`.

**Diagnosi rapida quando "WinRM non funziona con molti host Windows":**

```bash
# 1. il target risponde su 5985 e annuncia Negotiate?
curl -sk -o /dev/null -D - http://<ip>:5985/wsman -X POST  # 401 + WWW-Authenticate: Negotiate, Kerberos

# 2. DNS SRV per Kerberos esiste?
host -t SRV _kerberos._tcp.<realm>

# 3. /etc/krb5.conf nel container è quello "DA-INVENT-KRB5-DNS-SRV"?
ssh root@192.168.40.4 "pct exec 333 -- head -1 /etc/krb5.conf"

# 4. kinit manuale (realm UPPERCASE) vede il KDC?
ssh root@192.168.40.4 "pct exec 333 -- bash -lc 'echo \$PWD | kinit user@REALM.FQDN'"

# 5. test bridge end-to-end (vedi sezione "Comandi tipici")
```

Se NTLM funziona e Kerberos no per uno specifico host: probabilmente lo SPN `HTTP/<fqdn>` non è registrato in AD, oppure l'utente non ha permessi `Remote Management Users` / `Administrators` su quella macchina.

## Bug noto: persistenza credenziali subnet → host → device

**Sintomo riportato dall'utente:** dopo aver definito una credenziale per una subnet e averla testata con esito positivo verso un IP, l'utente deve re-inserire la stessa credenziale in più punti del sistema. Il binding "questa credenziale + questo protocollo funziona contro questo IP" non viene memorizzato.

**Cause architetturali (vedi audit completo, 2026-04-28):**

- Le tabelle del binding **esistono già**: `host_credentials` (host_id ↔ credential_id ↔ protocol_type, con `validated`/`auto_detected`) e `device_credential_bindings` (device_id ↔ credential_id ↔ protocol_type, con `test_status`). Entrambe in [src/lib/db-tenant-schema.ts](src/lib/db-tenant-schema.ts) (host_credentials L245-257, device_credential_bindings L271-286). Le funzioni `addHostCredential()` e `addDeviceCredentialBinding()` esistono in [db-tenant.ts](src/lib/db-tenant.ts).

- **Bug 1 — i test endpoint non scrivono il binding al successo.**
  - [/api/credentials/[id]/test](src/app/api/credentials/[id]/test/route.ts): testa SSH/SNMP/WinRM, ritorna `{ success: true }`, **non chiama `addHostCredential()`**.
  - [/api/devices/[id]/credentials PUT action="test"](src/app/api/devices/[id]/credentials/route.ts) L155-170: aggiorna solo `test_status` del binding già esistente, non promuove nulla a `host_credentials`.
  - [/api/devices/test-provisional](src/app/api/devices/test-provisional/route.ts): testa una device provvisoria, non scrive niente.

- **Bug 2 — la promozione host → device è opt-in e ignorata di default.**
  [/api/devices/bulk](src/app/api/devices/bulk/route.ts) L176-214 eredita `host_credentials` solo se la richiesta passa `inherit_host_credentials: true`. La UI tipicamente non lo passa, quindi alla creazione del device i binding di host vanno persi.

- **Bug 3 — il device test non fa fallback a host_credentials.**
  `resolveCredentials()` in [src/lib/devices/device-connection-test.ts](src/lib/devices/device-connection-test.ts) L119-124 legge solo `device_credential_bindings`. Se il device non ha binding ma l'host sottostante sì, il test fallisce invece di riusarli.

**Cosa va fatto (priorità):**

1. Nei test endpoint, al successo scrivere/aggiornare la riga in `host_credentials` (`addHostCredential` con `validated=1`, `validated_at=now`, `auto_detected` in base al contesto). Idempotente: UPSERT su `(host_id, credential_id, protocol_type)`.
2. In `resolveCredentials()` per device: se `device_credential_bindings` è vuoto, cercare in `host_credentials` dell'host con stesso IP del device.
3. Rendere `inherit_host_credentials = true` il default in `bulk/route.ts` e nell'UI di promozione, oppure rimuovere il flag e farlo sempre.
4. Esporre nella UI host/device la lista dei binding `validated=1` con `validated_at` e protocollo, così l'utente vede subito cosa funziona.

Tabelle legacy da NON usare per nuove feature: `network_host_credentials` (subnet+ruolo), `host_detect_credential` (deprecata).
